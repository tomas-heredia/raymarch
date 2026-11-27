// ============================================================================
// IQ-SDF SUPREME ENGINE — Web Worker: malla -> SDF en grilla 3D (three-mesh-bvh)
//
// Los workers NO usan el import map de la página, así que three y three-mesh-bvh se
// importan con URL completa desde esm.sh, con three fijado a la misma versión (0.187.0).
//
// Mensaje de entrada: { jobId, positions: Float32Array (triángulos sin indexar, en
//   coordenadas del editor), resolution: vóxeles del eje más largo }
// Mensajes de salida:
//   { type: 'progress', jobId, progress: 0..1 }
//   { type: 'done', jobId, data: Float32Array, dims: [nx, ny, nz], min: {x,y,z}, voxel, ms }
//   { type: 'error', jobId, message }
// data[x + nx * (y + ny * z)] = distancia con signo (negativa adentro) en el punto
//   min + (x, y, z) * voxel, en coordenadas del editor.
// ============================================================================

import { BufferGeometry, BufferAttribute, Vector3, Ray, DoubleSide } from 'https://esm.sh/three@0.187.0';
import { MeshBVH } from 'https://esm.sh/three-mesh-bvh@0.10.0?deps=three@0.187.0';

// Direcciones de los rayos para decidir el signo. No alineadas con los ejes, para no
// rozar aristas ni caras paralelas a la grilla (las mallas de Blender suelen estar alineadas).
const SIGN_DIRECTIONS = [
  new Vector3(0.83, 0.47, 0.31).normalize(),
  new Vector3(-0.29, 0.86, -0.42).normalize(),
  new Vector3(0.38, -0.33, 0.86).normalize()
];

// Margen alrededor del bounding box, en fracción del eje más largo.
const MARGIN_FRACTION = 0.1;

function computeBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function bake({ jobId, positions, resolution }) {
  const t0 = performance.now();
  const res = Math.max(8, Math.min(256, Math.round(resolution) || 64));

  const { min, max } = computeBounds(positions);
  const size = max.map((v, k) => v - min[k]);
  const maxDim = Math.max(...size);
  if (!(maxDim > 0)) throw new Error('La malla no tiene volumen (todos los vértices coinciden).');

  // Vóxel cúbico: el eje más largo (con margen a ambos lados) queda con `res` muestras.
  const margin = maxDim * MARGIN_FRACTION;
  const voxel = (maxDim + 2 * margin) / (res - 1);
  const dims = size.map(s => Math.min(res, Math.ceil((s + 2 * margin) / voxel) + 1));
  // Centrar la grilla sobre el bbox en cada eje (los ejes cortos sobran un poco de margen).
  const gmin = size.map((s, k) => min[k] + s / 2 - ((dims[k] - 1) * voxel) / 2);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const bvh = new MeshBVH(geometry);

  const [nx, ny, nz] = dims;
  const data = new Float32Array(nx * ny * nz);
  const p = new Vector3();
  const ray = new Ray();
  const closest = {};
  let lastReport = 0;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        p.set(gmin[0] + x * voxel, gmin[1] + y * voxel, gmin[2] + z * voxel);
        const dist = bvh.closestPointToPoint(p, closest).distance;

        // Signo por mayoría: un rayo que primero choca una cara "de espaldas" sale desde adentro.
        let insideVotes = 0;
        for (const dir of SIGN_DIRECTIONS) {
          ray.origin.copy(p);
          ray.direction.copy(dir);
          const hit = bvh.raycastFirst(ray, DoubleSide);
          if (hit && hit.face.normal.dot(dir) > 0) insideVotes++;
        }
        data[x + nx * (y + ny * z)] = insideVotes >= 2 ? -dist : dist;
      }
    }
    const now = performance.now();
    if (now - lastReport > 100) {
      lastReport = now;
      self.postMessage({ type: 'progress', jobId, progress: (z + 1) / nz });
    }
  }

  return {
    data,
    dims,
    min: { x: gmin[0], y: gmin[1], z: gmin[2] },
    voxel,
    ms: Math.round(performance.now() - t0)
  };
}

self.onmessage = e => {
  const { jobId } = e.data;
  try {
    const result = bake(e.data);
    self.postMessage({ type: 'done', jobId, ...result }, [result.data.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', jobId, message: String(err && err.message || err) });
  }
};
