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

  // Red neuronal (SIREN) para exportar a GLSL puro: ancho x capas ocultas extra, iteraciones.
  const NEURAL_QUALITIES = {
    fast: { label: 'Rápida (16×2, borrador)', width: 16, hidden: 2, iterations: 4000 },
    normal: { label: 'Normal (24×2)', width: 24, hidden: 2, iterations: 6000 },
    high: { label: 'Alta (32×2)', width: 32, hidden: 2, iterations: 8000 },
    // Más pasos y 20 % de las muestras de superficie sobre las aristas vivas (donde la red redondea).
    // Mismo tamaño que Alta: el shader compila igual de rápido, solo tarda más en entrenar.
    max: { label: 'Máxima (32×2, aristas)', width: 32, hidden: 2, iterations: 16000, edgeFraction: 0.2 }
  };
  const DEFAULT_NEURAL_QUALITY = 'normal';

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
      sdf: { status: 'idle', progress: 0 },
      // Red neuronal: no se entrena sola (tarda decenas de segundos), solo con "Entrenar".
      // status: 'idle' | 'training' | 'ready' | 'error'
      // ready: { layers, scale, band, lipschitz, metrics, arch, quality, ms }
      neuralQuality: DEFAULT_NEURAL_QUALITY,
      neural: { status: 'idle', progress: 0 },
      // Qué usa el editor para dibujar la malla: 'grid' (textura 3D) | 'neural' (la red, como se exporta)
      view: 'grid'
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
    mesh.neural = { status: 'idle', progress: 0 }; // la red aprendió la orientación anterior
    mesh.view = 'grid';
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

  function setNeural(id, patch, { silent = false } = {}) {
    const mesh = get(id);
    if (!mesh) return;
    mesh.neural = patch.status && patch.status !== mesh.neural.status ? { ...patch } : { ...mesh.neural, ...patch };
    if (mesh.neural.status !== 'ready' && mesh.view === 'neural') mesh.view = 'grid';
    if (!silent) notify();
  }

  // La calidad elegida se usa en el próximo entrenamiento; la red ya entrenada se conserva.
  function setNeuralQuality(id, quality) {
    const mesh = get(id);
    if (!mesh || !NEURAL_QUALITIES[quality] || mesh.neuralQuality === quality) return;
    mesh.neuralQuality = quality;
    notify();
  }

  function setView(id, view) {
    const mesh = get(id);
    if (!mesh || mesh.view === view) return;
    if (view === 'neural' && mesh.neural.status !== 'ready') return;
    mesh.view = view === 'neural' ? 'neural' : 'grid';
    notify();
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

  // Copia en el espacio local del nodo malla: coordenadas del editor menos el centro del bbox.
  function getLocalPositions(id) {
    const mesh = get(id);
    const out = getEditorPositions(id);
    if (!out) return null;
    const c = mesh.bbox.center;
    for (let i = 0; i < out.length; i += 3) {
      out[i] -= c.x;
      out[i + 1] -= c.y;
      out[i + 2] -= c.z;
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
    setNeural,
    setNeuralQuality,
    setView,
    getEditorPositions,
    getLocalPositions,
    SDF_RESOLUTIONS,
    NEURAL_QUALITIES,
    list: () => meshes.slice(),
    onChange: fn => listeners.push(fn),
    computeBBox
  };
})();
