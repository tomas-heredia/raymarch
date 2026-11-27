// ============================================================================
// IQ-SDF SUPREME ENGINE — Almacén de mallas importadas (GLB / OBJ / STL)
// Vive fuera de `scene` a propósito: las escenas se clonan con JSON y cambian
// con los presets; las mallas (arrays grandes) persisten aparte.
// No depende de three.js: los triángulos llegan ya parseados desde mesh-import.js.
// ============================================================================

window.SDFMeshStore = (function () {
  const meshes = [];   // en orden de importación
  const listeners = [];

  // Formato -> eje "arriba" por defecto. Blender exporta GLB/OBJ con Y arriba y STL con Z arriba.
  const DEFAULT_UP_AXIS = { glb: 'y', obj: 'y', stl: 'z' };

  // Vóxeles del eje más largo de la grilla SDF.
  const SDF_RESOLUTIONS = [32, 64, 96, 128];
  const DEFAULT_SDF_RESOLUTION = 64;

  // Conversión a Y arriba (convención del editor): Blender Z-up (x, y, z) -> (x, z, -y).
  function toEditorSpace(x, y, z, upAxis) {
    return upAxis === 'z' ? [x, z, -y] : [x, y, z];
  }

  function computeBBox(positions, upAxis) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      const p = toEditorSpace(positions[i], positions[i + 1], positions[i + 2], upAxis);
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
    const xyz = a => ({ x: a[0], y: a[1], z: a[2] });
    return {
      min: xyz(min),
      max: xyz(max),
      size: xyz(max.map((v, k) => v - min[k])),
      center: xyz(max.map((v, k) => (v + min[k]) / 2))
    };
  }

  function notify() {
    listeners.forEach(fn => fn());
  }

  /**
   * data = { name, format: 'glb'|'obj'|'stl', fileSize, positions: Float32Array (triángulos
   *          sin indexar, en coordenadas de mundo del archivo), meshCount, warnings[] }
   */
  function add(data) {
    const upAxis = DEFAULT_UP_AXIS[data.format] || 'y';
    const mesh = {
      id: 'mesh_' + Math.random().toString(36).substring(2, 8),
      name: data.name,
      format: data.format,
      fileSize: data.fileSize || 0,
      positions: data.positions,
      triangleCount: data.positions.length / 9,
      meshCount: data.meshCount,
      warnings: data.warnings || [],
      upAxis,
      bbox: computeBBox(data.positions, upAxis),
      sdfResolution: DEFAULT_SDF_RESOLUTION,
      // status: 'idle' | 'baking' | 'ready' | 'error'
      // ready: { dims: [nx,ny,nz], min: {x,y,z} (editor), voxel, data: Float32Array, ms }
      sdf: { status: 'idle', progress: 0 }
    };
    meshes.push(mesh);
    notify();
    return mesh;
  }

  function remove(id) {
    const i = meshes.findIndex(m => m.id === id);
    if (i >= 0) {
      meshes.splice(i, 1);
      notify();
    }
  }

  // Cambiar el eje invalida el SDF (quien escucha onChange debe regenerarlo).
  function setUpAxis(id, upAxis) {
    const mesh = get(id);
    if (!mesh || mesh.upAxis === upAxis) return;
    mesh.upAxis = upAxis;
    mesh.bbox = computeBBox(mesh.positions, upAxis);
    mesh.sdf = { status: 'idle', progress: 0 };
    notify();
  }

  function setSdfResolution(id, resolution) {
    const mesh = get(id);
    if (!mesh || mesh.sdfResolution === resolution) return;
    mesh.sdfResolution = resolution;
    mesh.sdf = { status: 'idle', progress: 0 };
    notify();
  }

  // patch se mezcla con el estado actual. silent: no avisar (para el progreso, que es frecuente).
  function setSdf(id, patch, { silent = false } = {}) {
    const mesh = get(id);
    if (!mesh) return;
    mesh.sdf = patch.status && patch.status !== mesh.sdf.status ? { ...patch } : { ...mesh.sdf, ...patch };
    if (!silent) notify();
  }

  // Copia de los triángulos en coordenadas del editor (con la conversión de eje aplicada).
  function getEditorPositions(id) {
    const mesh = get(id);
    if (!mesh) return null;
    const src = mesh.positions;
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      const p = toEditorSpace(src[i], src[i + 1], src[i + 2], mesh.upAxis);
      out[i] = p[0];
      out[i + 1] = p[1];
      out[i + 2] = p[2];
    }
    return out;
  }

  function get(id) {
    return meshes.find(m => m.id === id) || null;
  }

  return {
    add,
    remove,
    get,
    setUpAxis,
    setSdfResolution,
    setSdf,
    getEditorPositions,
    SDF_RESOLUTIONS,
    list: () => meshes.slice(),
    onChange: fn => listeners.push(fn),
    computeBBox
  };
})();
