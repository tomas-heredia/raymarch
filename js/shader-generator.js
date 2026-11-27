// ============================================================================
// IQ-SDF SUPREME ENGINE — Live GLSL Master Shader Compiler & Presets
// Builds the complete Raymarching shader based on the user's base structure
// ============================================================================

window.ShaderGenerator = (function () {
  const { GLSL_HELPERS, PRIMITIVES, fmt, createNode, resolveHelpers } = window.SDFLibrary;

  // Helpers the master template always uses (CSG ops in de() + rotate2d for transforms/camera)
  const CORE_HELPERS = ['opSmoothUnion', 'opSmoothSubtraction', 'opSmoothIntersection', 'rotate2d'];

  function hexToVec3(hex) {
    const clean = (hex || '#ffffff').replace('#', '');
    const num = parseInt(clean, 16);
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;
    return `vec3(${fmt(r)}, ${fmt(g)}, ${fmt(b)})`;
  }

  // --------------------------------------------------------------------------
  // Mallas importadas (nodos type === 'mesh', con node.meshId)
  // El SDF vive en una textura 3D (uniform uMeshSdf_<meshId>) que sube el renderer.
  // El espacio local de la malla está centrado en el centro de su bounding box.
  // --------------------------------------------------------------------------
  function isValidMeshId(id) {
    return typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(id) && !id.includes('__');
  }

  // Floats con más precisión que fmt() (mallas chicas o muy grandes), siempre como literal GLSL válido.
  function fmtPrecise(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return '0.0';
    let s = num.toPrecision(7);
    if (!/[.e]/.test(s)) s += '.0';
    return s;
  }

  function vec3Precise(v) {
    return `vec3(${fmtPrecise(v.x)}, ${fmtPrecise(v.y)}, ${fmtPrecise(v.z)})`;
  }

  // Lado mayor del bbox de la malla, en unidades del editor (1 si la malla no está).
  function meshMaxDim(info) {
    const h = info?.halfSize;
    const m = h ? 2 * Math.max(h.x, h.y, h.z) : 0;
    return m > 0 ? m : 1;
  }

  /**
   * Parámetros de un nodo malla (todos opcionales):
   *   size        lado mayor en unidades del mundo (por defecto el de la malla original)
   *   sx, sy, sz  escala por eje (por defecto 1)
   * Escala no uniforme: sdMesh(p / S) * min(S) es una cota inferior de la distancia real
   * (conservadora), así el raymarcher nunca atraviesa la superficie.
   * Con Modulación de Tamaño, spsize reemplaza a 'size'.
   */
  function meshPrimitive(node, info) {
    const params = node.params || {};
    const maxDim = meshMaxDim(info);
    const num = (v, def, lo) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.max(lo, n) : def;
    };
    const size = num(params.size, maxDim, 1e-4);
    const s = { x: num(params.sx, 1, 0.01), y: num(params.sy, 1, 0.01), z: num(params.sz, 1, 0.01) };
    const isOne = v => Math.abs(v - 1) < 1e-6;
    const uniform = isOne(s.x / s.y) && isOne(s.y / s.z);
    const fn = `sdMesh_${node.meshId}`;

    return {
      iqName: 'Mesh SDF (grilla 3D)',
      funcName: 'sdMesh',
      sizeable: true,
      sizeBase: () => size,
      call: (pVar, _params, sizeExpr) => {
        if (sizeExpr) {
          // Factor dinámico: k = spsize / maxDim
          const v = { x: s.x / maxDim, y: s.y / maxDim, z: s.z / maxDim };
          if (uniform) {
            const k = `(${sizeExpr} * ${fmtPrecise(v.x)})`;
            return `${fn}(${pVar} / ${k}) * ${k}`;
          }
          return `${fn}(${pVar} / (${sizeExpr} * ${vec3Precise(v)})) * (${sizeExpr} * ${fmtPrecise(Math.min(v.x, v.y, v.z))})`;
        }
        const k = size / maxDim;
        const S = { x: k * s.x, y: k * s.y, z: k * s.z };
        if (uniform) {
          if (isOne(S.x)) return `${fn}(${pVar})`;
          return `${fn}(${pVar} / ${fmtPrecise(S.x)}) * ${fmtPrecise(S.x)}`;
        }
        return `${fn}(${pVar} / ${vec3Precise(S)}) * ${fmtPrecise(Math.min(S.x, S.y, S.z))}`;
      }
    };
  }

  // --------------------------------------------------------------------------
  // Modo triángulos ("GLSL completo"): la malla va dentro del código como triángulos.
  // GLSL ES 1.00 puro (sin texturas ni arrays): distancia exacta (udTriangle de iq, al cuadrado)
  // y signo por winding number (suma de ángulos sólidos, Van Oosterom–Strackee): ±4π adentro, 0 afuera.
  //
  // Pensado para compilar rápido también en Windows (ANGLE -> Direct3D), que copia cada función
  // en cada llamada y desenrolla los bucles de largo conocido:
  //  - meshTri aparece UNA sola vez, dentro de un bucle; los vértices del triángulo i salen de un
  //    árbol binario de ifs (meshTriData_<id>), que son solo asignaciones;
  //  - los bucles cortan con un 'break' que depende de 'time' (siempre n = N en la práctica),
  //    así el compilador no los desenrolla;
  //  - normal() usa el tetraedro en un bucle (de() aparece una vez, no cuatro);
  //  - atan aproximado (error ~0.01 rad): el signo solo compara la suma con 2π (adentro ≈ 4π, afuera ≈ 0).
  // Medido en Chrome/D3D11: 80 triángulos compilan en ~0.4 s (escritos uno por línea: 2.2 s y creciendo).
  // --------------------------------------------------------------------------
  const MESH_TRI_HELPER = `// atan2 aproximado (error ~0.01 rad), suficiente para el winding number
float meshAtan2(float y, float x)
{
    float ax = abs(x), ay = abs(y);
    float a = min(ax, ay) / max(max(ax, ay), 1e-20);
    float s = a * a;
    float r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
    r = ay > ax ? 1.57079637 - r : r;
    r = x < 0.0 ? 3.14159274 - r : r;
    return y < 0.0 ? -r : r;
}

// Triángulo de malla: acumula distancia^2 mínima (iq udTriangle) y ángulo sólido (winding number)
void meshTri(vec3 p, vec3 a, vec3 b, vec3 c, inout float d2, inout float w)
{
    vec3 ba = b - a; vec3 pa = p - a;
    vec3 cb = c - b; vec3 pb = p - b;
    vec3 ac = a - c; vec3 pc = p - c;
    vec3 nor = cross(ba, ac);
    float t;
    if (sign(dot(cross(ba, nor), pa)) + sign(dot(cross(cb, nor), pb)) + sign(dot(cross(ac, nor), pc)) < 2.0)
    {
        vec3 e1 = ba * clamp(dot(ba, pa) / dot(ba, ba), 0.0, 1.0) - pa;
        vec3 e2 = cb * clamp(dot(cb, pb) / dot(cb, cb), 0.0, 1.0) - pb;
        vec3 e3 = ac * clamp(dot(ac, pc) / dot(ac, ac), 0.0, 1.0) - pc;
        t = min(min(dot(e1, e1), dot(e2, e2)), dot(e3, e3));
    }
    else
    {
        float h = dot(nor, pa);
        t = h * h / dot(nor, nor);
    }
    d2 = min(d2, t);
    float la = length(pa), lb = length(pb), lc = length(pc);
    w += 2.0 * meshAtan2(dot(pa, cross(pb, pc)), la * lb * lc + dot(pa, pb) * lc + dot(pa, pc) * lb + dot(pb, pc) * la);
}`;

  // normal() del modo triángulos: tetraedro en un bucle, de() aparece una sola vez en el código.
  const NORMAL_LOOP = `vec3 normal(vec3 p)
{
    vec3 n = vec3(0.0);
    int n4 = 4 + int(min(time, 0.0)); // siempre 4: evita que el compilador desenrolle el bucle
    for (int i = 0; i < 4; i++)
    {
        if (i >= n4) break;
        vec3 e = (i == 0) ? vec3(1.0, -1.0, -1.0) : (i == 1) ? vec3(-1.0, -1.0, 1.0) : (i == 2) ? vec3(-1.0, 1.0, -1.0) : vec3(1.0, 1.0, 1.0);
        n += e * de(p + e * det);
    }
    return normalize(n);
}`;

  // Número corto pero preciso (6 cifras significativas) como literal GLSL válido.
  function fmtCompact(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || Math.abs(num) < 1e-9) return '0.0';
    let s = String(Number(num.toPrecision(6)));
    if (!/[.e]/.test(s)) s += '.0';
    return s;
  }

  /** Cantidad de triángulos útiles (no degenerados) de un Float32Array de posiciones. */
  function countMeshTriangles(tris) {
    return listMeshTriangles(tris).length;
  }

  function listMeshTriangles(tris) {
    const out = [];
    for (let i = 0; i + 8 < tris.length; i += 9) {
      const a = [tris[i], tris[i + 1], tris[i + 2]];
      const b = [tris[i + 3], tris[i + 4], tris[i + 5]];
      const c = [tris[i + 6], tris[i + 7], tris[i + 8]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cx = u[1] * v[2] - u[2] * v[1], cy = u[2] * v[0] - u[0] * v[2], cz = u[0] * v[1] - u[1] * v[0];
      if (Math.hypot(cx, cy, cz) > 1e-12) out.push([a, b, c]); // descartar degenerados (división por cero en GLSL)
    }
    return out;
  }

  function generateMeshTrianglesFunction(meshId, info) {
    const fn = `sdMesh_${meshId}`;
    const dataFn = `meshTriData_${meshId}`;
    const label = String(info.name || meshId).replace(/[\r\n]+/g, ' ');
    const tris = listMeshTriangles(info.triangles);
    const N = tris.length;
    if (N === 0) {
      return `float ${fn}(vec3 p)
{
    // Malla '${label}': sin triángulos válidos
    return 1000.0;
}`;
    }
    const v3 = p => `vec3(${fmtCompact(p[0])}, ${fmtCompact(p[1])}, ${fmtCompact(p[2])})`;
    // Árbol binario: log2(N) comparaciones por triángulo y solo asignaciones (barato de compilar)
    function tree(lo, hi, ind) {
      if (lo === hi) {
        const [a, b, c] = tris[lo];
        return `${ind}a = ${v3(a)}; b = ${v3(b)}; c = ${v3(c)};`;
      }
      const mid = (lo + hi) >> 1;
      return `${ind}if (i <= ${mid})\n${ind}{\n${tree(lo, mid, ind + '    ')}\n${ind}}\n${ind}else\n${ind}{\n${tree(mid + 1, hi, ind + '    ')}\n${ind}}`;
    }
    const h = info.halfSize;
    const margin = 0.1 * 2 * Math.max(h.x, h.y, h.z);
    return `// Malla '${label}': triángulo i (0..${N - 1}) en espacio local (origen = centro del bounding box)
void ${dataFn}(int i, out vec3 a, out vec3 b, out vec3 c)
{
${tree(0, N - 1, '    ')}
}

float ${fn}(vec3 p)
{
    // Malla '${label}': ${N} triángulos exactos (sin textura)
    // Lejos del bounding box alcanza con la distancia a la caja (cota inferior: el raymarching sigue siendo seguro)
    vec3 bq = abs(p) - ${vec3Precise(h)};
    float bd = length(max(bq, 0.0));
    if (bd > ${fmtCompact(margin)}) return bd;
    float d2 = 1e10;
    float w = 0.0;
    vec3 a, b, c;
    int n = ${N} + int(min(time, 0.0)); // siempre ${N}: evita que el compilador desenrolle el bucle
    for (int i = 0; i < ${N}; i++)
    {
        if (i >= n) break;
        ${dataFn}(i, a, b, c);
        meshTri(p, a, b, c, d2, w);
    }
    // Winding number = w / 4π: ~1 adentro, ~0 afuera
    return (abs(w) > 6.2831853 ? -1.0 : 1.0) * sqrt(d2);
}`;
  }

  // --------------------------------------------------------------------------
  // Modo red neuronal: SIREN entrenada en js/neural-sdf-worker.js, escrita como GLSL ES 1.00 puro.
  // Cada capa es sin(W x + b) en bloques de 4 neuronas (mat4 * vec4); los pesos van como literales,
  // así que no hay texturas ni arrays. Compila rápido (código lineal, sin bucles ni datos que buscar).
  // La salida solo es confiable dentro de ±band y su pendiente puede pasar de 1: se recorta y se
  // divide por la pendiente medida (lipschitz) para que el raymarching nunca atraviese la superficie.
  // --------------------------------------------------------------------------
  function generateMeshNeuralFunction(meshId, info) {
    const fn = `sdMesh_${meshId}`;
    const label = String(info.name || meshId).replace(/[\r\n]+/g, ' ');
    const net = info.neural;
    const L = net.layers;
    const num = v => fmtCompact(v);
    const blocks = n => Math.ceil(n / 4);
    // W[o * nin + i]; fuera de rango (relleno a múltiplo de 4) vale 0
    const w = (layer, o, i) => (o < layer.nout && i < layer.nin ? layer.W[o * layer.nin + i] : 0);
    const bias = (layer, o) => (o < layer.nout ? layer.b[o] : 0);
    // mat4 en orden de columnas: columna j = entrada (4*bi + j), fila r = salida (4*bo + r)
    const mat = (layer, bo, bi, biasColumn) => {
      const v = [];
      for (let j = 0; j < 4; j++) {
        for (let r = 0; r < 4; r++) {
          const o = 4 * bo + r;
          v.push(biasColumn && j === 3 ? bias(layer, o) : w(layer, o, 4 * bi + j));
        }
      }
      return `mat4(${v.map(num).join(', ')})`;
    };
    const lines = [];
    // Capa de entrada (3 -> H): el bias va en la 4ª columna, con q.w = 1
    const first = L[0];
    for (let bo = 0; bo < blocks(first.nout); bo++) lines.push(`    vec4 a0_${bo} = sin(${mat(first, bo, 0, true)} * q);`);
    // Capas ocultas (H -> H)
    for (let l = 1; l < L.length - 1; l++) {
      const layer = L[l];
      for (let bo = 0; bo < blocks(layer.nout); bo++) {
        const terms = [];
        for (let bi = 0; bi < blocks(layer.nin); bi++) terms.push(`${mat(layer, bo, bi, false)} * a${l - 1}_${bi}`);
        const b = [0, 1, 2, 3].map(r => num(bias(layer, 4 * bo + r))).join(', ');
        lines.push(`    vec4 a${l}_${bo} = sin(${terms.join('\n        + ')}\n        + vec4(${b}));`);
      }
    }
    // Salida lineal (H -> 1)
    const out = L[L.length - 1];
    const lastIdx = L.length - 2;
    const dots = [];
    for (let bi = 0; bi < blocks(out.nin); bi++) {
      const v = [0, 1, 2, 3].map(j => num(w(out, 0, 4 * bi + j))).join(', ');
      dots.push(`dot(vec4(${v}), a${lastIdx}_${bi})`);
    }
    lines.push(`    float y = ${dots.join('\n        + ')}\n        + ${num(out.b[0])};`);

    const h = info.halfSize;
    const margin = 0.1 * 2 * Math.max(h.x, h.y, h.z);
    const m = net.metrics || {};
    return `float ${fn}(vec3 p)
{
    // Malla '${label}': red neuronal ${net.arch || ''} (SIREN), aproximación del SDF sin textura
    // Error medio cerca de la superficie: ${num(m.meanErr || 0)} · signo equivocado: ${(m.signErrPct || 0).toFixed(2)} %
    // Lejos del bounding box alcanza con la distancia a la caja (cota inferior: el raymarching sigue siendo seguro)
    vec3 bq = abs(p) - ${vec3Precise(h)};
    float bd = length(max(bq, 0.0));
    if (bd > ${num(margin)}) return bd;
    vec4 q = vec4(p * ${num(1 / net.scale)}, 1.0);
${lines.join('\n')}
    // Salida recortada a la banda entrenada y dividida por la pendiente medida
    return clamp(y, -${num(net.band)}, ${num(net.band)}) * ${num(net.scale / net.lipschitz)};
}`;
  }

  /**
   * info = { name, status: 'ready' | 'baking' | 'error', halfSize: {x,y,z},
   *          grid?: { min: {x,y,z} (local), size: {x,y,z}, dims: [nx, ny, nz] },
   *          triangles?: Float32Array (local, para exportar),
   *          neural?: { layers, scale, band, lipschitz, metrics, arch } (red entrenada),
   *          view?: 'grid' | 'neural' (qué dibuja el editor) }
   * mode: 'grid' (editor) | 'export' (GLSL completo: red si hay, si no triángulos; sin texturas)
   */
  function meshRepresentation(info, mode) {
    if (!info) return 'missing';
    if (mode === 'export') return info.neural ? 'neural' : info.triangles ? 'triangles' : 'grid';
    return info.view === 'neural' && info.neural ? 'neural' : 'grid';
  }

  /** Devuelve { uniform, glsl }. */
  function generateMeshFunction(meshId, info, mode = 'grid') {
    const fn = `sdMesh_${meshId}`;
    const label = String(info?.name || meshId).replace(/[\r\n]+/g, ' ');
    const rep = meshRepresentation(info, mode);
    if (rep === 'neural') return { uniform: null, glsl: generateMeshNeuralFunction(meshId, info) };
    if (rep === 'triangles') return { uniform: null, glsl: generateMeshTrianglesFunction(meshId, info) };
    if (!info) {
      return {
        uniform: null,
        glsl: `float ${fn}(vec3 p)
{
    // Malla '${label}' no encontrada (¿se quitó?): no aporta geometría
    return 1000.0;
}`
      };
    }
    if (info.status === 'ready' && info.grid) {
      const { min, size, dims } = info.grid;
      return {
        uniform: `uniform highp sampler3D uMeshSdf_${meshId};`,
        glsl: `float ${fn}(vec3 p)
{
    // Malla '${label}': SDF en grilla ${dims[0]}x${dims[1]}x${dims[2]} (textura 3D R16F)
    const vec3 gmin = ${vec3Precise(min)};
    const vec3 gsize = ${vec3Precise(size)};
    const vec3 res = vec3(${fmt(dims[0])}, ${fmt(dims[1])}, ${fmt(dims[2])});
    vec3 q = clamp(p, gmin, gmin + gsize);
    // Trilineal manual con texelFetch: el filtrado por hardware interpola con pesos de ~8 bits
    // y las normales (diferencias finitas de 'det') salen granuladas.
    vec3 g = (q - gmin) / gsize * (res - 1.0);
    ivec3 i = ivec3(min(floor(g), res - 2.0));
    vec3 f = g - vec3(i);
    float c000 = texelFetch(uMeshSdf_${meshId}, i, 0).r;
    float c100 = texelFetch(uMeshSdf_${meshId}, i + ivec3(1, 0, 0), 0).r;
    float c010 = texelFetch(uMeshSdf_${meshId}, i + ivec3(0, 1, 0), 0).r;
    float c110 = texelFetch(uMeshSdf_${meshId}, i + ivec3(1, 1, 0), 0).r;
    float c001 = texelFetch(uMeshSdf_${meshId}, i + ivec3(0, 0, 1), 0).r;
    float c101 = texelFetch(uMeshSdf_${meshId}, i + ivec3(1, 0, 1), 0).r;
    float c011 = texelFetch(uMeshSdf_${meshId}, i + ivec3(0, 1, 1), 0).r;
    float c111 = texelFetch(uMeshSdf_${meshId}, i + ivec3(1, 1, 1), 0).r;
    float d = mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
                  mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
    // Fuera de la grilla: distancia a la grilla + valor muestreado en el borde
    return d + length(p - q);
}`
      };
    }
    // Generando (o falló): la caja del bounding box como marcador
    return {
      uniform: null,
      glsl: `float ${fn}(vec3 p)
{
    // Malla '${label}': SDF ${info.status === 'error' ? 'con error' : 'en generación'}, se usa su bounding box
    vec3 q = abs(p) - ${vec3Precise(info.halfSize)};
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}`
    };
  }

  function generateNodeCode(node, idx, meshInfos = {}) {
    const n = idx + 1;
    const pVar = `p${n}`;
    const dVar = `geo${n}`;
    const colVar = `col${n}`;
    const prim = node.type === 'mesh' ? meshPrimitive(node, meshInfos[node.meshId]) : (PRIMITIVES[node.type] || PRIMITIVES.sphere);
    const lines = [];

    lines.push(`    // --- [SDF #${n}: ${node.name} (${prim.iqName})] ---`);
    lines.push(`    vec3 ${pVar} = p;`);

    // 1. Translation (Position - note: subtracting position moves the shape to +position in world space)
    const px = Number(node.position.x) || 0;
    const py = Number(node.position.y) || 0;
    const pz = Number(node.position.z) || 0;
    if (px !== 0 || py !== 0 || pz !== 0) {
      lines.push(`    ${pVar} -= vec3(${fmt(px)}, ${fmt(py)}, ${fmt(pz)});`);
    }

    // 2. Time linear translation (like p.z += time*10.0; p.x += time; p.y += time;)
    const vx = Number(node.linearVel.x) || 0;
    const vy = Number(node.linearVel.y) || 0;
    const vz = Number(node.linearVel.z) || 0;
    if (vx !== 0) lines.push(`    ${pVar}.x += time * ${fmt(vx)};`);
    if (vy !== 0) lines.push(`    ${pVar}.y += time * ${fmt(vy)};`);
    if (vz !== 0) lines.push(`    ${pVar}.z += time * ${fmt(vz)};`);

    // 3. Rotation (static + animated with time via rotate2d)
    const rx = Number(node.rot.x) || 0;
    const ry = Number(node.rot.y) || 0;
    const rz = Number(node.rot.z) || 0;
    const rsx = Number(node.rotSpeed.x) || 0;
    const rsy = Number(node.rotSpeed.y) || 0;
    const rsz = Number(node.rotSpeed.z) || 0;

    if (ry !== 0 || rsy !== 0) {
      const expr = (ry !== 0 && rsy !== 0) ? `${fmt(ry)} + time * ${fmt(rsy)}` : (rsy !== 0 ? `time * ${fmt(rsy)}` : fmt(ry));
      lines.push(`    ${pVar}.xz *= rotate2d(${expr});`);
    }
    if (rx !== 0 || rsx !== 0) {
      const expr = (rx !== 0 && rsx !== 0) ? `${fmt(rx)} + time * ${fmt(rsx)}` : (rsx !== 0 ? `time * ${fmt(rsx)}` : fmt(rx));
      lines.push(`    ${pVar}.yz *= rotate2d(${expr});`);
    }
    if (rz !== 0 || rsz !== 0) {
      const expr = (rz !== 0 && rsz !== 0) ? `${fmt(rz)} + time * ${fmt(rsz)}` : (rsz !== 0 ? `time * ${fmt(rsz)}` : fmt(rz));
      lines.push(`    ${pVar}.xy *= rotate2d(${expr});`);
    }

    // 4. Domain Symmetry / Mirror (opSymX, opSymY, opSymZ)
    const dom = node.domain || {};
    if (dom.symX || dom.symY || dom.symZ) {
      if (dom.symX) lines.push(`    ${pVar}.x = abs(${pVar}.x) - ${fmt(dom.symOffset?.x || 0)};`);
      if (dom.symY) lines.push(`    ${pVar}.y = abs(${pVar}.y) - ${fmt(dom.symOffset?.y || 0)};`);
      if (dom.symZ) lines.push(`    ${pVar}.z = abs(${pVar}.z) - ${fmt(dom.symOffset?.z || 0)};`);
    }

    // 5. Domain Subdivision / Repetition (Infinite, Finite, Polar)
    let hasIndexVars = false;
    const idxX = `indexx_${n}`;
    const idxY = `indexy_${n}`;
    const idxZ = `indexz_${n}`;

    if (dom.repMode === 'infinite') {
      hasIndexVars = true;
      const msx = Math.max(0.1, Number(dom.ms?.x) || 10.0);
      const msy = Math.max(0.1, Number(dom.ms?.y) || 10.0);
      const msz = Math.max(0.1, Number(dom.ms?.z) || 5.0);

      lines.push(`    // Subdivisión de Dominio Infinita + Índices Espaciales`);
      lines.push(`    float ${idxX} = floor(${pVar}.x / ${fmt(msx)});`);
      lines.push(`    float ${idxY} = floor(${pVar}.y / ${fmt(msy)});`);
      lines.push(`    float ${idxZ} = floor(${pVar}.z / ${fmt(msz)});`);

      if (dom.repAxes?.x !== false) lines.push(`    ${pVar}.x = mod(${pVar}.x, ${fmt(msx)}) - ${fmt(msx)} / 2.0;`);
      if (dom.repAxes?.y !== false) lines.push(`    ${pVar}.y = mod(${pVar}.y, ${fmt(msy)}) - ${fmt(msy)} / 2.0;`);
      if (dom.repAxes?.z !== false) lines.push(`    ${pVar}.z = mod(${pVar}.z, ${fmt(msz)}) - ${fmt(msz)} / 2.0;`);

      if (dom.indexWaveEnabled) {
        const tAxis = dom.indexWaveTargetAxis || 'x';
        const sAxis = dom.indexWaveSourceAxis || 'z';
        const sIdx = sAxis === 'x' ? idxX : (sAxis === 'y' ? idxY : idxZ);
        lines.push(`    ${pVar}.${tAxis} += sin(${sIdx} * ${fmt(dom.indexWaveFreq)} + time * ${fmt(dom.indexWaveSpeed)}) * ${fmt(dom.indexWaveAmp)};`);
      }
    } else if (dom.repMode === 'finite') {
      const sx = Math.max(0.1, Number(dom.limPeriod?.x) || 3.0);
      const sy = Math.max(0.1, Number(dom.limPeriod?.y) || 3.0);
      const sz = Math.max(0.1, Number(dom.limPeriod?.z) || 3.0);
      const lmin = `vec3(${fmt(dom.limMin?.x || 0)}, ${fmt(dom.limMin?.y || 0)}, ${fmt(dom.limMin?.z || 0)})`;
      const lmax = `vec3(${fmt(dom.limMax?.x || 0)}, ${fmt(dom.limMax?.y || 0)}, ${fmt(dom.limMax?.z || 0)})`;
      lines.push(`    // Subdivisión de Dominio Finita (opRepLim)`);
      lines.push(`    vec3 s_${n} = vec3(${fmt(sx)}, ${fmt(sy)}, ${fmt(sz)});`);
      lines.push(`    ${pVar} = ${pVar} - s_${n} * clamp(round3(${pVar} / s_${n}), -${lmin}, ${lmax});`);
    } else if (dom.repMode === 'polar') {
      const count = Math.max(1.0, Number(dom.polarCount) || 6.0);
      const plane = dom.polarPlane || 'xz';
      const rOff = Number(dom.polarRadiusOffset) || 0.0;
      lines.push(`    // Subdivisión Polar de Dominio (opRepPolar)`);
      lines.push(`    ${pVar}.${plane} = opRepPolar(${pVar}.${plane}, ${fmt(count)});`);
      if (rOff !== 0) {
        const firstAxis = plane[0];
        lines.push(`    ${pVar}.${firstAxis} -= ${fmt(rOff)};`);
      }
    }

    // 6. Space Deformations: Twist (opTwist) & Cheap Bend (opBend)
    const mod = node.modifiers || {};
    if (mod.twistEnabled) {
      const k = Number(mod.twistAmount) || 1.0;
      const ax = mod.twistAxis || 'y';
      if (ax === 'y') {
        lines.push(`    ${pVar}.xz *= rotate2d(${pVar}.y * ${fmt(k)});`);
      } else if (ax === 'x') {
        lines.push(`    ${pVar}.yz *= rotate2d(${pVar}.x * ${fmt(k)});`);
      } else {
        lines.push(`    ${pVar}.xy *= rotate2d(${pVar}.z * ${fmt(k)});`);
      }
    }

    if (mod.bendEnabled) {
      const k = Number(mod.bendAmount) || 0.5;
      const ax = mod.bendAxis || 'x';
      if (ax === 'x') {
        lines.push(`    ${pVar}.xy *= rotate2d(${pVar}.x * ${fmt(k)});`);
      } else if (ax === 'y') {
        lines.push(`    ${pVar}.yz *= rotate2d(${pVar}.y * ${fmt(k)});`);
      } else {
        lines.push(`    ${pVar}.xz *= rotate2d(${pVar}.z * ${fmt(k)});`);
      }
    }

    // 7. Elongation (opElongate)
    let elongateCorrection = '';
    if (mod.elongateEnabled) {
      const hx = Math.max(0, Number(mod.elongate?.x) || 0);
      const hy = Math.max(0, Number(mod.elongate?.y) || 0);
      const hz = Math.max(0, Number(mod.elongate?.z) || 0);
      lines.push(`    // Elongación Exacta (opElongate)`);
      lines.push(`    vec3 q_el_${n} = abs(${pVar}) - vec3(${fmt(hx)}, ${fmt(hy)}, ${fmt(hz)});`);
      lines.push(`    ${pVar} = max(q_el_${n}, 0.0);`);
      elongateCorrection = ` + min(max(q_el_${n}.x, max(q_el_${n}.y, q_el_${n}.z)), 0.0)`;
    }

    // 8. Uniform Scale (opScale: s * primitive(p/s))
    const scale = Math.max(0.05, Number(node.scale) || 1.0);
    if (scale !== 1.0) {
      lines.push(`    ${pVar} /= ${fmt(scale)};`);
    }

    // 9. Optional Dynamic Size Modulation (e.g. spsize = 1.5 + sin(indexz*10. + time)*0.6)
    // Only primitives that declare an Arg.size(...) argument support it.
    let sizeExpr = null;
    if (node.sizeModEnabled && prim.sizeable) {
      const baseSize = prim.sizeBase(node.params);
      const ax = node.sizeModAxis || 'z';
      const idxRef = hasIndexVars
        ? (ax === 'x' ? idxX : (ax === 'y' ? idxY : idxZ))
        : `${pVar}.${ax}`;
      const sizeVar = `spsize_${n}`;
      lines.push(`    float ${sizeVar} = ${fmt(baseSize)} + sin(${idxRef} * ${fmt(node.sizeModFreq)} + time * ${fmt(node.sizeModSpeed)}) * ${fmt(node.sizeModAmp)};`);
      sizeExpr = sizeVar;
    }

    // 10. Evaluate Primitive SDF
    const callExpr = prim.call(pVar, node.params, sizeExpr);
    if (scale !== 1.0) {
      lines.push(`    float ${dVar} = (${callExpr}${elongateCorrection}) * ${fmt(scale)};`);
    } else {
      lines.push(`    float ${dVar} = ${callExpr}${elongateCorrection};`);
    }

    // 11. Distance Metric Alterations: Rounding (opRound), Onioning (opOnion), Sine Displacement (opDisplace)
    if (mod.roundEnabled && Number(mod.roundRad) !== 0) {
      lines.push(`    ${dVar} -= ${fmt(mod.roundRad)}; // opRound`);
    }

    if (mod.onionEnabled) {
      const layers = Math.max(1, Math.min(5, parseInt(mod.onionLayers) || 1));
      let th = Math.max(0.005, Number(mod.onionThickness) || 0.1);
      for (let l = 0; l < layers; l++) {
        lines.push(`    ${dVar} = abs(${dVar}) - ${fmt(th)}; // opOnion capa ${l + 1}`);
        th *= 0.5;
      }
    }

    if (mod.displaceEnabled) {
      const freq = Number(mod.displaceFreq) || 5.0;
      const amp = Number(mod.displaceAmp) || 0.08;
      const spd = Number(mod.displaceSpeed) || 0.0;
      const tTerm = spd !== 0 ? ` + time * ${fmt(spd)}` : '';
      lines.push(`    ${dVar} += sin(${fmt(freq)} * ${pVar}.x${tTerm}) * sin(${fmt(freq)} * ${pVar}.y${tTerm}) * sin(${fmt(freq)} * ${pVar}.z${tTerm}) * ${fmt(amp)};`);
    }

    // 12. Node Color Expression
    const cc = node.colorConfig || {};
    const c1 = hexToVec3(cc.color1 || '#ff3366');
    const c2 = hexToVec3(cc.color2 || '#00ffff');

    if (cc.mode === 'indexWave') {
      const ax = cc.waveIndexAxis || 'x';
      const idxRef = hasIndexVars
        ? (ax === 'x' ? idxX : (ax === 'y' ? idxY : idxZ))
        : `floor(${pVar}.${ax})`;
      lines.push(`    vec3 ${colVar} = mix(${c1}, ${c2}, sin(${idxRef} * ${fmt(cc.waveFreq)} + time * ${fmt(cc.waveSpeed)}) * 0.5 + 0.5);`);
    } else if (cc.mode === 'normalGrad') {
      lines.push(`    vec3 ${colVar} = mix(${c1}, ${c2}, clamp(${pVar}.y * 0.5 + 0.5, 0.0, 1.0));`);
    } else if (cc.mode === 'distanceMix') {
      lines.push(`    vec3 ${colVar} = mix(${c1}, ${c2}, clamp(${dVar}, 0.0, 1.0));`);
    } else {
      lines.push(`    vec3 ${colVar} = ${c1};`);
    }

    return {
      lines,
      dVar,
      colVar,
      node
    };
  }

  /**
   * scene -> código GLSL ES 3.00 completo.
   * options.meshes: { [meshId]: info } para los nodos de tipo 'mesh' (ver generateMeshFunction).
   * Se pasa como parámetro para que el generador siga siendo puro (sin leer SDFMeshStore).
   */
  function generateMasterShader(scene, options = {}) {
    const g = scene.globals;
    const meshInfos = options.meshes || {};
    // Un nodo malla con id inválido se descarta (el id termina en un identificador GLSL).
    const enabledNodes = scene.nodes.filter(n => n.enabled && (n.type !== 'mesh' || isValidMeshId(n.meshId)));

    // Determine which helpers and primitives are used.
    // usedHelpers = helpers that must be emitted BEFORE the primitives (primitive deps + domain ops).
    const usedHelpers = new Set();
    const usedPrimitives = new Set(['sphere', 'box']); // Always include sphere & sdBox from base shader

    enabledNodes.forEach(node => {
      usedPrimitives.add(node.type);
      const prim = PRIMITIVES[node.type];
      if (prim && prim.dependencies) {
        prim.dependencies.forEach(dep => usedHelpers.add(dep));
      }
      if (node.operation === 'xor') usedHelpers.add('opXor');
      if (node.domain?.repMode === 'finite') usedHelpers.add('sdRound3');
      if (node.domain?.repMode === 'polar') usedHelpers.add('opRepPolar');
    });
    if (g.globalDomain?.repMode === 'polar') usedHelpers.add('opRepPolar');
    if (g.globalDomain?.repMode === 'finite') usedHelpers.add('sdRound3');

    // Assemble primitive & helper definitions block
    const funcBlocks = [];

    // Helpers needed before primitives (resolved with their own dependencies)
    for (const usedPrimitive of usedPrimitives) {
      PRIMITIVES[usedPrimitive]?.dependencies.forEach(dep => usedHelpers.add(dep));
    }
    const preHelpers = resolveHelpers([...usedHelpers]);
    preHelpers.forEach(h => funcBlocks.push(GLSL_HELPERS[h]));

    // Primitives
    usedPrimitives.forEach(pKey => {
      if (PRIMITIVES[pKey]) {
        funcBlocks.push(PRIMITIVES[pKey].glsl);
      }
    });

    // Imported meshes (one function + optional sampler3D uniform per referenced mesh)
    // options.meshMode: 'grid' (editor: textura 3D, o la red si la malla tiene view 'neural')
    //                 | 'export' (GLSL completo, sin texturas: red neuronal si hay, si no triángulos)
    const meshMode = options.meshMode === 'export' || options.meshMode === 'triangles' ? 'export' : 'grid';
    const meshUniforms = [];
    const usedMeshIds = [...new Set(enabledNodes.filter(n => n.type === 'mesh').map(n => n.meshId))];
    const meshReps = usedMeshIds.map(id => meshRepresentation(meshInfos[id], meshMode));
    if (meshReps.includes('triangles')) funcBlocks.push(MESH_TRI_HELPER);
    // Red o triángulos: normal() en bucle para que de() aparezca una sola vez (compila mucho más rápido)
    const triangleMeshes = meshReps.includes('triangles') || meshReps.includes('neural');
    usedMeshIds.forEach(meshId => {
      const { uniform, glsl } = generateMeshFunction(meshId, meshInfos[meshId], meshMode);
      if (uniform) meshUniforms.push(uniform);
      funcBlocks.push(glsl);
    });
    const meshUniformBlock = meshUniforms.length ? '\n' + meshUniforms.join('\n') : '';

    // Standard combination & rotation functions from user's base template (always emitted,
    // unless a primitive already pulled them in above)
    resolveHelpers(CORE_HELPERS)
      .filter(h => !preHelpers.includes(h))
      .forEach(h => funcBlocks.push(GLSL_HELPERS[h]));

    // Build de(vec3 p) body
    const deLines = [];

    // Optional Global Domain Transformation
    const gd = g.globalDomain || {};
    if (gd.rotateWithTime) {
      deLines.push(`    // Rotación Global del Dominio`);
      if (gd.rotSpeedXZ) deLines.push(`    p.xz *= rotate2d(time * ${fmt(gd.rotSpeedXZ)});`);
      if (gd.rotSpeedXY) deLines.push(`    p.xy *= rotate2d(time * ${fmt(gd.rotSpeedXY)});`);
    }
    if (gd.symX) deLines.push(`    p.x = abs(p.x);`);
    if (gd.symY) deLines.push(`    p.y = abs(p.y);`);
    if (gd.symZ) deLines.push(`    p.z = abs(p.z);`);

    if (gd.repMode === 'infinite') {
      const gmsx = Math.max(0.5, Number(gd.ms?.x) || 12.0);
      const gmsy = Math.max(0.5, Number(gd.ms?.y) || 12.0);
      const gmsz = Math.max(0.5, Number(gd.ms?.z) || 12.0);
      deLines.push(`    // Repetición Espacial Global del Dominio`);
      if (gd.repAxes?.x) deLines.push(`    p.x = mod(p.x + ${fmt(gmsx * 0.5)}, ${fmt(gmsx)}) - ${fmt(gmsx * 0.5)};`);
      if (gd.repAxes?.y) deLines.push(`    p.y = mod(p.y + ${fmt(gmsy * 0.5)}, ${fmt(gmsy)}) - ${fmt(gmsy * 0.5)};`);
      if (gd.repAxes?.z) deLines.push(`    p.z = mod(p.z + ${fmt(gmsz * 0.5)}, ${fmt(gmsz)}) - ${fmt(gmsz * 0.5)};`);
    } else if (gd.repMode === 'polar') {
      deLines.push(`    // Repetición Polar Global del Dominio`);
      deLines.push(`    p.xz = opRepPolar(p.xz, ${fmt(gd.polarCount || 6.0)});`);
    }

    if (enabledNodes.length === 0) {
      deLines.push(`    float d = 100.0;`);
      deLines.push(`    objcol = vec3(0.2);`);
    } else {
      enabledNodes.forEach((node, idx) => {
        const compiled = generateNodeCode(node, idx, meshInfos);
        deLines.push(...compiled.lines);

        const dVar = compiled.dVar;
        const colVar = compiled.colVar;
        const k = fmt(Math.max(0.001, Number(node.smoothK) || 0.25));
        const blendStyle = node.colorConfig?.blendStyle || 'auto';

        if (idx === 0) {
          deLines.push(`    float d = ${dVar};`);
          deLines.push(`    objcol = ${colVar};`);
        } else {
          const op = node.operation || 'smoothUnion';
          const prevD = `d_prev_${idx}`;
          deLines.push(`    float ${prevD} = d;`);

          if (op === 'union') {
            deLines.push(`    d = min(d, ${dVar});`);
            if (blendStyle === 'auto') {
              deLines.push(`    objcol = (${dVar} < ${prevD}) ? ${colVar} : objcol;`);
            }
          } else if (op === 'subtraction') {
            if (node.swapOrder) {
              deLines.push(`    d = max(-${prevD}, ${dVar});`);
            } else {
              deLines.push(`    d = max(${prevD}, -${dVar});`);
            }
            if (blendStyle === 'auto') {
              deLines.push(`    objcol = (abs(${dVar}) < abs(${prevD})) ? ${colVar} : objcol;`);
            }
          } else if (op === 'intersection') {
            deLines.push(`    d = max(d, ${dVar});`);
            if (blendStyle === 'auto') {
              deLines.push(`    objcol = (${dVar} > ${prevD}) ? ${colVar} : objcol;`);
            }
          } else if (op === 'xor') {
            deLines.push(`    d = opXor(d, ${dVar});`);
            if (blendStyle === 'auto') {
              deLines.push(`    objcol = (${dVar} < ${prevD}) ? ${colVar} : objcol;`);
            }
          } else if (op === 'smoothUnion') {
            deLines.push(`    float h_${idx} = clamp(0.5 + 0.5 * (${prevD} - ${dVar}) / (${k} * 4.0), 0.0, 1.0);`);
            deLines.push(`    d = opSmoothUnion(d, ${dVar}, ${k});`);
            if (blendStyle === 'auto') {
              deLines.push(`    objcol = mix(objcol, ${colVar}, h_${idx});`);
            }
          } else if (op === 'smoothSubtraction') {
            if (node.swapOrder) {
              deLines.push(`    d = opSmoothSubtraction(${prevD}, ${dVar}, ${k});`);
            } else {
              deLines.push(`    d = opSmoothSubtraction(${dVar}, ${prevD}, ${k});`);
            }
            if (blendStyle === 'auto') {
              deLines.push(`    float h_${idx} = clamp(0.5 - 0.5 * (${prevD} + ${dVar}) / (${k} * 4.0), 0.0, 1.0);`);
              deLines.push(`    objcol = mix(objcol, ${colVar}, h_${idx});`);
            }
          } else if (op === 'smoothIntersection') {
            deLines.push(`    d = opSmoothIntersection(d, ${dVar}, ${k});`);
            if (blendStyle === 'auto') {
              deLines.push(`    float h_${idx} = clamp(0.5 - 0.5 * (${prevD} - ${dVar}) / (${k} * 4.0), 0.0, 1.0);`);
              deLines.push(`    objcol = mix(objcol, ${colVar}, h_${idx});`);
            }
          }

          if (blendStyle === 'rawDistanceMix') {
            deLines.push(`    objcol = mix(objcol, vec3(1.0, 0.0, 0.0), ${dVar});`);
            deLines.push(`    objcol = ${colVar};`);
          } else if (blendStyle === 'override') {
            deLines.push(`    objcol = ${colVar};`);
          }
        }
        deLines.push(``);
      });
    }

    const stepFactor = Number(g.stepFactor) || 1.0;
    const returnExpr = stepFactor === 1.0 ? `d` : `d * ${fmt(stepFactor)}`;
    deLines.push(`    return ${returnExpr};`);

    // Lighting & Background configuration
    const lx = fmt(g.lightDir?.x ?? 1.5);
    const ly = fmt(g.lightDir?.y ?? 1.0);
    const lz = fmt(g.lightDir?.z ?? -1.0);
    const amb = fmt(g.ambient ?? 0.1);
    const specPow = fmt(g.specPower ?? 20.0);
    const specInt = fmt(g.specIntensity ?? 0.7);
    const bgCol = hexToVec3(g.bgColor || '#000000');

    let bgBranch = `        col = ${bgCol};`;
    if (g.bgStyle === 'scanlines') {
      bgBranch = `        col = mod(gl_FragCoord.y, 10.0) * ${bgCol} * 0.15;`;
    } else if (g.bgStyle === 'gradient') {
      bgBranch = `        col = mix(${bgCol}, ${bgCol} * 2.5 + vec3(0.05, 0.08, 0.14), gl_FragCoord.y / resolution.y);`;
    }

    // Camera setup in main(void)
    const cam = g.camera || { pos: { x: 0, y: 0, z: -10 }, yaw: 0, pitch: 0, fov: 1.0 };
    const camPosStr = `vec3(${fmt(cam.pos.x)}, ${fmt(cam.pos.y)}, ${fmt(cam.pos.z)})`;
    const yaw = Number(cam.yaw) || 0;
    const pitch = Number(cam.pitch) || 0;
    const fov = fmt(Number(cam.fov) || 1.0);

    const camRotLines = [];
    if (Math.abs(pitch) > 0.0001) {
      camRotLines.push(`    dir.yz *= rotate2d(${fmt(pitch)});`);
    }
    if (Math.abs(yaw) > 0.0001) {
      camRotLines.push(`    dir.xz *= rotate2d(${fmt(yaw)});`);
    }
    const camRotBlock = camRotLines.length > 0 ? '\n' + camRotLines.join('\n') : '';

    // GLSL ES 3.00 solo si hace falta (sampler3D/texelFetch de una malla lista). Si no, GLSL ES 1.00
    // como siempre: así el código pegado en editores WebGL1 (que anteponen su propio encabezado) sigue andando.
    const glsl300 = meshUniforms.length > 0;
    const header = glsl300
      ? `#version 300 es
precision highp float;
precision highp sampler3D;`
      : `#ifdef GL_ES
precision mediump float;
#endif`;
    const fragOut = glsl300 ? 'fragColor' : 'gl_FragColor';

    return `${header}

uniform float time;
uniform vec2 resolution;
uniform sampler2D backbuffer;${meshUniformBlock}${glsl300 ? '\nout vec4 fragColor;' : ''}

// ============================================================================
// IQ-SDF SUPREME ENGINE - SHADER MAESTRO
// Basado en: https://iquilezles.org/articles/distfunctions/
// ============================================================================

// VARIABLES GLOBALES
float det = ${fmt(g.det || 0.001)};
float maxdist = ${fmt(g.maxdist || 100.0)};
const int maxsteps = ${Math.max(10, Math.min(500, parseInt(g.maxsteps) || 100))};

vec3 objcol = vec3(0.0);

// FUNCIONES DE DISTANCIA PRIMITIVAS Y OPERADORES IQ
${funcBlocks.join('\n\n')}

// FUNCION DE ESTIMACION DE DISTANCIA
float de(vec3 p) 
{
${deLines.join('\n')}
}

// FUNCION NORMAL
${triangleMeshes ? NORMAL_LOOP : `vec3 normal(vec3 p) 
{   
    vec2 d = vec2(0.0, det);
    return normalize(vec3(de(p + d.yxx), de(p + d.xyx), de(p + d.xxy)) - de(p));
}`}

// FUNCION SHADE
vec3 shade(vec3 p, vec3 dir) {
    vec3 lightdir = normalize(vec3(${lx}, ${ly}, ${lz})); 
    vec3 col = objcol;
    vec3 n = normal(p);
    float diff = max(0.0, dot(lightdir, n));
    vec3 refl = reflect(dir, n);
    float spec = pow(max(0.0, dot(lightdir, refl)), ${specPow});
    float amb = ${amb};
    return col*(amb + diff) + spec * ${specInt};
}

// FUNCION DE RAYMARCHING
vec3 march(vec3 from, vec3 dir) 
{
    float d, td=0.0;
    vec3 p, col;

    for (int i=0; i<maxsteps; i++) 
    {
        p = from + td * dir;
        d = de(p);
        if (d < det || td > maxdist) break;
        td += d;
    }

    if (d < det)
    {
        p -= dir * det;
        col = shade(p, dir);
    }
    else
    {
${bgBranch}
    }
    return col;    
}

// MAIN
void main(void)
{
    vec2 uv = gl_FragCoord.xy/resolution.xy - 0.5; 
    uv.x *= resolution.x / resolution.y; 
    vec3 from = ${camPosStr};
    vec3 dir = normalize(vec3(uv, ${fov}));${camRotBlock}
    vec3 col = march(from, dir);
    ${fragOut} = vec4(col, 1.0);
}`;
  }

  // Preset scenes showcasing the user's base shader + IQ's 3D SDF capabilities
  function getPresets() {
    return {
      base_user: {
        name: '1. Tu Shader Base Original (Esferas Repetidas + Máscara)',
        globals: {
          det: 0.001,
          maxdist: 100.0,
          maxsteps: 100,
          stepFactor: 0.6,
          lightDir: { x: 1.5, y: 1.0, z: -1.0 },
          ambient: 0.1,
          specPower: 20.0,
          specIntensity: 0.7,
          bgColor: '#000000',
          bgStyle: 'solid',
          camera: { pos: { x: 0.0, y: 0.0, z: -10.0 }, yaw: 0.0, pitch: 0.0, fov: 1.0 },
          globalDomain: { rotateWithTime: false, rotSpeedXZ: 0.2, rotSpeedXY: 0.2, symX: false, symY: false, symZ: false, repMode: 'none', ms: { x: 12, y: 12, z: 12 }, repAxes: { x: true, y: true, z: true }, polarCount: 6 }
        },
        nodes: [
          createNode('sphere', {
            id: 'geo1_mask',
            name: 'Máscara Esfera (geo1)',
            params: { rad: 1.0 },
            position: { x: 0.0, y: 0.0, z: -10.5 },
            operation: 'union',
            colorConfig: { mode: 'solid', color1: '#ff0000', color2: '#00ffff', blendStyle: 'auto' }
          }),
          createNode('sphere', {
            id: 'geo2_rep',
            name: 'Esferas Repetidas (geo2)',
            params: { rad: 1.0 },
            position: { x: 0.0, y: 0.0, z: 0.0 },
            linearVel: { x: 1.0, y: 1.0, z: 10.0 },
            operation: 'smoothSubtraction',
            smoothK: 3.3,
            swapOrder: true,
            domain: {
              symX: false, symY: false, symZ: false, symOffset: { x: 0, y: 0, z: 0 },
              repMode: 'infinite',
              repAxes: { x: true, y: true, z: true },
              ms: { x: 10.0, y: 10.0, z: 5.0 },
              indexWaveEnabled: false,
              indexWaveTargetAxis: 'x',
              indexWaveSourceAxis: 'z',
              indexWaveFreq: 1.0,
              indexWaveSpeed: 1.0,
              indexWaveAmp: 1.0
            },
            colorConfig: {
              mode: 'indexWave',
              color1: '#ff0000',
              color2: '#00ffff',
              waveIndexAxis: 'x',
              waveFreq: 1.0,
              waveSpeed: 2.0,
              blendStyle: 'rawDistanceMix'
            }
          })
        ]
      },

      iq_showcase: {
        name: '2. Laboratorio Supremo IQ (CSG + Polar + Smooth Blend)',
        globals: {
          det: 0.001,
          maxdist: 100.0,
          maxsteps: 120,
          stepFactor: 0.85,
          lightDir: { x: 1.5, y: 1.4, z: -1.2 },
          ambient: 0.15,
          specPower: 28.0,
          specIntensity: 0.75,
          bgColor: '#070b14',
          bgStyle: 'gradient',
          camera: { pos: { x: 0.0, y: 1.4, z: -7.5 }, yaw: 0.0, pitch: 0.15, fov: 1.0 },
          globalDomain: { rotateWithTime: false, rotSpeedXZ: 0.15, rotSpeedXY: 0.0, symX: false, symY: false, symZ: false, repMode: 'none', ms: { x: 12, y: 12, z: 12 }, repAxes: { x: true, y: true, z: true }, polarCount: 6 }
        },
        nodes: [
          createNode('roundBox', {
            name: 'Núcleo Caja Redondeada',
            params: { bx: 1.25, by: 1.25, bz: 1.25, r: 0.28 },
            rotSpeed: { x: 0.0, y: 0.35, z: 0.0 },
            operation: 'union',
            colorConfig: { mode: 'solid', color1: '#ff2a6d', color2: '#05d9e8', blendStyle: 'auto' }
          }),
          createNode('sphere', {
            name: 'Cavidad Esférica (Sustracción)',
            params: { rad: 1.62 },
            operation: 'smoothSubtraction',
            smoothK: 0.12,
            colorConfig: { mode: 'solid', color1: '#ffbe0b', color2: '#fb5607', blendStyle: 'auto' }
          }),
          createNode('torus', {
            name: 'Anillo Toroidal Giratorio',
            params: { tx: 2.35, ty: 0.24 },
            rot: { x: 0.45, y: 0.0, z: 0.2 },
            rotSpeed: { x: 0.4, y: -0.5, z: 0.0 },
            operation: 'smoothUnion',
            smoothK: 0.28,
            colorConfig: { mode: 'solid', color1: '#05d9e8', color2: '#ffffff', blendStyle: 'auto' }
          }),
          createNode('octahedron', {
            name: 'Satélites Octaedros (Dominio Polar)',
            params: { s: 0.55 },
            rotSpeed: { x: 0.0, y: 0.6, z: 0.0 },
            operation: 'smoothUnion',
            smoothK: 0.22,
            domain: {
              symX: false, symY: false, symZ: false, symOffset: { x: 0, y: 0, z: 0 },
              repMode: 'polar',
              polarCount: 8.0,
              polarPlane: 'xz',
              polarRadiusOffset: 2.95
            },
            colorConfig: { mode: 'normalGrad', color1: '#7209b7', color2: '#4cc9f0', blendStyle: 'auto' }
          })
        ]
      },

      fractal_temple: {
        name: '3. Templo de Subdivisión Infinita y BoxFrames',
        globals: {
          det: 0.001,
          maxdist: 90.0,
          maxsteps: 110,
          stepFactor: 0.75,
          lightDir: { x: 1.2, y: 1.8, z: -1.0 },
          ambient: 0.14,
          specPower: 24.0,
          specIntensity: 0.65,
          bgColor: '#090414',
          bgStyle: 'gradient',
          camera: { pos: { x: 0.0, y: 0.5, z: -8.0 }, yaw: 0.0, pitch: 0.05, fov: 0.9 },
          globalDomain: { rotateWithTime: false, rotSpeedXZ: 0.1, rotSpeedXY: 0.0, symX: false, symY: false, symZ: false, repMode: 'none', ms: { x: 10, y: 10, z: 10 }, repAxes: { x: true, y: true, z: true }, polarCount: 6 }
        },
        nodes: [
          createNode('boxFrame', {
            name: 'Marcos Repetidos (BoxFrame)',
            params: { bx: 1.5, by: 1.5, bz: 1.5, e: 0.16 },
            linearVel: { x: 0.0, y: 0.0, z: 2.5 },
            operation: 'union',
            domain: {
              symX: false, symY: false, symZ: false, symOffset: { x: 0, y: 0, z: 0 },
              repMode: 'infinite',
              repAxes: { x: true, y: true, z: true },
              ms: { x: 6.5, y: 6.5, z: 6.5 },
              indexWaveEnabled: false
            },
            colorConfig: { mode: 'indexWave', color1: '#f72585', color2: '#4cc9f0', waveIndexAxis: 'z', waveFreq: 0.8, waveSpeed: 1.5, blendStyle: 'auto' }
          }),
          createNode('deathStar', {
            name: 'Estrella Central (DeathStar)',
            params: { ra: 1.6, rb: 1.15, d: 1.85 },
            position: { x: 0.0, y: 0.0, z: -2.0 },
            rotSpeed: { x: 0.25, y: 0.6, z: 0.15 },
            operation: 'smoothUnion',
            smoothK: 0.35,
            colorConfig: { mode: 'solid', color1: '#ffbe0b', color2: '#ffffff', blendStyle: 'auto' }
          })
        ]
      },

      organic_twist: {
        name: '4. Escultura Orgánica (Twist + Onion + RepLim)',
        globals: {
          det: 0.001,
          maxdist: 80.0,
          maxsteps: 120,
          stepFactor: 0.7,
          lightDir: { x: 1.5, y: 1.2, z: -1.4 },
          ambient: 0.16,
          specPower: 32.0,
          specIntensity: 0.85,
          bgColor: '#051014',
          bgStyle: 'gradient',
          camera: { pos: { x: 0.0, y: 0.8, z: -7.0 }, yaw: 0.0, pitch: 0.1, fov: 1.0 },
          globalDomain: { rotateWithTime: false, rotSpeedXZ: 0.2, rotSpeedXY: 0.0, symX: false, symY: false, symZ: false, repMode: 'none', ms: { x: 12, y: 12, z: 12 }, repAxes: { x: true, y: true, z: true }, polarCount: 6 }
        },
        nodes: [
          createNode('hexPrism', {
            name: 'Columna Hexagonal Retorcida (opTwist)',
            params: { hx: 1.1, hy: 1.8 },
            rot: { x: 1.5708, y: 0.0, z: 0.0 },
            rotSpeed: { x: 0.0, y: 0.4, z: 0.0 },
             modifiers: {
              elongateEnabled: false, elongate: { x: 0, y: 0, z: 0 },
              roundEnabled: true, roundRad: 0.08,
              onionEnabled: false, onionThickness: 0.08, onionLayers: 1,
              twistEnabled: true, twistAxis: 'y', twistAmount: 1.35,
              bendEnabled: false, bendAxis: 'x', bendAmount: 0.3,
              displaceEnabled: false, displaceFreq: 5.0, displaceAmp: 0.06, displaceSpeed: 1.0
            },
            colorConfig: { mode: 'normalGrad', color1: '#00f5d4', color2: '#7b2cbf', blendStyle: 'auto' }
          }),
          createNode('cutHollowSphere', {
            name: 'Cuenco Esférico Hueco (CutHollowSphere)',
            params: { r: 2.1, h: 0.25, t: 0.12 },
            position: { x: 0.0, y: -0.4, z: 0.0 },
            rotSpeed: { x: 0.25, y: -0.35, z: 0.0 },
            operation: 'smoothUnion',
            smoothK: 0.25,
            colorConfig: { mode: 'solid', color1: '#ff007f', color2: '#00f5d4', blendStyle: 'auto' }
          }),
          createNode('link', {
            name: 'Eslabones Finitos (opRepLim)',
            params: { le: 0.35, r1: 0.45, r2: 0.14 },
            position: { x: 0.0, y: 0.0, z: 0.0 },
            operation: 'smoothUnion',
            smoothK: 0.18,
            domain: {
              symX: false, symY: false, symZ: false, symOffset: { x: 0, y: 0, z: 0 },
              repMode: 'finite',
              limPeriod: { x: 2.6, y: 2.0, z: 2.6 },
              limMin: { x: 1, y: 0, z: 0 },
              limMax: { x: 1, y: 0, z: 0 }
            },
            colorConfig: { mode: 'solid', color1: '#fee440', color2: '#00bbf9', blendStyle: 'auto' }
          })
        ]
      }
    };
  }

  return {
    hexToVec3,
    generateMasterShader,
    getPresets,
    countMeshTriangles
  };
})();
