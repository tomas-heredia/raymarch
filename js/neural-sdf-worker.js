// ============================================================================
// IQ-SDF SUPREME ENGINE — Web Worker: malla -> red neuronal (SIREN) que aproxima su SDF
//
// La red se exporta como GLSL puro (sin texturas): ver generateMeshNeuralFunction en
// shader-generator.js. Backpropagation y Adam escritos a mano (sin dependencias nuevas);
// three + three-mesh-bvh solo para las distancias exactas de las muestras (esm.sh, igual
// que sdf-bake-worker.js: los workers no ven el import map).
//
// Mensaje de entrada: { jobId, positions: Float32Array (triángulos sin indexar, espacio LOCAL
//   del nodo malla = coordenadas del editor menos el centro del bbox), width, hidden, iterations,
//   band? (default 0.1), edgeFraction? (0..1: parte de las muestras de superficie que van a las
//   aristas vivas; 0 = ninguna) }
// Mensajes de salida:
//   { type: 'progress', jobId, progress: 0..1, phase: 'sampling' | 'training' }
//   { type: 'done', jobId, layers: [{ nin, nout, W: Float32Array (fila = neurona de salida), b }],
//     scale, band, lipschitz, metrics: { meanErr, maxErr, signErrPct }, ms }
//   { type: 'error', jobId, message }
//
// Convenciones (las usa el generador de GLSL):
//   entrada x = p_local / scale   (scale = mitad del lado mayor del bbox: el bbox queda en [-1, 1])
//   capas ocultas: h = sin(OMEGA0 (W x + b)); al exportar, OMEGA0 se multiplica dentro de W y b
//   salida lineal y = distancia / scale, entrenada solo dentro de ±band (afuera basta el signo)
//   distancia en el shader = clamp(y, -band, band) * scale / lipschitz
// ============================================================================

import { BufferGeometry, BufferAttribute, Vector3, Ray, DoubleSide } from 'https://esm.sh/three@0.187.0';
import { MeshBVH } from 'https://esm.sh/three-mesh-bvh@0.10.0?deps=three@0.187.0';

const OMEGA0 = 15;          // frecuencia de SIREN (30, el valor del paper, deja ondulaciones visibles en la superficie)
const DEFAULT_BAND = 0.1;   // banda (normalizada) donde se aprende la distancia
const SHARP_COS = Math.cos(Math.PI / 6); // arista viva: normales que difieren más de 30°
const RANGE = 1.25;         // las muestras cubren el bbox normalizado + margen del shader
const BATCH = 512;
const TRAIN_SAMPLES = 200000;
const TEST_SAMPLES = 20000;

const SIGN_DIRECTIONS = [
  new Vector3(0.83, 0.47, 0.31).normalize(),
  new Vector3(-0.29, 0.86, -0.42).normalize(),
  new Vector3(0.38, -0.33, 0.86).normalize()
];

// PRNG determinista: el mismo archivo y calidad dan la misma red
function makeRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
}

// ---------------------------------------------------------------------------
// Muestras: distancia exacta (BVH) con signo por votación de 3 rayos
// ---------------------------------------------------------------------------
function buildSampler(positions, scale) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const bvh = new MeshBVH(geometry);
  const p = new Vector3();
  const ray = new Ray();
  const closest = {};
  // Distancia normalizada en un punto normalizado
  return (x, y, z) => {
    p.set(x * scale, y * scale, z * scale);
    const dist = bvh.closestPointToPoint(p, closest).distance;
    let insideVotes = 0;
    for (const dir of SIGN_DIRECTIONS) {
      ray.origin.copy(p);
      ray.direction.copy(dir);
      const hit = bvh.raycastFirst(ray, DoubleSide);
      if (hit && hit.face.normal.dot(dir) > 0) insideVotes++;
    }
    return (insideVotes >= 2 ? -dist : dist) / scale;
  };
}

// Puntos sobre la superficie (por área) con un desplazamiento gaussiano, para concentrar
// las muestras donde importa; el resto uniforme en la caja.
function makeSurfacePicker(positions, scale, rng) {
  const nTri = positions.length / 9;
  const cum = new Float64Array(nTri);
  let total = 0;
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    const ux = positions[o + 3] - positions[o], uy = positions[o + 4] - positions[o + 1], uz = positions[o + 5] - positions[o + 2];
    const vx = positions[o + 6] - positions[o], vy = positions[o + 7] - positions[o + 1], vz = positions[o + 8] - positions[o + 2];
    total += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    cum[t] = total;
  }
  const gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
  return out => {
    const r = rng() * total;
    let lo = 0, hi = nTri - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    let a = rng(), b = rng();
    if (a + b > 1) { a = 1 - a; b = 1 - b; }
    const o = lo * 9;
    const sigma = rng() < 0.5 ? 0.01 : 0.04; // normalizado: cerca y un poco más lejos
    for (let k = 0; k < 3; k++) {
      const v = positions[o + k] + a * (positions[o + 3 + k] - positions[o + k]) + b * (positions[o + 6 + k] - positions[o + k]);
      out[k] = v / scale + gauss() * sigma;
    }
  };
}

// Aristas vivas (ángulo entre caras > 30°, o bordes abiertos): es donde la red redondea.
// Devuelve un muestreador por longitud con desplazamiento gaussiano, o null si no hay.
function makeEdgePicker(positions, scale, rng) {
  const nTri = positions.length / 9;
  const key = (o) => `${positions[o].toFixed(5)},${positions[o + 1].toFixed(5)},${positions[o + 2].toFixed(5)}`;
  const edges = new Map(); // "a|b" -> { a, b (offsets), normals: [] }
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    const ux = positions[o + 3] - positions[o], uy = positions[o + 4] - positions[o + 1], uz = positions[o + 5] - positions[o + 2];
    const vx = positions[o + 6] - positions[o], vy = positions[o + 7] - positions[o + 1], vz = positions[o + 8] - positions[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 0)) continue;
    nx /= len; ny /= len; nz /= len;
    for (let e = 0; e < 3; e++) {
      const a = o + 3 * e, b = o + 3 * ((e + 1) % 3);
      const ka = key(a), kb = key(b);
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      let edge = edges.get(k);
      if (!edge) edges.set(k, (edge = { a, b, normals: [] }));
      edge.normals.push(nx, ny, nz);
    }
  }
  const sharp = [];
  for (const edge of edges.values()) {
    const N = edge.normals;
    let isSharp = N.length !== 6; // borde abierto o arista no-manifold
    if (!isSharp) isSharp = N[0] * N[3] + N[1] * N[4] + N[2] * N[5] < SHARP_COS;
    if (isSharp) sharp.push(edge);
  }
  if (!sharp.length) return null;
  const cum = new Float64Array(sharp.length);
  let total = 0;
  sharp.forEach((edge, i) => {
    const { a, b } = edge;
    total += Math.hypot(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]);
    cum[i] = total;
  });
  const gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
  const pick = out => {
    const r = rng() * total;
    let lo = 0, hi = sharp.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    const { a, b } = sharp[lo];
    const t = rng();
    const sigma = rng() < 0.5 ? 0.01 : 0.04;
    for (let k = 0; k < 3; k++) out[k] = (positions[a + k] + t * (positions[b + k] - positions[a + k])) / scale + gauss() * sigma;
  };
  pick.count = sharp.length;
  return pick;
}

function buildSamples(n, sdf, pickSurface, pickEdge, edgeFraction, rng, report) {
  const P = new Float32Array(n * 3);
  const D = new Float32Array(n);
  const q = [0, 0, 0];
  let lastReport = 0;
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      for (let k = 0; k < 3; k++) q[k] = (rng() * 2 - 1) * RANGE;
    } else if (pickEdge && rng() < edgeFraction) {
      pickEdge(q);
    } else {
      pickSurface(q);
    }
    P[i * 3] = q[0]; P[i * 3 + 1] = q[1]; P[i * 3 + 2] = q[2];
    D[i] = sdf(q[0], q[1], q[2]);
    const now = performance.now();
    if (report && now - lastReport > 100) { lastReport = now; report(i / n); }
  }
  return { P, D, n };
}

// ---------------------------------------------------------------------------
// Red: SIREN (sin(OMEGA0 * (W x + b)) en las capas ocultas, salida lineal)
// ---------------------------------------------------------------------------
function createNetwork(sizes, rng) {
  const layers = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const nin = sizes[l], nout = sizes[l + 1];
    const bound = l === 0 ? 1 / nin : Math.sqrt(6 / nin) / OMEGA0;
    const W = new Float32Array(nin * nout);
    const b = new Float32Array(nout);
    for (let i = 0; i < W.length; i++) W[i] = (rng() * 2 - 1) * bound;
    for (let i = 0; i < nout; i++) b[i] = (rng() * 2 - 1) * (l === 0 ? 1 : bound);
    layers.push({
      nin, nout, W, b,
      gW: new Float32Array(W.length), gb: new Float32Array(nout),
      mW: new Float32Array(W.length), vW: new Float32Array(W.length),
      mb: new Float32Array(nout), vb: new Float32Array(nout)
    });
  }
  const acts = sizes.map(s => new Float32Array(s));
  const pre = sizes.map(s => new Float32Array(s));
  const delta = sizes.map(s => new Float32Array(s));
  const last = layers.length - 1;

  function forward(x, y, z) {
    acts[0][0] = x; acts[0][1] = y; acts[0][2] = z;
    for (let l = 0; l <= last; l++) {
      const L = layers[l], a = acts[l], zo = pre[l + 1], ao = acts[l + 1];
      for (let o = 0; o < L.nout; o++) {
        let s = L.b[o];
        const row = o * L.nin;
        for (let i = 0; i < L.nin; i++) s += L.W[row + i] * a[i];
        zo[o] = s;
        ao[o] = l === last ? s : Math.sin(OMEGA0 * s);
      }
    }
    return acts[sizes.length - 1][0];
  }

  function backward(gradOut) {
    delta[last + 1][0] = gradOut;
    for (let l = last; l >= 0; l--) {
      const L = layers[l], a = acts[l], dOut = delta[l + 1];
      if (l !== last) for (let o = 0; o < L.nout; o++) dOut[o] *= OMEGA0 * Math.cos(OMEGA0 * pre[l + 1][o]);
      const dIn = delta[l];
      if (l > 0) dIn.fill(0);
      for (let o = 0; o < L.nout; o++) {
        const g = dOut[o], row = o * L.nin;
        if (g === 0) continue;
        L.gb[o] += g;
        for (let i = 0; i < L.nin; i++) {
          L.gW[row + i] += g * a[i];
          if (l > 0) dIn[i] += g * L.W[row + i];
        }
      }
    }
  }

  function adamStep(lr, t) {
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const c1 = 1 - Math.pow(b1, t), c2 = 1 - Math.pow(b2, t);
    for (const L of layers) {
      for (const [P, G, M, V] of [[L.W, L.gW, L.mW, L.vW], [L.b, L.gb, L.mb, L.vb]]) {
        for (let i = 0; i < P.length; i++) {
          const g = G[i] / BATCH;
          M[i] = b1 * M[i] + (1 - b1) * g;
          V[i] = b2 * V[i] + (1 - b2) * g * g;
          P[i] -= lr * (M[i] / c1) / (Math.sqrt(V[i] / c2) + eps);
          G[i] = 0;
        }
      }
    }
  }

  return { layers, forward, backward, adamStep };
}

function train({ jobId, positions, width, hidden, iterations, band, edgeFraction }) {
  const BAND = band > 0 && band <= 0.5 ? band : DEFAULT_BAND;
  const EDGE_FRACTION = Math.max(0, Math.min(1, edgeFraction || 0));
  const t0 = performance.now();
  const H = Math.max(4, Math.min(64, Math.round(width / 4) * 4 || 24));
  const NL = Math.max(1, Math.min(4, hidden | 0 || 2));
  const ITERS = Math.max(100, Math.min(50000, iterations | 0 || 6000));

  // Mitad del lado mayor del bbox (la malla llega centrada en su bbox)
  const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) { mins[k] = Math.min(mins[k], positions[i + k]); maxs[k] = Math.max(maxs[k], positions[i + k]); }
  }
  const scale = Math.max(maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]) / 2;
  if (!(scale > 0)) throw new Error('La malla no tiene volumen (todos los vértices coinciden).');

  const rng = makeRng(12345);
  const sdf = buildSampler(positions, scale);
  const pick = makeSurfacePicker(positions, scale, rng);
  const pickEdge = EDGE_FRACTION > 0 ? makeEdgePicker(positions, scale, rng) : null;

  // Progreso: muestreo 0..15 %, entrenamiento 15..100 %
  const post = (progress, phase) => self.postMessage({ type: 'progress', jobId, progress, phase });
  const trainSet = buildSamples(TRAIN_SAMPLES, sdf, pick, pickEdge, EDGE_FRACTION, rng, f => post(0.15 * f * (TRAIN_SAMPLES / (TRAIN_SAMPLES + TEST_SAMPLES)), 'sampling'));
  // Test sin sesgo hacia las aristas, para que las métricas sean comparables entre calidades
  const testSet = buildSamples(TEST_SAMPLES, sdf, pick, null, 0, rng, null);
  post(0.15, 'training');

  const sizes = [3, H, ...Array(NL).fill(H), 1];
  const net = createNetwork(sizes, rng);
  let lastReport = 0;
  for (let it = 1; it <= ITERS; it++) {
    for (let k = 0; k < BATCH; k++) {
      const j = (rng() * trainSet.n) | 0;
      const y = net.forward(trainSet.P[j * 3], trainSet.P[j * 3 + 1], trainSet.P[j * 3 + 2]);
      const target = Math.max(-BAND, Math.min(BAND, trainSet.D[j]));
      // L1 dentro de la banda; afuera solo importa que no cruce el signo ni quede adentro de la banda
      const saturated = Math.abs(target) >= BAND && Math.abs(y) >= BAND && Math.sign(y) === Math.sign(target);
      if (saturated) continue;
      const pred = Math.max(-BAND, Math.min(BAND, y));
      net.backward(Math.sign(pred - target) || 0);
    }
    const lr = 1e-4 + 0.5 * (1e-3 - 1e-4) * (1 + Math.cos(Math.PI * it / ITERS));
    net.adamStep(lr, it);
    const now = performance.now();
    if (now - lastReport > 100) { lastReport = now; post(0.15 + 0.85 * it / ITERS, 'training'); }
  }

  // Evaluación con muestras que no se usaron para entrenar (unidades del objeto)
  let errSum = 0, errN = 0, errMax = 0, signBad = 0, signN = 0, lip = 0;
  const h = 1e-3;
  for (let j = 0; j < testSet.n; j++) {
    const x = testSet.P[j * 3], y = testSet.P[j * 3 + 1], z = testSet.P[j * 3 + 2], d = testSet.D[j];
    const out = net.forward(x, y, z);
    if (Math.abs(d) < DEFAULT_BAND / 2) { // franja fija: métricas comparables entre calidades
      const e = Math.abs(out - d) * scale;
      errSum += e; errN++; errMax = Math.max(errMax, e);
    }
    if (Math.abs(d) > 0.01) { signN++; if (Math.sign(out) !== Math.sign(d)) signBad++; }
    // Pendiente solo donde la distancia REAL está en la banda: ahí un paso demasiado largo
    // atravesaría la superficie. Más lejos, el paso recortado (≤ band·scale/lipschitz) ya es
    // menor que la distancia real, aunque la red oscile.
    if (Math.abs(d) < BAND) {
      const gx = net.forward(x + h, y, z) - net.forward(x - h, y, z);
      const gy = net.forward(x, y + h, z) - net.forward(x, y - h, z);
      const gz = net.forward(x, y, z + h) - net.forward(x, y, z - h);
      lip = Math.max(lip, Math.hypot(gx, gy, gz) / (2 * h));
    }
  }

  // Exportar con OMEGA0 ya multiplicado en las capas ocultas (el GLSL hace sin(W x + b))
  const layers = net.layers.map((L, l) => {
    const k = l === net.layers.length - 1 ? 1 : OMEGA0;
    return { nin: L.nin, nout: L.nout, W: L.W.map(v => v * k), b: L.b.map(v => v * k) };
  });

  return {
    layers,
    scale,
    band: BAND,
    // Margen de seguridad: el máximo medido sobre 20k puntos puede subestimar el real
    lipschitz: Math.max(1, lip * 1.2),
    metrics: {
      meanErr: errN ? errSum / errN : 0,
      maxErr: errMax,
      signErrPct: signN ? (100 * signBad) / signN : 0
    },
    arch: sizes.join('-'),
    ms: Math.round(performance.now() - t0)
  };
}

self.onmessage = e => {
  const { jobId } = e.data;
  try {
    const result = train(e.data);
    const transfer = result.layers.flatMap(L => [L.W.buffer, L.b.buffer]);
    self.postMessage({ type: 'done', jobId, ...result }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', jobId, message: String(err && err.message || err) });
  }
};
