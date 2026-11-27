// ============================================================================
// Genera los modelos de prueba de /samples (pieza en "L" cerrada, 20 triángulos).
// Uso: node samples/generate-samples.js
//
// Medidas en coordenadas del editor (Y arriba): X 0..2, Y 0..3, Z 0..1.
//   l-shape.obj  -> Y arriba, coordenadas tal cual.
//   l-shape-cm.obj -> igual pero en centímetros (x100), para probar el Tamaño del nodo sdMesh.
//   l-shape.stl  -> Z arriba (como exporta Blender por defecto).
//   l-shape.glb  -> jerarquía padre/hijo con traslaciones que centran la pieza en X y Z.
// Los bounding boxes esperados están en samples/README.md.
// ============================================================================

const fs = require('fs');
const path = require('path');

// Polígono en L en el plano XY, en sentido antihorario visto desde +Z.
const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 3], [0, 3]];
const DEPTH = 1;
const CAP_TRIS = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]];

// Vértices: 0..5 en z=0, 6..11 en z=DEPTH.
const vertices = [
  ...L.map(([x, y]) => [x, y, 0]),
  ...L.map(([x, y]) => [x, y, DEPTH])
];
const n = L.length;
const triangles = [];
CAP_TRIS.forEach(([a, b, c]) => triangles.push([a + n, b + n, c + n])); // tapa z=DEPTH, normal +Z
CAP_TRIS.forEach(([a, b, c]) => triangles.push([a, c, b]));             // tapa z=0, normal -Z
for (let i = 0; i < n; i++) {                                          // laterales, normal hacia afuera
  const j = (i + 1) % n;
  triangles.push([i, j, j + n]);
  triangles.push([i, j + n, i + n]);
}

const out = name => path.join(__dirname, name);

// --- OBJ (Y arriba) ---------------------------------------------------------
const obj = [
  '# Pieza en L de prueba (Y arriba). Bbox esperado: min (0, 0, 0) max (2, 3, 1)',
  'o LShape',
  ...vertices.map(v => `v ${v.join(' ')}`),
  ...triangles.map(t => `f ${t.map(i => i + 1).join(' ')}`)
].join('\n') + '\n';
fs.writeFileSync(out('l-shape.obj'), obj);

// --- OBJ en centímetros (x100): para probar "Tamaño" / "Normalizar a 2" del nodo sdMesh ---
const objCm = [
  '# Pieza en L en centimetros (Y arriba). Bbox esperado: min (0, 0, 0) max (200, 300, 100)',
  'o LShapeCm',
  ...vertices.map(v => `v ${v.map(c => c * 100).join(' ')}`),
  ...triangles.map(t => `f ${t.map(i => i + 1).join(' ')}`)
].join('\n') + '\n';
fs.writeFileSync(out('l-shape-cm.obj'), objCm);

// --- STL ASCII (Z arriba): editor (x, y, z) -> Blender (x, -z, y) -----------
const toZUp = ([x, y, z]) => [x, -z, y];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(c => c / l); };
const stlLines = ['solid LShape'];
triangles.forEach(t => {
  const [a, b, c] = t.map(i => toZUp(vertices[i]));
  const nrm = norm(cross(sub(b, a), sub(c, a)));
  stlLines.push(`  facet normal ${nrm.map(x => x + 0).join(' ')}`, '    outer loop');
  [a, b, c].forEach(v => stlLines.push(`      vertex ${v.map(x => x + 0).join(' ')}`));
  stlLines.push('    endloop', '  endfacet');
});
stlLines.push('endsolid LShape');
fs.writeFileSync(out('l-shape.stl'), stlLines.join('\n') + '\n');

// --- GLB (Y arriba, jerarquía) ----------------------------------------------
// padre: traslación (0, 0.5, 0) ; hijo (con la malla): traslación (-1, -0.5, -0.5)
// => mundo = vértice + (-1, 0, -0.5)
const posData = new Float32Array(vertices.flat());
const idxData = new Uint16Array(triangles.flat());
const posBytes = Buffer.from(posData.buffer);
const idxBytes = Buffer.from(idxData.buffer);
const pad4 = len => (4 - (len % 4)) % 4;
const idxOffset = posBytes.length + pad4(posBytes.length);
const binLength = idxOffset + idxBytes.length;
const bin = Buffer.alloc(binLength + pad4(binLength));
posBytes.copy(bin, 0);
idxBytes.copy(bin, idxOffset);

const gltf = {
  asset: { version: '2.0', generator: 'sdfeditor samples/generate-samples.js' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: 'Padre', translation: [0, 0.5, 0], children: [1] },
    { name: 'LShape', translation: [-1, -0.5, -0.5], mesh: 0 }
  ],
  meshes: [{ name: 'LShape', primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
    { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes.length, target: 34963 }
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: vertices.length, type: 'VEC3', min: [0, 0, 0], max: [2, 3, DEPTH] },
    { bufferView: 1, componentType: 5123, count: idxData.length, type: 'SCALAR' }
  ]
};
let json = Buffer.from(JSON.stringify(gltf), 'utf8');
json = Buffer.concat([json, Buffer.alloc(pad4(json.length), 0x20)]);

const header = Buffer.alloc(12);
const totalLength = 12 + 8 + json.length + 8 + bin.length;
header.writeUInt32LE(0x46546c67, 0); // 'glTF'
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const chunk = (type, data) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(data.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, data]);
};
fs.writeFileSync(out('l-shape.glb'), Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, bin)]));

console.log(`OK: ${vertices.length} vértices, ${triangles.length} triángulos -> l-shape.obj / .stl / .glb`);

// --- Toro low-poly (Y arriba): forma con agujero para probar el signo (winding number) del ----
// "GLSL completo". R = 1 (radio mayor, anillo en el plano XZ), r = 0.4, 16 x 8 segmentos = 256 triángulos.
// Bbox esperado: min (-1.4, -0.4, -1.4) · max (1.4, 0.4, 1.4).
const TORUS_R = 1, TORUS_r = 0.4, SEG_MAJOR = 16, SEG_MINOR = 8;
const tv = [];
for (let i = 0; i < SEG_MAJOR; i++) {
  const u = (i / SEG_MAJOR) * 2 * Math.PI;
  for (let j = 0; j < SEG_MINOR; j++) {
    const v = (j / SEG_MINOR) * 2 * Math.PI;
    const rr = TORUS_R + TORUS_r * Math.cos(v);
    tv.push([rr * Math.cos(u), TORUS_r * Math.sin(v), rr * Math.sin(u)].map(c => Number(c.toFixed(6)) + 0));
  }
}
const tIdx = (i, j) => (i % SEG_MAJOR) * SEG_MINOR + (j % SEG_MINOR);
const tt = [];
for (let i = 0; i < SEG_MAJOR; i++) {
  for (let j = 0; j < SEG_MINOR; j++) {
    const a = tIdx(i, j), b = tIdx(i + 1, j), c = tIdx(i + 1, j + 1), d = tIdx(i, j + 1);
    tt.push([a, d, c], [a, c, b]); // normales hacia afuera
  }
}
const torusObj = [
  `# Toro low-poly (Y arriba), R=${TORUS_R} r=${TORUS_r}, ${tt.length} triangulos`,
  'o TorusLowPoly',
  ...tv.map(v => `v ${v.join(' ')}`),
  ...tt.map(t => `f ${t.map(i => i + 1).join(' ')}`)
].join('\n') + '\n';
fs.writeFileSync(out('torus-lowpoly.obj'), torusObj);
console.log(`OK: ${tv.length} vértices, ${tt.length} triángulos -> torus-lowpoly.obj`);

// --- Blob orgánico (Y arriba): icosfera subdividida 4 veces (5120 triángulos) con el radio ------
// deformado por ondas suaves. Al desplazar solo a lo largo del radio (y con amplitud < 1) sigue
// cerrada y sin autointersecciones. Supera el límite de triángulos del "GLSL completo" (1000):
// sirve para probar la exportación como red neuronal.
const phi = (1 + Math.sqrt(5)) / 2;
let iv = [[-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0], [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
  [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]].map(v => { const l = Math.hypot(...v); return v.map(c => c / l); });
let it = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
for (let level = 0; level < 4; level++) {
  const cache = new Map();
  const mid = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (!cache.has(key)) {
      const m = iv[a].map((c, k) => (c + iv[b][k]) / 2);
      const l = Math.hypot(...m);
      iv.push(m.map(c => c / l));
      cache.set(key, iv.length - 1);
    }
    return cache.get(key);
  };
  const next = [];
  for (const [a, b, c] of it) {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  it = next;
}
const blobRadius = ([x, y, z]) => 1
  + 0.22 * Math.sin(3 * x + 1.3) * Math.sin(2 * y + 0.4)
  + 0.15 * Math.sin(4 * z + 2.1 * x)
  + 0.10 * Math.cos(5 * y - 1.7 * z);
const bv = iv.map(v => { const r = blobRadius(v); return v.map(c => Number((c * r).toFixed(6)) + 0); });
const blobObj = [
  `# Blob organico (Y arriba): icosfera subdividida con radio deformado, ${it.length} triangulos`,
  'o BlobOrganic',
  ...bv.map(v => `v ${v.join(' ')}`),
  ...it.map(t => `f ${t.map(i => i + 1).join(' ')}`)
].join('\n') + '\n';
fs.writeFileSync(out('blob-organic.obj'), blobObj);
console.log(`OK: ${bv.length} vértices, ${it.length} triángulos -> blob-organic.obj`);
