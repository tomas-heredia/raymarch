// ============================================================================
// IQ-SDF SUPREME ENGINE — Importación de mallas GLB / OBJ / STL (ES module)
// three.js se usa SOLO por sus loaders y se resuelve con el import map de index.html.
// app.js carga este módulo con import() recién al importar el primer archivo, así el
// resto del editor sigue funcionando desde file:// sin descargar three.js.
// ============================================================================

import { Matrix4, Vector3, REVISION } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

export const THREE_REVISION = REVISION;
export const SUPPORTED_EXTENSIONS = ['glb', 'obj', 'stl'];

export class MeshImportError extends Error {}

function extensionOf(fileName) {
  const m = /\.([^.]+)$/.exec(fileName || '');
  return m ? m[1].toLowerCase() : '';
}

function stripExtension(fileName) {
  return (fileName || 'malla').replace(/\.[^.]+$/, '');
}

async function loadRoot(file, format) {
  if (format === 'glb') {
    const buffer = await file.arrayBuffer();
    const magic = buffer.byteLength >= 4 ? new TextDecoder().decode(new Uint8Array(buffer, 0, 4)) : '';
    if (magic !== 'glTF') {
      throw new MeshImportError('El archivo no es un GLB válido (falta la cabecera "glTF").');
    }
    try {
      const gltf = await new GLTFLoader().parseAsync(buffer, '');
      return gltf.scene;
    } catch (err) {
      const msg = String(err && err.message || err);
      if (/DRACOLoader/i.test(msg)) {
        throw new MeshImportError('El GLB usa compresión Draco, que todavía no está soportada. En Blender, exportalo sin "Compression".');
      }
      if (/Meshopt/i.test(msg)) {
        throw new MeshImportError('El GLB usa compresión meshopt, que todavía no está soportada. Exportalo sin compresión.');
      }
      throw new MeshImportError(`No se pudo leer el GLB: ${msg}`);
    }
  }

  if (format === 'obj') {
    const text = await file.text();
    try {
      return new OBJLoader().parse(text);
    } catch (err) {
      throw new MeshImportError(`No se pudo leer el OBJ: ${err && err.message || err}`);
    }
  }

  if (format === 'stl') {
    const buffer = await file.arrayBuffer();
    try {
      const geometry = new STLLoader().parse(buffer);
      return { isFakeRoot: true, geometry };
    } catch (err) {
      throw new MeshImportError(`No se pudo leer el STL: ${err && err.message || err}`);
    }
  }

  throw new MeshImportError(`Formato no soportado: ".${format}".`);
}

// Recorre la jerarquía y junta [geometry, matriz de mundo] por cada instancia de malla.
function collectMeshes(root, warnings) {
  if (root.isFakeRoot) {
    return [{ geometry: root.geometry, matrix: new Matrix4() }];
  }

  root.updateMatrixWorld(true);
  const items = [];
  let skipped = 0;
  let skinned = false;

  root.traverse(obj => {
    if (obj.isMesh) {
      if (obj.isSkinnedMesh) skinned = true;
      if (obj.isInstancedMesh) {
        const inst = new Matrix4();
        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, inst);
          items.push({ geometry: obj.geometry, matrix: new Matrix4().multiplyMatrices(obj.matrixWorld, inst) });
        }
      } else {
        items.push({ geometry: obj.geometry, matrix: obj.matrixWorld.clone() });
      }
    } else if (obj.isLine || obj.isPoints) {
      skipped++;
    }
  });

  if (skipped) warnings.push(`Se ignoraron ${skipped} objeto(s) de líneas o puntos (solo se usan triángulos).`);
  if (skinned) warnings.push('Hay mallas con esqueleto: se usa la pose de reposo, sin animación.');
  return items;
}

// Une todo en un Float32Array de triángulos sin indexar, en coordenadas de mundo del archivo.
function mergeTriangles(items) {
  let triangleCount = 0;
  for (const { geometry } of items) {
    const pos = geometry.getAttribute('position');
    if (!pos) continue;
    triangleCount += Math.floor((geometry.index ? geometry.index.count : pos.count) / 3);
  }

  const positions = new Float32Array(triangleCount * 9);
  const v = new Vector3();
  let o = 0;
  for (const { geometry, matrix } of items) {
    const pos = geometry.getAttribute('position');
    if (!pos) continue;
    const index = geometry.index;
    const count = Math.floor((index ? index.count : pos.count) / 3) * 3;
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(matrix);
      positions[o++] = v.x;
      positions[o++] = v.y;
      positions[o++] = v.z;
    }
  }
  return positions;
}

/**
 * Lee un File (GLB / OBJ / STL) y devuelve los datos que espera SDFMeshStore.add().
 * Lanza MeshImportError con un mensaje en español si algo falla.
 */
export async function parseMeshFile(file) {
  const format = extensionOf(file.name);
  if (format === 'gltf') {
    throw new MeshImportError('Los .gltf con archivos externos no están soportados: exportá como .glb (binario).');
  }
  if (!SUPPORTED_EXTENSIONS.includes(format)) {
    throw new MeshImportError(`"${file.name}": formato no soportado. Usá GLB, OBJ o STL.`);
  }

  const warnings = [];
  const root = await loadRoot(file, format);
  const items = collectMeshes(root, warnings);
  const positions = mergeTriangles(items);

  if (positions.length === 0) {
    throw new MeshImportError(`"${file.name}" no contiene triángulos.`);
  }
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      throw new MeshImportError(`"${file.name}" tiene coordenadas inválidas (NaN o infinito).`);
    }
  }

  return {
    name: stripExtension(file.name),
    format,
    fileSize: file.size,
    positions,
    meshCount: items.length,
    warnings
  };
}
