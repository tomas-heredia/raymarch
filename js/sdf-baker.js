// ============================================================================
// IQ-SDF SUPREME ENGINE — Orquestador de la generación de SDF de mallas
// Un Web Worker (js/sdf-bake-worker.js, module worker) por trabajo; regenerar
// una malla cancela (terminate) el trabajo anterior de esa misma malla.
// No toca SDFMeshStore ni el renderer: avisa por callbacks y app.js decide.
// ============================================================================

window.SDFBaker = (function () {
  const jobs = new Map(); // meshId -> { worker, jobId }
  let nextJobId = 1;

  function cancel(meshId) {
    const job = jobs.get(meshId);
    if (job) {
      job.worker.terminate();
      jobs.delete(meshId);
    }
  }

  /**
   * positions: Float32Array en coordenadas del editor (se transfiere al worker: queda inutilizable acá).
   * callbacks: { onProgress(0..1), onDone({ data, dims, min, voxel, ms }), onError(message) }
   */
  function bake(meshId, positions, resolution, { onProgress, onDone, onError }) {
    cancel(meshId);
    const jobId = nextJobId++;

    let worker;
    try {
      worker = new Worker(new URL('js/sdf-bake-worker.js', document.baseURI), { type: 'module' });
    } catch (err) {
      onError(`No se pudo crear el worker de SDF: ${err.message}`);
      return;
    }
    jobs.set(meshId, { worker, jobId });

    const finish = () => {
      if (jobs.get(meshId)?.jobId === jobId) jobs.delete(meshId);
      worker.terminate();
    };

    worker.onmessage = e => {
      const msg = e.data;
      if (msg.jobId !== jobId) return;
      if (msg.type === 'progress') {
        onProgress(msg.progress);
      } else if (msg.type === 'done') {
        finish();
        onDone(msg);
      } else if (msg.type === 'error') {
        finish();
        onError(msg.message);
      }
    };
    // Falla al cargar el módulo (p. ej. sin conexión a esm.sh) o error no capturado.
    worker.onerror = e => {
      e.preventDefault();
      finish();
      onError(`El worker de SDF falló${e.message ? `: ${e.message}` : ''}. ¿Hay conexión a esm.sh (three-mesh-bvh)?`);
    };

    worker.postMessage({ jobId, positions, resolution }, [positions.buffer]);
  }

  return {
    bake,
    cancel,
    isBaking: meshId => jobs.has(meshId)
  };
})();
