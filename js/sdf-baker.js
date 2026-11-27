// ============================================================================
// IQ-SDF SUPREME ENGINE — Orquestador de trabajos en Web Workers por malla
//   - bake():  SDF en grilla 3D        (js/sdf-bake-worker.js)
//   - train(): red neuronal del SDF    (js/neural-sdf-worker.js)
// Un worker (module worker) por trabajo; repetir un trabajo de una malla cancela
// (terminate) el anterior del mismo tipo. La grilla y la red de una misma malla
// pueden correr a la vez.
// No toca SDFMeshStore ni el renderer: avisa por callbacks y app.js decide.
// ============================================================================

window.SDFBaker = (function () {
  const jobs = new Map(); // `${kind}:${meshId}` -> { worker, jobId }
  let nextJobId = 1;

  const WORKERS = {
    bake: { url: 'js/sdf-bake-worker.js', label: 'SDF' },
    train: { url: 'js/neural-sdf-worker.js', label: 'la red neuronal' }
  };

  function cancelJob(kind, meshId) {
    const key = `${kind}:${meshId}`;
    const job = jobs.get(key);
    if (job) {
      job.worker.terminate();
      jobs.delete(key);
    }
  }

  /**
   * payload: datos del trabajo (sin jobId); transfer: buffers que pasan al worker.
   * callbacks: { onProgress(0..1, phase), onDone(msg), onError(message) }
   */
  function run(kind, meshId, payload, transfer, { onProgress, onDone, onError }) {
    cancelJob(kind, meshId);
    const key = `${kind}:${meshId}`;
    const jobId = nextJobId++;

    let worker;
    try {
      worker = new Worker(new URL(WORKERS[kind].url, document.baseURI), { type: 'module' });
    } catch (err) {
      onError(`No se pudo crear el worker de ${WORKERS[kind].label}: ${err.message}`);
      return;
    }
    jobs.set(key, { worker, jobId });

    const finish = () => {
      if (jobs.get(key)?.jobId === jobId) jobs.delete(key);
      worker.terminate();
    };

    worker.onmessage = e => {
      const msg = e.data;
      if (msg.jobId !== jobId) return;
      if (msg.type === 'progress') {
        onProgress(msg.progress, msg.phase);
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
      onError(`El worker de ${WORKERS[kind].label} falló${e.message ? `: ${e.message}` : ''}. ¿Hay conexión a esm.sh (three-mesh-bvh)?`);
    };

    worker.postMessage({ jobId, ...payload }, transfer);
  }

  /** positions: Float32Array en coordenadas del editor (se transfiere: queda inutilizable acá). */
  function bake(meshId, positions, resolution, callbacks) {
    run('bake', meshId, { positions, resolution }, [positions.buffer], callbacks);
  }

  /** positions: Float32Array en espacio local de la malla (centrada en su bbox); se transfiere. */
  function train(meshId, positions, { width, hidden, iterations }, callbacks) {
    run('train', meshId, { positions, width, hidden, iterations }, [positions.buffer], callbacks);
  }

  return {
    bake,
    train,
    cancel: meshId => cancelJob('bake', meshId),
    cancelTraining: meshId => cancelJob('train', meshId),
    isBaking: meshId => jobs.has(`bake:${meshId}`),
    isTraining: meshId => jobs.has(`train:${meshId}`)
  };
})();
