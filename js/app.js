// ============================================================================
// IQ-SDF SUPREME ENGINE — Main 3D Editor Application Controller
// ============================================================================

window.SDFApp = (function () {
  const { CATEGORIES, PRIMITIVES, createNode, fmt } = window.SDFLibrary;
  const { generateMasterShader, getPresets } = window.ShaderGenerator;
  const Renderer = window.SDFRenderer;
  const Exporter = window.SDFExporter;
  const MeshStore = window.SDFMeshStore;

  const presets = getPresets();
  let scene = JSON.parse(JSON.stringify(presets.base_user));
  let selectedNodeId = scene.nodes[1]?.id || scene.nodes[0]?.id || null;
  // Mutuamente excluyente con la selección de nodo: si hay una malla seleccionada,
  // el inspector muestra la malla y no se dibuja el gizmo del nodo.
  let selectedMeshId = null;
  let manualEditMode = false;
  let currentShaderCode = '';
  let leftTab = 'hierarchy'; // 'hierarchy' | 'catalog' | 'globals'

  // Viewport camera interaction state
  let isCameraDragging = false;
  let cameraDragMode = 'orbit'; // 'orbit' | 'pan'
  let lastMouse = { x: 0, y: 0 };
  let orbitTarget = { x: 0, y: 0, z: 0 };

  // Gizmo dragging state
  let gizmoDragAxis = null;
  let gizmoDragStartMouse = { x: 0, y: 0 };
  let gizmoDragStartNodeState = null;

  function getSelectedNode() {
    return scene.nodes.find(n => n.id === selectedNodeId) || null;
  }

  function selectNode(id) {
    selectedNodeId = id;
    selectedMeshId = null;
  }

  function selectMesh(id) {
    selectedMeshId = id;
  }

  function getMeshBoxes() {
    return MeshStore.list().map(m => ({ name: m.name, bbox: m.bbox, selected: m.id === selectedMeshId }));
  }

  function init() {
    const glCanvas = document.getElementById('glCanvas');
    const gizmoCanvas = document.getElementById('gizmoCanvas');
    Renderer.init(glCanvas, gizmoCanvas);

    setupTopbar();
    setupLeftTabs();
    setupViewportInteractions(gizmoCanvas);
    setupShaderEditorEvents();
    setupMeshImport();

    MeshStore.onChange(() => {
      if (selectedMeshId && !MeshStore.get(selectedMeshId)) selectedMeshId = null;
      // Malla recién importada, o con eje/resolución cambiados: (re)generar su SDF.
      MeshStore.list()
        .filter(m => m.sdf.status === 'idle')
        .forEach(m => queueMicrotask(() => startSdfBake(m.id)));
      renderLeftPanel();
      renderInspector();
      // Los nodos malla cambian de marcador (bbox) a textura cuando termina el SDF.
      if (scene.nodes.some(n => n.type === 'mesh')) recompileSceneShader();
    });

    renderLeftPanel();
    renderInspector();
    recompileSceneShader();

    // Start render loop
    function animate() {
      Renderer.renderFrame(scene, selectedMeshId ? null : getSelectedNode(), getMeshBoxes());
      const fpsEl = document.getElementById('hudFps');
      const timeEl = document.getElementById('hudTime');
      if (fpsEl) fpsEl.textContent = `${Renderer.getFPS()} FPS`;
      if (timeEl) timeEl.textContent = `t = ${Renderer.getTime().toFixed(2)}s`;
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }

  function recompileSceneShader( updateTextarea = true ) {
    if (!manualEditMode) {
      currentShaderCode = generateMasterShader(scene, { meshes: getMeshShaderInfos() });
      if (updateTextarea) {
        const area = document.getElementById('shaderCodeArea');
        if (area) area.value = currentShaderCode;
      }
    } else {
      const area = document.getElementById('shaderCodeArea');
      if (area) currentShaderCode = area.value;
    }

    const res = Renderer.updateFragmentShader(currentShaderCode);
    const errBanner = document.getElementById('shaderErrorBanner');
    const dot = document.getElementById('shaderStatusDot');
    const statusTxt = document.getElementById('shaderStatusText');
    const lineCountEl = document.getElementById('shaderLineCount');

    if (lineCountEl) {
      lineCountEl.textContent = `${currentShaderCode.split('\n').length} líneas GLSL`;
    }

    if (!res.ok) {
      if (errBanner) {
        errBanner.style.display = 'block';
        errBanner.textContent = res.error;
      }
      if (dot) dot.classList.add('error');
      if (statusTxt) statusTxt.textContent = 'Error de compilación GLSL';
    } else {
      if (errBanner) {
        errBanner.style.display = 'none';
        errBanner.textContent = '';
      }
      if (dot) dot.classList.remove('error');
      if (statusTxt) {
        statusTxt.textContent = manualEditMode
          ? 'Compilado OK (Edición Manual)'
          : `Shader Maestro OK (${scene.nodes.filter(n => n.enabled).length} SDFs activos)`;
      }
    }

    updateCameraHud();
  }

  function updateCameraHud() {
    const camEl = document.getElementById('hudCamera');
    if (!camEl) return;
    const c = scene.globals.camera;
    camEl.textContent = `Cam: (${c.pos.x.toFixed(1)}, ${c.pos.y.toFixed(1)}, ${c.pos.z.toFixed(1)})`;
  }

  function setupTopbar() {
    // Preset selector
    const presetSelect = document.getElementById('presetSelect');
    if (presetSelect) {
      presetSelect.innerHTML = '';
      Object.keys(presets).forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = presets[k].name;
        presetSelect.appendChild(opt);
      });
      presetSelect.addEventListener('change', (e) => {
        const key = e.target.value;
        if (presets[key]) {
          scene = JSON.parse(JSON.stringify(presets[key]));
          selectNode(scene.nodes[scene.nodes.length - 1]?.id || null);
          manualEditMode = false;
          const chk = document.getElementById('manualShaderToggle');
          if (chk) chk.checked = false;
          renderLeftPanel();
          renderInspector();
          recompileSceneShader();
        }
      });
    }

    // Gizmo tool buttons
    const setTool = (mode) => {
      Renderer.setGizmoMode(mode);
      ['btnToolMove', 'btnToolRotate', 'btnToolScale'].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.classList.remove('active');
      });
      const activeId = mode === 'translate' ? 'btnToolMove' : (mode === 'rotate' ? 'btnToolRotate' : 'btnToolScale');
      document.getElementById(activeId)?.classList.add('active');
    };

    document.getElementById('btnToolMove')?.addEventListener('click', () => setTool('translate'));
    document.getElementById('btnToolRotate')?.addEventListener('click', () => setTool('rotate'));
    document.getElementById('btnToolScale')?.addEventListener('click', () => setTool('scale'));

    document.getElementById('btnToggleGizmo')?.addEventListener('click', (e) => {
      const next = !Renderer.getShowGizmo();
      Renderer.setShowGizmo(next);
      e.currentTarget.classList.toggle('active', next);
    });

    // Play / Pause & Reset time
    const btnPlay = document.getElementById('btnPlayPause');
    btnPlay?.addEventListener('click', () => {
      const next = !Renderer.isPlaying();
      Renderer.setPlaying(next);
      btnPlay.textContent = next ? '⏸ Pausa' : '▶ Play';
    });

    document.getElementById('btnResetTime')?.addEventListener('click', () => {
      Renderer.resetTime();
    });

    // Reset camera to base template (0, 0, -10)
    document.getElementById('btnResetCam')?.addEventListener('click', () => {
      scene.globals.camera = { pos: { x: 0.0, y: 0.0, z: -10.0 }, yaw: 0.0, pitch: 0.0, fov: 1.0 };
      orbitTarget = { x: 0, y: 0, z: 0 };
      if (leftTab === 'globals') renderLeftPanel();
      recompileSceneShader();
    });

    // Quick Add Shape button -> switches to catalog tab or adds sphere
    document.getElementById('btnQuickAdd')?.addEventListener('click', () => {
      switchLeftTab('catalog');
    });

    // Resolution scale selector
    document.getElementById('resScaleSelect')?.addEventListener('change', (e) => {
      Renderer.setResScale(parseFloat(e.target.value) || 1.0);
    });

    // Copy Shader Button
    const btnCopy = document.getElementById('btnCopyShader');
    btnCopy?.addEventListener('click', () => {
      navigator.clipboard.writeText(currentShaderCode).then(() => {
        const orig = btnCopy.textContent;
        btnCopy.textContent = '✓ ¡Copiado!';
        setTimeout(() => { btnCopy.textContent = orig; }, 1400);
      });
    });

    // OUTPUT (.HTML) Export Button
    document.getElementById('btnExportOutput')?.addEventListener('click', () => {
      // Embeber el SDF de cada malla cuyo sampler aparece en el shader (también sirve en Edición Manual).
      const ids = [...new Set([...currentShaderCode.matchAll(/uniform\s+(?:highp\s+)?sampler3D\s+uMeshSdf_(\w+)/g)].map(m => m[1]))];
      const textures = [];
      const missing = [];
      ids.forEach(id => {
        const mesh = MeshStore.get(id);
        if (mesh && mesh.sdf.status === 'ready') textures.push({ id, dims: mesh.sdf.dims, data: mesh.sdf.data });
        else missing.push(mesh ? mesh.name : id);
      });
      Exporter.downloadStandaloneHTML(currentShaderCode, 'sdf-render-output.html', textures);
      if (missing.length) {
        showToast(`Exportado, pero sin el SDF de: ${missing.join(', ')} (no está listo o se quitó la malla).`, 'warn', 7000);
      } else if (textures.length) {
        showToast(`Exportado con ${textures.length} malla(s) embebida(s).`, 'ok');
      }
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.key === 'g' || e.key === 'w') setTool('translate');
      if (e.key === 'r' || e.key === 'e') setTool('rotate');
      if (e.key === 's') setTool('scale');
      if (e.key === 'h') document.getElementById('btnToggleGizmo')?.click();
      if (e.code === 'Space') {
        e.preventDefault();
        btnPlay?.click();
      }
    });
  }

  function setupLeftTabs() {
    document.querySelectorAll('.panel-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        switchLeftTab(tab.dataset.tab);
      });
    });
  }

  function switchLeftTab(tabName) {
    leftTab = tabName;
    document.querySelectorAll('.panel-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    renderLeftPanel();
  }

  function setupShaderEditorEvents() {
    const toggle = document.getElementById('manualShaderToggle');
    const area = document.getElementById('shaderCodeArea');

    toggle?.addEventListener('change', (e) => {
      manualEditMode = e.target.checked;
      if (!manualEditMode) {
        recompileSceneShader(true);
      }
    });

    area?.addEventListener('input', () => {
      if (!manualEditMode) {
        manualEditMode = true;
        if (toggle) toggle.checked = true;
      }
      recompileSceneShader(false);
    });
  }

  // ==========================================================================
  // Importación de mallas GLB / OBJ / STL (drag & drop + botón)
  // three.js se carga con import() recién al importar el primer archivo.
  // ==========================================================================
  const LARGE_MESH_TRIANGLES = 500000;
  let meshImportModulePromise = null;
  let toastTimer = null;

  function showToast(message, kind = 'info', ms = 4000) {
    const el = document.getElementById('viewportToast');
    if (!el) return;
    el.textContent = message;
    el.className = `viewport-toast visible ${kind}`;
    clearTimeout(toastTimer);
    if (ms > 0) toastTimer = setTimeout(() => el.classList.remove('visible'), ms);
  }

  function loadMeshImportModule() {
    if (location.protocol === 'file:') {
      return Promise.reject(new Error('Para importar mallas hay que servir la carpeta por HTTP (por ej. php -S 127.0.0.1:8765), no abrir index.html con doble clic.'));
    }
    if (!meshImportModulePromise) {
      meshImportModulePromise = import(new URL('js/mesh-import.js', document.baseURI).href).catch(err => {
        meshImportModulePromise = null; // permitir reintentar
        throw new Error(`No se pudo cargar three.js desde el CDN (¿sin conexión?): ${err.message}`);
      });
    }
    return meshImportModulePromise;
  }

  async function importMeshFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;

    let mod;
    try {
      showToast('Cargando loaders de three.js…', 'info', 0);
      mod = await loadMeshImportModule();
    } catch (err) {
      showToast(err.message, 'error', 9000);
      return;
    }

    const imported = [];
    const errors = [];
    for (const file of files) {
      showToast(`Leyendo ${file.name}…`, 'info', 0);
      try {
        imported.push(MeshStore.add(await mod.parseMeshFile(file)));
      } catch (err) {
        if (err instanceof mod.MeshImportError) {
          errors.push(err.message);
        } else {
          console.error('[MeshImport]', err);
          errors.push(`${file.name}: error inesperado (${err && err.message || err}).`);
        }
      }
    }

    if (imported.length) {
      selectMesh(imported[imported.length - 1].id);
      switchLeftTab('hierarchy');
      renderInspector();
    }

    if (errors.length) {
      showToast(errors.join('\n'), 'error', 9000);
    } else {
      const m = imported[imported.length - 1];
      const s = m.bbox.size;
      const extra = imported.length > 1 ? ` (+${imported.length - 1} más)` : '';
      const big = imported.some(x => x.triangleCount > LARGE_MESH_TRIANGLES) ? ' · malla muy pesada' : '';
      showToast(`Importada: ${m.name}${extra} — ${formatCount(m.triangleCount)} triángulos · ${fmtLen(s.x)} × ${fmtLen(s.y)} × ${fmtLen(s.z)}${big}`, big ? 'warn' : 'ok');
    }
  }

  function setupMeshImport() {
    const vp = document.querySelector('.viewport-container');
    const overlay = document.getElementById('dropOverlay');
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    let dragDepth = 0;

    vp?.addEventListener('dragenter', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      overlay?.classList.add('visible');
    });
    vp?.addEventListener('dragover', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    vp?.addEventListener('dragleave', e => {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) overlay?.classList.remove('visible');
    });
    vp?.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      overlay?.classList.remove('visible');
      importMeshFiles(e.dataTransfer.files);
    });

    // Soltar un archivo fuera del viewport no debe hacer que el navegador lo abra (se perdería la escena).
    window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', e => { if (hasFiles(e)) e.preventDefault(); });

    const input = document.getElementById('meshFileInput');
    document.getElementById('btnImportMesh')?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', () => {
      importMeshFiles(input.files);
      input.value = '';
    });
  }

  // Mueve la cámara (manteniendo yaw/pitch) para que el bbox entre en cuadro, y orbita alrededor de su centro.
  function frameBBox(bbox) {
    const cam = scene.globals.camera;
    const yaw = Number(cam.yaw) || 0;
    const pitch = Number(cam.pitch) || 0;
    // Mismo vector forward que la órbita (coincide con main() del shader generado)
    const fx = -Math.cos(pitch) * Math.sin(yaw);
    const fy = -Math.sin(pitch);
    const fz = Math.cos(pitch) * Math.cos(yaw);

    const s = bbox.size;
    const radius = Math.max(0.01, 0.5 * Math.hypot(s.x, s.y, s.z));
    // En main(): uv.y ∈ [-0.5, 0.5] y uv.x ∈ [-0.5·aspect, 0.5·aspect]. Limita el lado más angosto.
    const glCanvas = document.getElementById('glCanvas');
    const aspect = glCanvas && glCanvas.height ? glCanvas.width / glCanvas.height : 1;
    const halfFov = Math.atan((0.5 * Math.min(1, aspect)) / (Number(cam.fov) || 1.0));
    const dist = (radius / Math.sin(halfFov)) * 1.15;

    orbitTarget = { x: bbox.center.x, y: bbox.center.y, z: bbox.center.z };
    cam.pos.x = Number((orbitTarget.x - fx * dist).toFixed(4));
    cam.pos.y = Number((orbitTarget.y - fy * dist).toFixed(4));
    cam.pos.z = Number((orbitTarget.z - fz * dist).toFixed(4));

    if (leftTab === 'globals') renderLeftPanel();
    recompileSceneShader();
  }

  // --------------------------------------------------------------------------
  // SDF de mallas: worker -> textura 3D -> nodos 'mesh' en la escena
  // --------------------------------------------------------------------------
  function startSdfBake(meshId) {
    const mesh = MeshStore.get(meshId);
    if (!mesh || mesh.sdf.status !== 'idle') return;
    if (location.protocol === 'file:') {
      MeshStore.setSdf(meshId, { status: 'error', error: 'Los Web Workers necesitan servir la carpeta por HTTP.' });
      return;
    }
    const positions = MeshStore.getEditorPositions(meshId);
    MeshStore.setSdf(meshId, { status: 'baking', progress: 0 });
    SDFBaker.bake(meshId, positions, mesh.sdfResolution, {
      onProgress: progress => {
        MeshStore.setSdf(meshId, { progress }, { silent: true });
        updateSdfProgressUI(meshId, progress);
      },
      onDone: result => {
        if (!MeshStore.get(meshId)) return; // se quitó mientras se generaba
        const [nx, ny, nz] = result.dims;
        // Primero la textura, después el estado: así el shader que declara el sampler ya la encuentra.
        Renderer.uploadMeshSdf(meshId, result.data, nx, ny, nz);
        MeshStore.setSdf(meshId, {
          status: 'ready', dims: result.dims, min: result.min, voxel: result.voxel, data: result.data, ms: result.ms
        });
      },
      onError: message => {
        if (!MeshStore.get(meshId)) return;
        Renderer.deleteMeshSdf(meshId);
        MeshStore.setSdf(meshId, { status: 'error', error: message });
        showToast(`SDF de "${MeshStore.get(meshId).name}": ${message}`, 'error', 9000);
      }
    });
  }

  // Actualiza las barras de progreso sin re-renderizar los paneles.
  function updateSdfProgressUI(meshId, progress) {
    document.querySelectorAll(`[data-sdf-progress="${meshId}"]`).forEach(el => {
      el.style.width = `${Math.round(progress * 100)}%`;
    });
    document.querySelectorAll(`[data-sdf-progress-text="${meshId}"]`).forEach(el => {
      el.textContent = `${Math.round(progress * 100)}%`;
    });
  }

  function removeMesh(meshId) {
    SDFBaker.cancel(meshId);
    Renderer.deleteMeshSdf(meshId);
    MeshStore.remove(meshId); // onChange re-renderiza; los nodos que la usan quedan sin geometría
  }

  // Info de cada malla para el generador (espacio local = centrado en el centro del bbox).
  function getMeshShaderInfos() {
    const infos = {};
    MeshStore.list().forEach(m => {
      const c = m.bbox.center;
      const s = m.sdf;
      infos[m.id] = {
        name: m.name,
        status: s.status === 'ready' ? 'ready' : (s.status === 'error' ? 'error' : 'baking'),
        halfSize: { x: m.bbox.size.x / 2, y: m.bbox.size.y / 2, z: m.bbox.size.z / 2 },
        grid: s.status === 'ready' ? {
          min: { x: s.min.x - c.x, y: s.min.y - c.y, z: s.min.z - c.z },
          size: { x: (s.dims[0] - 1) * s.voxel, y: (s.dims[1] - 1) * s.voxel, z: (s.dims[2] - 1) * s.voxel },
          dims: s.dims
        } : null
      };
    });
    return infos;
  }

  // Nodo 'mesh' ubicado donde está la malla (su origen local es el centro del bbox).
  function addMeshNodeToScene(mesh) {
    const c = mesh.bbox.center;
    const round = v => Number(v.toFixed(4));
    const node = createNode('sphere', {
      name: mesh.name,
      position: { x: round(c.x), y: round(c.y), z: round(c.z) },
      colorConfig: { color1: '#ffbe0b' }
    });
    node.type = 'mesh';
    node.meshId = mesh.id;
    node.params = {};
    scene.nodes.push(node);
    selectNode(node.id);
    switchLeftTab('hierarchy');
    renderInspector();
    recompileSceneShader();
  }

  function sdfBadgeHtml(mesh) {
    const s = mesh.sdf;
    if (s.status === 'ready') return `<span class="badge badge-op-union">SDF ${s.dims.join('×')}</span>`;
    if (s.status === 'error') return '<span class="badge badge-op-subtraction">SDF ERROR</span>';
    return `<span class="badge badge-rep">SDF <span data-sdf-progress-text="${mesh.id}">${Math.round((s.progress || 0) * 100)}%</span></span>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatCount(n) {
    return Number(n).toLocaleString('es-AR');
  }

  function formatBytes(b) {
    if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${b} B`;
  }

  function fmtLen(v) {
    return String(Number(Number(v).toFixed(Math.abs(v) >= 100 ? 1 : 3)));
  }

  function fmtVec(v) {
    return `(${fmtLen(v.x)}, ${fmtLen(v.y)}, ${fmtLen(v.z)})`;
  }

  // ==========================================================================
  // 3D Viewport Mouse Interactions (Gizmo Drag + Camera Orbit/Pan/Zoom)
  // ==========================================================================
  function setupViewportInteractions(canvas) {
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // 1. Check if clicking on a 3D Gizmo Axis
      const hitAxis = Renderer.hitTestGizmo(mx, my);
      const selNode = getSelectedNode();
      if (e.button === 0 && hitAxis && selNode) {
        gizmoDragAxis = hitAxis;
        Renderer.setActiveDragAxis(hitAxis);
        gizmoDragStartMouse = { x: mx, y: my };
        gizmoDragStartNodeState = JSON.parse(JSON.stringify({
          position: selNode.position,
          rot: selNode.rot,
          scale: selNode.scale
        }));
        return;
      }

      // 2. Otherwise start Camera Orbit (Left button) or Pan (Right/Middle or Shift+Left)
      isCameraDragging = true;
      cameraDragMode = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'orbit';
      lastMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Gizmo dragging
      if (gizmoDragAxis) {
        const selNode = getSelectedNode();
        if (!selNode || !gizmoDragStartNodeState) return;

        const handles = Renderer.getScreenHandles();
        const h = handles[gizmoDragAxis];
        const dx = mx - gizmoDragStartMouse.x;
        const dy = my - gizmoDragStartMouse.y;

        let delta = (dx - dy) * 0.02;
        if (h && h.dir2D && gizmoDragAxis !== 'center') {
          const len = Math.hypot(h.dir2D.x, h.dir2D.y);
          if (len > 2) {
            const ux = h.dir2D.x / len;
            const uy = h.dir2D.y / len;
            delta = (dx * ux + dy * uy) * 0.025;
          }
        }

        const mode = Renderer.getGizmoMode();
        if (mode === 'translate') {
          if (gizmoDragAxis === 'center') {
            selNode.position.x = Number((gizmoDragStartNodeState.position.x + dx * 0.02).toFixed(2));
            selNode.position.y = Number((gizmoDragStartNodeState.position.y - dy * 0.02).toFixed(2));
          } else {
            selNode.position[gizmoDragAxis] = Number((gizmoDragStartNodeState.position[gizmoDragAxis] + delta).toFixed(2));
          }
        } else if (mode === 'rotate') {
          const ax = gizmoDragAxis === 'center' ? 'y' : gizmoDragAxis;
          selNode.rot[ax] = Number((gizmoDragStartNodeState.rot[ax] + delta * 0.8).toFixed(2));
        } else if (mode === 'scale') {
          selNode.scale = Number(Math.max(0.05, gizmoDragStartNodeState.scale + delta * 0.5).toFixed(2));
        }

        renderInspector();
        recompileSceneShader();
        return;
      }

      // Camera Orbit / Pan dragging
      if (isCameraDragging) {
        const dx = e.clientX - lastMouse.x;
        const dy = e.clientY - lastMouse.y;
        lastMouse = { x: e.clientX, y: e.clientY };

        const cam = scene.globals.camera;
        if (cameraDragMode === 'orbit') {
          const dist = Math.hypot(
            cam.pos.x - orbitTarget.x,
            cam.pos.y - orbitTarget.y,
            cam.pos.z - orbitTarget.z
          ) || 10.0;

          cam.yaw = Number(((Number(cam.yaw) || 0) - dx * 0.007).toFixed(4));
          cam.pitch = Number(Math.max(-1.45, Math.min(1.45, (Number(cam.pitch) || 0) + dy * 0.007)).toFixed(4));

          // Compute forward vector from yaw/pitch matching main(void)
          // In main(void), dir=(0,0,1) rotated by pitch (yz) then yaw (xz):
          // After pitch on yz: y = -sin(pitch), z = cos(pitch)
          // After yaw on xz: x = -z*sin(yaw), z = z*cos(yaw)
          const fx = -Math.cos(cam.pitch) * Math.sin(cam.yaw);
          const fy = -Math.sin(cam.pitch);
          const fz = Math.cos(cam.pitch) * Math.cos(cam.yaw);

          cam.pos.x = Number((orbitTarget.x - fx * dist).toFixed(3));
          cam.pos.y = Number((orbitTarget.y - fy * dist).toFixed(3));
          cam.pos.z = Number((orbitTarget.z - fz * dist).toFixed(3));
        } else {
          // Pan camera & orbitTarget
          const panSpeed = 0.015;
          const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
          const shiftX = -dx * panSpeed * cy;
          const shiftZ = -dx * panSpeed * sy;
          const shiftY = dy * panSpeed;

          cam.pos.x = Number((cam.pos.x + shiftX).toFixed(3));
          cam.pos.y = Number((cam.pos.y + shiftY).toFixed(3));
          cam.pos.z = Number((cam.pos.z + shiftZ).toFixed(3));
          orbitTarget.x += shiftX;
          orbitTarget.y += shiftY;
          orbitTarget.z += shiftZ;
        }

        if (leftTab === 'globals') renderLeftPanel();
        recompileSceneShader();
        return;
      }

      // Hover detection on gizmo
      if ( mx >= 0 && my >= 0 && mx <= rect.width && my <= rect.height ) {
        const hit = Renderer.hitTestGizmo(mx, my);
        Renderer.setHoveredAxis(hit);
        canvas.style.cursor = hit ? 'pointer' : 'grab';
      }
    });

    window.addEventListener('mouseup', () => {
      if (gizmoDragAxis) {
        gizmoDragAxis = null;
        Renderer.setActiveDragAxis(null);
      }
      isCameraDragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const cam = scene.globals.camera;
      const fx = -Math.cos(cam.pitch) * Math.sin(cam.yaw);
      const fy = -Math.sin(cam.pitch);
      const fz = Math.cos(cam.pitch) * Math.cos(cam.yaw);
      const step = -e.deltaY * 0.008;

      cam.pos.x = Number((cam.pos.x + fx * step).toFixed(3));
      cam.pos.y = Number((cam.pos.y + fy * step).toFixed(3));
      cam.pos.z = Number((cam.pos.z + fz * step).toFixed(3));

      if (leftTab === 'globals') renderLeftPanel();
      recompileSceneShader();
    }, { passive: false });
  }

  // ==========================================================================
  // Left Panel Rendering (Hierarchy / IQ Primitives Catalog / Global Settings)
  // ==========================================================================
  function renderLeftPanel() {
    const container = document.getElementById('leftPanelBody');
    if (!container) return;
    container.innerHTML = '';

    if (leftTab === 'hierarchy') {
      renderHierarchyTab(container);
    } else if (leftTab === 'catalog') {
      renderCatalogTab(container);
    } else if (leftTab === 'globals') {
      renderGlobalsTab(container);
    }
  }

  function renderHierarchyTab(container) {
    const topActions = document.createElement('div');
    topActions.style.display = 'flex';
    topActions.style.gap = '6px';
    topActions.style.marginBottom = '10px';

    const btnAdd = document.createElement('button');
    btnAdd.className = 'btn btn-primary';
    btnAdd.style.flex = '1';
    btnAdd.innerHTML = '+ Agregar Geometría IQ (38)';
    btnAdd.addEventListener('click', () => switchLeftTab('catalog'));

    const btnClear = document.createElement('button');
    btnClear.className = 'btn';
    btnClear.title = 'Limpiar escena y dejar 1 esfera';
    btnClear.textContent = 'Limpiar';
    btnClear.addEventListener('click', () => {
      const n = createNode('sphere', { name: 'Esfera Base' });
      scene.nodes = [n];
      selectNode(n.id);
      renderLeftPanel();
      renderInspector();
      recompileSceneShader();
    });

    topActions.appendChild(btnAdd);
    topActions.appendChild(btnClear);
    container.appendChild(topActions);

    const list = document.createElement('div');
    list.className = 'node-list';

    const opLabels = {
      union: 'Unión',
      smoothUnion: 'Smooth Unión',
      subtraction: 'Sustracción',
      smoothSubtraction: 'Smooth Sustracción',
      intersection: 'Intersección',
      smoothIntersection: 'Smooth Intersec.',
      xor: 'XOR'
    };

    scene.nodes.forEach((node, idx) => {
      const item = document.createElement('div');
      item.className = `node-item ${node.id === selectedNodeId ? 'selected' : ''} ${!node.enabled ? 'disabled' : ''}`;

      const prim = PRIMITIVES[node.type] || PRIMITIVES.sphere;
      const opBadge = idx === 0
        ? `<span class="badge badge-op-union">BASE #1</span>`
        : `<span class="badge badge-op-${node.operation}">${opLabels[node.operation] || node.operation}</span>`;

      const repBadge = (node.domain && node.domain.repMode !== 'none')
        ? `<span class="badge badge-rep">DOM: ${node.domain.repMode.toUpperCase()}</span>`
        : '';

      item.innerHTML = `
        <div class="node-info">
          <div class="node-swatch" style="background: ${node.colorConfig?.color1 || '#ff3366'}"></div>
          <div class="node-text">
            <div class="node-name">${idx + 1}. ${node.name}</div>
            <div class="node-badges">
              ${opBadge}
              ${node.type === 'mesh'
                ? (MeshStore.get(node.meshId)
                  ? '<span class="badge badge-mesh">sdMesh</span>'
                  : '<span class="badge badge-op-subtraction">MALLA FALTANTE</span>')
                : `<span class="badge">${prim.funcName}</span>`}
              ${repBadge}
            </div>
          </div>
        </div>
        <div class="node-actions">
          <button class="icon-btn" data-act="toggle" title="Activar/Ocultar">${node.enabled ? '👁' : '🚫'}</button>
          <button class="icon-btn" data-act="up" title="Subir en jerarquía">↑</button>
          <button class="icon-btn" data-act="down" title="Bajar en jerarquía">↓</button>
          <button class="icon-btn" data-act="dup" title="Duplicar forma">⧉</button>
          <button class="icon-btn danger" data-act="del" title="Eliminar">✕</button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        const actBtn = e.target.closest('[data-act]');
        if (actBtn) {
          e.stopPropagation();
          const act = actBtn.dataset.act;
          if (act === 'toggle') {
            node.enabled = !node.enabled;
          } else if (act === 'up' && idx > 0) {
            const tmp = scene.nodes[idx - 1];
            scene.nodes[idx - 1] = scene.nodes[idx];
            scene.nodes[idx] = tmp;
          } else if (act === 'down' && idx < scene.nodes.length - 1) {
            const tmp = scene.nodes[idx + 1];
            scene.nodes[idx + 1] = scene.nodes[idx];
            scene.nodes[idx] = tmp;
          } else if (act === 'dup') {
            const clone = JSON.parse(JSON.stringify(node));
            clone.id = 'sdf_' + Math.random().toString(36).substring(2, 8);
            clone.name = node.name + ' (Copia)';
            clone.position.x = Number((Number(clone.position.x) + 1.2).toFixed(2));
            scene.nodes.splice(idx + 1, 0, clone);
            selectNode(clone.id);
          } else if (act === 'del') {
            scene.nodes.splice(idx, 1);
            if (selectedNodeId === node.id) {
              selectedNodeId = scene.nodes[scene.nodes.length - 1]?.id || null;
            }
          }
          renderLeftPanel();
          renderInspector();
          recompileSceneShader();
          return;
        }

        selectNode(node.id);
        renderLeftPanel();
        renderInspector();
      });

      list.appendChild(item);
    });

    container.appendChild(list);
    container.appendChild(buildMeshListSection());
  }

  function buildMeshListSection() {
    const meshes = MeshStore.list();
    const wrap = document.createElement('div');
    wrap.className = 'mesh-section';

    const title = document.createElement('div');
    title.className = 'mesh-section-title';
    title.textContent = `Mallas importadas (${meshes.length})`;
    wrap.appendChild(title);

    if (meshes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mesh-empty';
      empty.textContent = 'Arrastrá un GLB, OBJ o STL al viewport, o usá "⬆ Importar Malla".';
      wrap.appendChild(empty);
      return wrap;
    }

    const list = document.createElement('div');
    list.className = 'node-list';
    meshes.forEach(mesh => {
      const item = document.createElement('div');
      item.className = `node-item ${mesh.id === selectedMeshId ? 'selected' : ''}`;
      item.innerHTML = `
        <div class="node-info">
          <div class="node-swatch mesh-swatch"></div>
          <div class="node-text">
            <div class="node-name">${escapeHtml(mesh.name)}</div>
            <div class="node-badges">
              <span class="badge badge-mesh">${mesh.format.toUpperCase()}</span>
              <span class="badge">${formatCount(mesh.triangleCount)} tris</span>
              ${sdfBadgeHtml(mesh)}
            </div>
          </div>
        </div>
        <div class="node-actions">
          <button class="icon-btn" data-act="add" title="Agregar a la escena como forma (sdMesh)">➕</button>
          <button class="icon-btn" data-act="frame" title="Encuadrar cámara en el bounding box">🎯</button>
          <button class="icon-btn danger" data-act="del" title="Quitar malla">✕</button>
        </div>
      `;
      item.addEventListener('click', e => {
        const actBtn = e.target.closest('[data-act]');
        if (actBtn) {
          e.stopPropagation();
          if (actBtn.dataset.act === 'frame') frameBBox(mesh.bbox);
          if (actBtn.dataset.act === 'del') removeMesh(mesh.id);
          if (actBtn.dataset.act === 'add') addMeshNodeToScene(mesh);
          return;
        }
        selectMesh(mesh.id);
        renderLeftPanel();
        renderInspector();
      });
      list.appendChild(item);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function renderCatalogTab(container) {
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'search-input';
    search.placeholder = '🔍 Buscar primitiva IQ (ej: torus, cone, deathStar, boxFrame...)';
    container.appendChild(search);

    const listWrap = document.createElement('div');
    container.appendChild(listWrap);

    function populate(filterText = '') {
      listWrap.innerHTML = '';
      const q = filterText.trim().toLowerCase();

      CATEGORIES.forEach(cat => {
        const matching = Object.values(PRIMITIVES).filter(p =>
          p.category === cat.id &&
          (!q || p.name.toLowerCase().includes(q) || p.funcName.toLowerCase().includes(q) || p.iqName.toLowerCase().includes(q))
        );
        if (matching.length === 0) return;

        const title = document.createElement('div');
        title.className = 'cat-title';
        title.textContent = `${cat.icon} ${cat.name} (${matching.length})`;
        listWrap.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'prim-grid';

        matching.forEach(prim => {
          const btn = document.createElement('button');
          btn.className = 'prim-btn';
          btn.innerHTML = `
            <span>${prim.name.split(' (')[0]}</span>
            <span class="prim-btn-sub">${prim.funcName}()</span>
          `;
          btn.title = `${prim.name} — ${prim.iqName}`;
          btn.addEventListener('click', () => {
            const palette = ['#00f5d4', '#ff2a6d', '#ffbe0b', '#4cc9f0', '#c77dff', '#22ee66', '#ff7b00'];
            const randomCol = palette[scene.nodes.length % palette.length];
            const newNode = createNode(prim.id, {
              name: `${prim.name.split(' (')[0]} ${scene.nodes.length + 1}`,
              operation: 'smoothUnion',
              smoothK: 0.25,
              colorConfig: { mode: 'solid', color1: randomCol, color2: '#ffffff', blendStyle: 'auto' }
            });
            scene.nodes.push(newNode);
            selectNode(newNode.id);
            switchLeftTab('hierarchy');
            renderInspector();
            recompileSceneShader();
          });
          grid.appendChild(btn);
        });

        listWrap.appendChild(grid);
      });
    }

    search.addEventListener('input', (e) => populate(e.target.value));
    populate('');
  }

  function renderGlobalsTab(container) {
    const g = scene.globals;
    const gd = g.globalDomain;

    // 1. Raymarching Quality Section
    container.appendChild(buildSection('Raymarching & Precisión', [
      buildSliderRow('Detalle (det)', g.det, 0.0001, 0.02, 0.0001, v => { g.det = v; recompileSceneShader(); }),
      buildSliderRow('Dist. Máx', g.maxdist, 10, 300, 5, v => { g.maxdist = v; recompileSceneShader(); }),
      buildSliderRow('Pasos (maxsteps)', g.maxsteps, 20, 250, 5, v => { g.maxsteps = Math.round(v); recompileSceneShader(); }),
      buildSliderRow('Factor Paso (d*)', g.stepFactor, 0.1, 1.0, 0.05, v => { g.stepFactor = v; recompileSceneShader(); })
    ]));

    // 2. Camera Section
    container.appendChild(buildSection('Cámara 3D (from / dir)', [
      buildVec3Row('Posición (from)', g.camera.pos, 0.2, () => recompileSceneShader()),
      buildSliderRow('Yaw (Giro XZ)', g.camera.yaw, -3.14, 3.14, 0.02, v => { g.camera.yaw = v; recompileSceneShader(); }),
      buildSliderRow('Pitch (Giro YZ)', g.camera.pitch, -1.5, 1.5, 0.02, v => { g.camera.pitch = v; recompileSceneShader(); }),
      buildSliderRow('FOV / Zoom', g.camera.fov, 0.3, 2.5, 0.05, v => { g.camera.fov = v; recompileSceneShader(); })
    ]));

    // 3. Global Domain Subdivision
    container.appendChild(buildSection('Dominio Maestro Global', [
      buildCheckboxRow('Rotar Dominio con time', gd.rotateWithTime, v => { gd.rotateWithTime = v; renderLeftPanel(); recompileSceneShader(); }),
      ...(gd.rotateWithTime ? [
        buildSliderRow('Vel. XZ (time*)', gd.rotSpeedXZ, -2.0, 2.0, 0.05, v => { gd.rotSpeedXZ = v; recompileSceneShader(); }),
        buildSliderRow('Vel. XY (time*)', gd.rotSpeedXY, -2.0, 2.0, 0.05, v => { gd.rotSpeedXY = v; recompileSceneShader(); })
      ] : []),
      buildCheckboxRow('Simetría Global X (abs(p.x))', gd.symX, v => { gd.symX = v; recompileSceneShader(); }),
      buildCheckboxRow('Simetría Global Y (abs(p.y))', gd.symY, v => { gd.symY = v; recompileSceneShader(); }),
      buildCheckboxRow('Simetría Global Z (abs(p.z))', gd.symZ, v => { gd.symZ = v; recompileSceneShader(); }),
      buildSelectRow('Repetición Global', gd.repMode, [
        { value: 'none', label: 'Ninguna' },
        { value: 'infinite', label: 'Infinita (mod global)' },
        { value: 'polar', label: 'Polar (opRepPolar XZ)' }
      ], v => { gd.repMode = v; renderLeftPanel(); recompileSceneShader(); }),
      ...(gd.repMode === 'infinite' ? [
        buildVec3Row('Celda (ms)', gd.ms, 0.5, () => recompileSceneShader())
      ] : []),
      ...(gd.repMode === 'polar' ? [
        buildSliderRow('Sectores Polares', gd.polarCount, 2, 24, 1, v => { gd.polarCount = v; recompileSceneShader(); })
      ] : [])
    ]));

    // 4. Lighting & Background
    container.appendChild(buildSection('Iluminación (shade) y Fondo', [
      buildVec3Row('Dirección Luz', g.lightDir, 0.1, () => recompileSceneShader()),
      buildSliderRow('Ambiente (amb)', g.ambient, 0.0, 0.6, 0.02, v => { g.ambient = v; recompileSceneShader(); }),
      buildSliderRow('Brillo Especular', g.specIntensity, 0.0, 2.0, 0.05, v => { g.specIntensity = v; recompileSceneShader(); }),
      buildSliderRow('Exponente Spec', g.specPower, 2.0, 128.0, 1.0, v => { g.specPower = v; recompileSceneShader(); }),
      buildColorRow('Color Fondo', g.bgColor, v => { g.bgColor = v; recompileSceneShader(); }),
      buildSelectRow('Estilo Fondo', g.bgStyle, [
        { value: 'solid', label: 'Color Sólido' },
        { value: 'gradient', label: 'Gradiente Estudio' },
        { value: 'scanlines', label: 'Scanlines (mod gl_FragCoord.y)' }
      ], v => { g.bgStyle = v; recompileSceneShader(); })
    ]));
  }

  // ==========================================================================
  // Right Panel Inspector (Selected SDF Node Properties)
  // ==========================================================================
  function renderInspector() {
    const container = document.getElementById('inspectorBody');
    if (!container) return;
    container.innerHTML = '';

    const mesh = selectedMeshId && MeshStore.get(selectedMeshId);
    if (mesh) {
      renderMeshInspector(container, mesh);
      return;
    }

    const node = getSelectedNode();
    if (!node) {
      container.innerHTML = `<div style="padding:20px;color:var(--text-muted);text-align:center;">Seleccioná o agregá una forma SDF para editar sus parámetros, transformaciones y subdivisión de dominio.</div>`;
      return;
    }

    const isMeshNode = node.type === 'mesh';
    const prim = isMeshNode
      ? { id: 'mesh', name: 'Malla importada', funcName: 'sdMesh', params: [], sizeable: false }
      : (PRIMITIVES[node.type] || PRIMITIVES.sphere);

    // 1. Identity, Primitive Type & CSG Combination Operation
    const primOptions = Object.values(PRIMITIVES).map(p => ({
      value: p.id,
      label: `${p.name} [${p.funcName}]`
    }));
    // Un nodo malla se crea desde "Mallas importadas" (➕); acá solo puede pasar a ser una primitiva.
    if (isMeshNode) primOptions.unshift({ value: 'mesh', label: 'Malla importada [sdMesh]' });

    const csgRows = [
      buildTextRow('Nombre', node.name, v => {
        node.name = v;
        renderLeftPanel();
        recompileSceneShader();
      }),
      buildSelectRow('Geometría IQ', node.type, primOptions, v => {
        const newPrim = PRIMITIVES[v];
        if (!newPrim) return;
        node.type = v;
        delete node.meshId;
        node.params = {};
        newPrim.params.forEach(p => { node.params[p.id] = p.default; });
        renderLeftPanel();
        renderInspector();
        recompileSceneShader();
      }),
      buildSelectRow('Operación CSG', node.operation, [
        { value: 'union', label: 'Unión Exacta — min(d1, d2)' },
        { value: 'smoothUnion', label: 'Unión Suave — opSmoothUnion(a, b, k)' },
        { value: 'subtraction', label: 'Sustracción — max(-d1, d2)' },
        { value: 'smoothSubtraction', label: 'Sustracción Suave — opSmoothSubtraction' },
        { value: 'intersection', label: 'Intersección — max(d1, d2)' },
        { value: 'smoothIntersection', label: 'Intersección Suave — opSmoothIntersection' },
        { value: 'xor', label: 'XOR Exacto — opXor(a, b)' }
      ], v => {
        node.operation = v;
        renderLeftPanel();
        renderInspector();
        recompileSceneShader();
      })
    ];

    if (node.operation.startsWith('smooth')) {
      csgRows.push(
        buildSliderRow('Suavizado (k)', node.smoothK, 0.01, 5.0, 0.02, v => {
          node.smoothK = v;
          recompileSceneShader();
        })
      );
    }

    if (node.operation === 'subtraction' || node.operation === 'smoothSubtraction') {
      csgRows.push(
        buildCheckboxRow('Invertir Orden (opSmoothSubtraction(d, geo))', node.swapOrder, v => {
          node.swapOrder = v;
          recompileSceneShader();
        })
      );
    }

    container.appendChild(buildSection('1. Geometría & Operación Booleana', csgRows));

    // 2. Color & Material Blending
    const cc = node.colorConfig;
    const colorRows = [
      buildSelectRow('Modo de Color', cc.mode, [
        { value: 'solid', label: 'Color Sólido (vec3)' },
        { value: 'indexWave', label: 'Onda por Índice Espacial (sin(index + time))' },
        { value: 'normalGrad', label: 'Gradiente Vertical Local' },
        { value: 'distanceMix', label: 'Gradiente por Campo de Distancia' }
      ], v => {
        cc.mode = v;
        renderInspector();
        recompileSceneShader();
      }),
      buildColorRow('Color Principal (c1)', cc.color1, v => {
        cc.color1 = v;
        renderLeftPanel();
        recompileSceneShader();
      })
    ];

    if (cc.mode !== 'solid') {
      colorRows.push(
        buildColorRow('Color Secundario (c2)', cc.color2, v => {
          cc.color2 = v;
          recompileSceneShader();
        })
      );
    }

    if (cc.mode === 'indexWave') {
      colorRows.push(
        buildSelectRow('Eje de Índice', cc.waveIndexAxis, [
          { value: 'x', label: 'indexx (Eje X)' },
          { value: 'y', label: 'indexy (Eje Y)' },
          { value: 'z', label: 'indexz (Eje Z)' }
        ], v => { cc.waveIndexAxis = v; recompileSceneShader(); }),
        buildSliderRow('Frecuencia Índice', cc.waveFreq, 0.1, 10.0, 0.1, v => { cc.waveFreq = v; recompileSceneShader(); }),
        buildSliderRow('Velocidad time', cc.waveSpeed, -10.0, 10.0, 0.1, v => { cc.waveSpeed = v; recompileSceneShader(); })
      );
    }

    colorRows.push(
      buildSelectRow('Mezcla en objcol', cc.blendStyle, [
        { value: 'auto', label: 'Automática / Smooth Blend' },
        { value: 'rawDistanceMix', label: 'Mix Crudo (Tu Shader Base)' },
        { value: 'override', label: 'Sobrescribir objcol' }
      ], v => { cc.blendStyle = v; recompileSceneShader(); })
    );

    container.appendChild(buildSection('2. Color & Mezcla en objcol', colorRows));

    // 3. IQ Primitive Parameters (o, para un nodo malla, qué malla usa y el estado de su SDF)
    if (isMeshNode) {
      const linked = MeshStore.get(node.meshId);
      const meshOptions = MeshStore.list().map(m => ({ value: m.id, label: `${m.name} (${m.format.toUpperCase()})` }));
      if (!linked) meshOptions.unshift({ value: node.meshId, label: '— malla faltante —' });
      const s = linked?.sdf;
      const status = !linked ? 'La malla se quitó: el nodo no aporta geometría.'
        : s.status === 'ready' ? `Listo: ${s.dims.join(' × ')} vóxeles (${(s.ms / 1000).toFixed(1)} s)`
        : s.status === 'error' ? `Error: ${s.error} — se usa su bounding box`
        : 'Generando… mientras tanto se usa su bounding box';
      const meshRows = [
        buildSelectRow('Malla', node.meshId, meshOptions, v => {
          node.meshId = v;
          renderLeftPanel();
          renderInspector();
          recompileSceneShader();
        }),
        buildInfoRow('SDF', status)
      ];
      if (linked) {
        const btnOpen = document.createElement('button');
        btnOpen.className = 'btn';
        btnOpen.textContent = 'Ver malla (resolución, eje…)';
        btnOpen.addEventListener('click', () => { selectMesh(linked.id); renderLeftPanel(); renderInspector(); });
        meshRows.push(btnOpen);
      }
      container.appendChild(buildSection('3. Malla (sdMesh)', meshRows));
    }

    const paramRows = prim.params.map(pDef =>
      buildSliderRow(pDef.label, node.params[pDef.id], pDef.min, pDef.max, pDef.step, v => {
        node.params[pDef.id] = v;
        recompileSceneShader();
      })
    );

    if (prim.sizeable) {
      paramRows.push(
        buildCheckboxRow('Modular Tamaño con sin(index + time)', node.sizeModEnabled, v => {
          node.sizeModEnabled = v;
          renderInspector();
          recompileSceneShader();
        })
      );
      if (node.sizeModEnabled) {
        paramRows.push(
          buildSelectRow('Índice Fuente', node.sizeModAxis, [
            { value: 'x', label: 'indexx' },
            { value: 'y', label: 'indexy' },
            { value: 'z', label: 'indexz' }
          ], v => { node.sizeModAxis = v; recompileSceneShader(); }),
          buildSliderRow('Frec. Onda Tamaño', node.sizeModFreq, 0.5, 25.0, 0.5, v => { node.sizeModFreq = v; recompileSceneShader(); }),
          buildSliderRow('Vel. time Tamaño', node.sizeModSpeed, -10.0, 10.0, 0.2, v => { node.sizeModSpeed = v; recompileSceneShader(); }),
          buildSliderRow('Amplitud Tamaño', node.sizeModAmp, 0.0, 3.0, 0.05, v => { node.sizeModAmp = v; recompileSceneShader(); })
        );
      }
    }

    if (!isMeshNode) container.appendChild(buildSection(`3. Parámetros ${prim.funcName}()`, paramRows));

    // 4. 3D Transform (Position, Rotation, Scale & Time Animation)
    container.appendChild(buildSection('4. Transformación 3D & Animación', [
      buildVec3Row('Posición (XYZ)', node.position, 0.1, () => recompileSceneShader()),
      buildVec3Row('Velocidad (time*)', node.linearVel, 0.2, () => recompileSceneShader()),
      buildVec3Row('Rotación (rad)', node.rot, 0.05, () => recompileSceneShader()),
      buildVec3Row('Giro (time*)', node.rotSpeed, 0.05, () => recompileSceneShader()),
      buildSliderRow('Escala Uniforme', node.scale, 0.1, 5.0, 0.05, v => {
        node.scale = v;
        recompileSceneShader();
      })
    ]));

    // 5. Domain Subdivision & Symmetry (IQ Domain Operations)
    const dom = node.domain;
    const domRows = [
      buildCheckboxRow('Simetría Eje X — p.x = abs(p.x)', dom.symX, v => { dom.symX = v; renderInspector(); recompileSceneShader(); }),
      buildCheckboxRow('Simetría Eje Y — p.y = abs(p.y)', dom.symY, v => { dom.symY = v; renderInspector(); recompileSceneShader(); }),
      buildCheckboxRow('Simetría Eje Z — p.z = abs(p.z)', dom.symZ, v => { dom.symZ = v; renderInspector(); recompileSceneShader(); })
    ];

    if (dom.symX || dom.symY || dom.symZ) {
      domRows.push(buildVec3Row('Offset Simetría', dom.symOffset, 0.1, () => recompileSceneShader()));
    }

    domRows.push(
      buildSelectRow('Subdivisión Dominio', dom.repMode, [
        { value: 'none', label: 'Sin Repetición' },
        { value: 'infinite', label: 'Repetición Infinita (mod + indexx/y/z)' },
        { value: 'finite', label: 'Repetición Finita (opRepLim)' },
        { value: 'polar', label: 'Repetición Polar / Radial (opRepPolar)' }
      ], v => {
        dom.repMode = v;
        renderLeftPanel();
        renderInspector();
        recompileSceneShader();
      })
    );

    if (dom.repMode === 'infinite') {
      domRows.push(
        buildVec3Row('Tamaño Celda (ms)', dom.ms, 0.5, () => recompileSceneShader()),
        buildCheckboxRow('Repetir en X (mod p.x)', dom.repAxes.x, v => { dom.repAxes.x = v; recompileSceneShader(); }),
        buildCheckboxRow('Repetir en Y (mod p.y)', dom.repAxes.y, v => { dom.repAxes.y = v; recompileSceneShader(); }),
        buildCheckboxRow('Repetir en Z (mod p.z)', dom.repAxes.z, v => { dom.repAxes.z = v; recompileSceneShader(); }),
        buildCheckboxRow('Desplazar por Onda de Índice (sin(index+time))', dom.indexWaveEnabled, v => {
          dom.indexWaveEnabled = v;
          renderInspector();
          recompileSceneShader();
        })
      );
      if (dom.indexWaveEnabled) {
        domRows.push(
          buildSelectRow('Eje Afectado', dom.indexWaveTargetAxis, [
            { value: 'x', label: 'p.x +=' },
            { value: 'y', label: 'p.y +=' },
            { value: 'z', label: 'p.z +=' }
          ], v => { dom.indexWaveTargetAxis = v; recompileSceneShader(); }),
          buildSelectRow('Índice Fuente', dom.indexWaveSourceAxis, [
            { value: 'x', label: 'indexx' },
            { value: 'y', label: 'indexy' },
            { value: 'z', label: 'indexz' }
          ], v => { dom.indexWaveSourceAxis = v; recompileSceneShader(); }),
          buildSliderRow('Frec. Índice', dom.indexWaveFreq, 0.1, 10.0, 0.1, v => { dom.indexWaveFreq = v; recompileSceneShader(); }),
          buildSliderRow('Amplitud Onda', dom.indexWaveAmp, 0.0, 5.0, 0.1, v => { dom.indexWaveAmp = v; recompileSceneShader(); })
        );
      }
    } else if (dom.repMode === 'finite') {
      domRows.push(
        buildVec3Row('Separación (s)', dom.limPeriod, 0.2, () => recompileSceneShader()),
        buildVec3Row('Límite - (limA)', dom.limMin, 1.0, () => recompileSceneShader()),
        buildVec3Row('Límite + (limB)', dom.limMax, 1.0, () => recompileSceneShader())
      );
    } else if (dom.repMode === 'polar') {
      domRows.push(
        buildSliderRow('Repeticiones (N)', dom.polarCount, 2, 32, 1, v => { dom.polarCount = Math.round(v); recompileSceneShader(); }),
        buildSelectRow('Plano Polar', dom.polarPlane, [
          { value: 'xz', label: 'Plano XZ (Alrededor de Y)' },
          { value: 'xy', label: 'Plano XY (Alrededor de Z)' },
          { value: 'yz', label: 'Plano YZ (Alrededor de X)' }
        ], v => { dom.polarPlane = v; recompileSceneShader(); }),
        buildSliderRow('Radio Offset', dom.polarRadiusOffset, 0.0, 10.0, 0.1, v => { dom.polarRadiusOffset = v; recompileSceneShader(); })
      );
    }

    container.appendChild(buildSection('5. Subdivisión de Dominio & Simetría IQ', domRows));

    // 6. IQ Alterations & Deformations (Elongate, Round, Onion, Twist, Bend, Displace)
    const mod = node.modifiers;
    const modRows = [
      // Elongate
      buildCheckboxRow('Elongación Exacta (opElongate)', mod.elongateEnabled, v => {
        mod.elongateEnabled = v;
        renderInspector();
        recompileSceneShader();
      }),
      ...(mod.elongateEnabled ? [
        buildVec3Row('Elongar (h)', mod.elongate, 0.05, () => recompileSceneShader())
      ] : []),

      // Rounding
      buildCheckboxRow('Redondear Bordes (opRound: d - r)', mod.roundEnabled, v => {
        mod.roundEnabled = v;
        renderInspector();
        recompileSceneShader();
      }),
      ...(mod.roundEnabled ? [
        buildSliderRow('Radio (r)', mod.roundRad, 0.0, 1.5, 0.02, v => { mod.roundRad = v; recompileSceneShader(); })
      ] : []),

      // Onion
      buildCheckboxRow('Ahuecar / Capas Cebolla (opOnion)', mod.onionEnabled, v => {
        mod.onionEnabled = v;
        renderInspector();
        recompileSceneShader();
      }),
      ...(mod.onionEnabled ? [
        buildSliderRow('Grosor Capa', mod.onionThickness, 0.01, 1.0, 0.01, v => { mod.onionThickness = v; recompileSceneShader(); }),
        buildSliderRow('N° de Capas', mod.onionLayers, 1, 4, 1, v => { mod.onionLayers = Math.round(v); recompileSceneShader(); })
      ] : []),

      // Twist
      buildCheckboxRow('Torsión Espacial (opTwist)', mod.twistEnabled, v => {
        mod.twistEnabled = v;
        renderInspector();
        recompileSceneShader();
      }),
      ...(mod.twistEnabled ? [
        buildSelectRow('Eje Torsión', mod.twistAxis, [
          { value: 'y', label: 'Eje Y (XZ gira con Y)' },
          { value: 'x', label: 'Eje X (YZ gira con X)' },
          { value: 'z', label: 'Eje Z (XY gira con Z)' }
        ], v => { mod.twistAxis = v; recompileSceneShader(); }),
        buildSliderRow('Fuerza Torsión (k)', mod.twistAmount, -5.0, 5.0, 0.05, v => { mod.twistAmount = v; recompileSceneShader(); })
      ] : []),

      // Bend
      buildCheckboxRow('Curvatura Espacial (opBend)', mod.bendEnabled, v => {
        mod.bendEnabled = v;
        renderInspector();
        recompileSceneShader();
      }),
      ...(mod.bendEnabled ? [
        buildSelectRow('Eje Curvatura', mod.bendAxis, [
          { value: 'x', label: 'Curvar XY a lo largo de X' },
          { value: 'y', label: 'Curvar YZ a lo largo de Y' },
          { value: 'z', label: 'Curvar XZ a lo largo de Z' }
        ], v => { mod.bendAxis = v; recompileSceneShader(); }),
        buildSliderRow('Fuerza Curva (k)', mod.bendAmount, -3.0, 3.0, 0.05, v => { mod.bendAmount = v; recompileSceneShader(); })
      ] : []),

      // Displacement
      buildCheckboxRow('Desplazamiento Sinusoidal (opDisplace)', mod.displaceEnabled, v => {
        mod.displaceEnabled = v;
        renderInspector();
        recompileSceneShader();
      }),
      ...(mod.displaceEnabled ? [
        buildSliderRow('Frecuencia (freq)', mod.displaceFreq, 0.5, 25.0, 0.5, v => { mod.displaceFreq = v; recompileSceneShader(); }),
        buildSliderRow('Amplitud (amp)', mod.displaceAmp, 0.0, 0.6, 0.01, v => { mod.displaceAmp = v; recompileSceneShader(); }),
        buildSliderRow('Velocidad time', mod.displaceSpeed, -8.0, 8.0, 0.2, v => { mod.displaceSpeed = v; recompileSceneShader(); })
      ] : [])
    ];

    container.appendChild(buildSection('6. Alteraciones y Deformaciones IQ', modRows));
  }

  // Inspector de una malla importada (solo lectura + orientación; todavía no se raymarchea)
  function renderMeshInspector(container, mesh) {
    const note = document.createElement('div');
    note.className = 'mesh-note';
    note.textContent = 'Su SDF se genera en segundo plano. Para verla en el render, agregala a la escena como forma (➕): se combina con el resto por CSG.';
    container.appendChild(note);

    const warnings = [...mesh.warnings];
    if (mesh.triangleCount > LARGE_MESH_TRIANGLES) {
      warnings.push(`Malla pesada (${formatCount(mesh.triangleCount)} triángulos): convertirla a SDF va a ser lento. Conviene decimarla en Blender.`);
    }
    const warnEls = warnings.map(w => {
      const el = document.createElement('div');
      el.className = 'mesh-warning';
      el.textContent = `⚠ ${w}`;
      return el;
    });

    container.appendChild(buildSection('1. Malla Importada', [
      buildTextRow('Nombre', mesh.name, v => { mesh.name = v; renderLeftPanel(); }),
      buildInfoRow('Formato', `${mesh.format.toUpperCase()} · ${formatBytes(mesh.fileSize)}`),
      buildInfoRow('Piezas', formatCount(mesh.meshCount)),
      buildInfoRow('Triángulos', formatCount(mesh.triangleCount)),
      ...warnEls
    ]));

    const b = mesh.bbox;
    container.appendChild(buildSection('2. Bounding Box (editor, Y arriba)', [
      buildInfoRow('Mínimo', fmtVec(b.min)),
      buildInfoRow('Máximo', fmtVec(b.max)),
      buildInfoRow('Tamaño', fmtVec(b.size)),
      buildInfoRow('Centro', fmtVec(b.center))
    ]));

    container.appendChild(buildSection('3. Orientación', [
      buildSelectRow('Eje arriba del archivo', mesh.upAxis, [
        { value: 'y', label: 'Y (sin conversión) — GLB / OBJ de Blender' },
        { value: 'z', label: 'Z → convertir a Y — STL de Blender' }
      ], v => MeshStore.setUpAxis(mesh.id, v)) // onChange regenera el SDF y re-renderiza
    ]));

    // 4. SDF en grilla 3D (Web Worker + three-mesh-bvh)
    const s = mesh.sdf;
    const sdfRows = [];
    if (s.status === 'ready') {
      sdfRows.push(
        buildInfoRow('Estado', `Listo en ${(s.ms / 1000).toFixed(2)} s`),
        buildInfoRow('Grilla', `${s.dims.join(' × ')} vóxeles`),
        buildInfoRow('Vóxel', fmtLen(s.voxel)),
        buildInfoRow('Memoria GPU', formatBytes(s.dims[0] * s.dims[1] * s.dims[2] * 2))
      );
    } else if (s.status === 'error') {
      const err = document.createElement('div');
      err.className = 'mesh-warning';
      err.textContent = `⚠ Error al generar: ${s.error}`;
      sdfRows.push(err);
    } else {
      const pct = Math.round((s.progress || 0) * 100);
      const bar = document.createElement('div');
      bar.className = 'progress-track';
      bar.innerHTML = `<div class="progress-fill" data-sdf-progress="${mesh.id}" style="width:${pct}%"></div>`;
      sdfRows.push(buildInfoRow('Estado', 'Generando en segundo plano…'), bar);
    }
    sdfRows.push(
      buildSelectRow('Resolución (eje mayor)', String(mesh.sdfResolution),
        MeshStore.SDF_RESOLUTIONS.map(r => ({ value: String(r), label: `${r} vóxeles` })),
        v => MeshStore.setSdfResolution(mesh.id, Number(v))) // onChange regenera
    );
    const btnRebake = document.createElement('button');
    btnRebake.className = 'btn';
    btnRebake.textContent = '↻ Regenerar SDF';
    btnRebake.addEventListener('click', () => MeshStore.setSdf(mesh.id, { status: 'idle', progress: 0 }));
    sdfRows.push(btnRebake);
    const hint = document.createElement('div');
    hint.className = 'mesh-hint';
    hint.textContent = 'El signo (adentro/afuera) supone una malla cerrada. Con agujeros pueden aparecer artefactos.';
    sdfRows.push(hint);
    container.appendChild(buildSection('4. SDF (grilla 3D)', sdfRows));

    const usedBy = scene.nodes.filter(n => n.type === 'mesh' && n.meshId === mesh.id).length;
    const btnAdd = document.createElement('button');
    btnAdd.className = 'btn btn-primary mesh-add-btn';
    btnAdd.textContent = usedBy ? `➕ Agregar otra vez a la escena (ya en ${usedBy})` : '➕ Agregar a la escena como forma';
    btnAdd.addEventListener('click', () => addMeshNodeToScene(mesh));
    container.appendChild(btnAdd);

    const actions = document.createElement('div');
    actions.className = 'mesh-actions';
    const btnFrame = document.createElement('button');
    btnFrame.className = 'btn btn-primary';
    btnFrame.textContent = '🎯 Encuadrar';
    btnFrame.title = 'Mover la cámara para ver todo el bounding box';
    btnFrame.addEventListener('click', () => frameBBox(mesh.bbox));
    const btnRemove = document.createElement('button');
    btnRemove.className = 'btn';
    btnRemove.textContent = 'Quitar malla';
    btnRemove.addEventListener('click', () => removeMesh(mesh.id));
    actions.appendChild(btnFrame);
    actions.appendChild(btnRemove);
    container.appendChild(actions);
  }

  // ==========================================================================
  // UI Control Builders
  // ==========================================================================
  function buildInfoRow(label, value) {
    const row = document.createElement('div');
    row.className = 'control-row';
    const lbl = document.createElement('span');
    lbl.className = 'control-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'control-value';
    val.textContent = value;
    row.appendChild(lbl);
    row.appendChild(val);
    return row;
  }

  function buildSection(title, rows) {
    const sec = document.createElement('div');
    sec.className = 'inspector-section';

    const head = document.createElement('div');
    head.className = 'section-title';
    head.textContent = title;
    sec.appendChild(head);

    const body = document.createElement('div');
    body.className = 'section-content';
    rows.forEach(r => { if (r) body.appendChild(r); });
    sec.appendChild(body);
    return sec;
  }

  function buildSliderRow(label, value, min, max, step, onChange) {
    const row = document.createElement('div');
    row.className = 'control-row';

    const lbl = document.createElement('span');
    lbl.className = 'control-label';
    lbl.textContent = label;
    lbl.title = label;

    const wrap = document.createElement('div');
    wrap.className = 'control-inputs';

    const range = document.createElement('input');
    range.type = 'range';
    range.min = min;
    range.max = max;
    range.step = step;
    range.value = value;

    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'num-input';
    num.step = step;
    num.value = value;

    range.addEventListener('input', () => {
      const v = parseFloat(range.value);
      num.value = v;
      onChange(v);
    });

    num.addEventListener('input', () => {
      const v = parseFloat(num.value);
      if (!isNaN(v)) {
        range.value = v;
        onChange(v);
      }
    });

    wrap.appendChild(range);
    wrap.appendChild(num);
    row.appendChild(lbl);
    row.appendChild(wrap);
    return row;
  }

  function buildVec3Row(label, vecObj, step, onChange) {
    const row = document.createElement('div');
    row.className = 'control-row';

    const lbl = document.createElement('span');
    lbl.className = 'control-label';
    lbl.textContent = label;
    lbl.title = label;

    const grid = document.createElement('div');
    grid.className = 'vec3-grid';

    ['x', 'y', 'z'].forEach(axis => {
      const field = document.createElement('div');
      field.className = 'vec3-field';

      const tag = document.createElement('span');
      tag.className = `vec3-tag tag-${axis}`;
      tag.textContent = axis.toUpperCase();

      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = step;
      inp.value = vecObj[axis];

      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (!isNaN(v)) {
          vecObj[axis] = v;
          onChange(vecObj);
        }
      });

      field.appendChild(tag);
      field.appendChild(inp);
      grid.appendChild(field);
    });

    row.appendChild(lbl);
    row.appendChild(grid);
    return row;
  }

  function buildTextRow(label, value, onChange) {
    const row = document.createElement('div');
    row.className = 'control-row';

    const lbl = document.createElement('span');
    lbl.className = 'control-label';
    lbl.textContent = label;

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'text-input';
    inp.value = value;
    inp.addEventListener('input', () => onChange(inp.value));

    row.appendChild(lbl);
    row.appendChild(inp);
    return row;
  }

  function buildSelectRow(label, value, options, onChange) {
    const row = document.createElement('div');
    row.className = 'control-row';

    const lbl = document.createElement('span');
    lbl.className = 'control-label';
    lbl.textContent = label;

    const sel = document.createElement('select');
    sel.className = 'select-input';
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === value) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => onChange(sel.value));

    row.appendChild(lbl);
    row.appendChild(sel);
    return row;
  }

  function buildCheckboxRow(label, checked, onChange) {
    const row = document.createElement('label');
    row.className = 'checkbox-row';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!checked;
    chk.addEventListener('change', () => onChange(chk.checked));

    const span = document.createElement('span');
    span.textContent = label;

    row.appendChild(chk);
    row.appendChild(span);
    return row;
  }

  function buildColorRow(label, value, onChange) {
    const row = document.createElement('div');
    row.className = 'control-row';

    const lbl = document.createElement('span');
    lbl.className = 'control-label';
    lbl.textContent = label;

    const wrap = document.createElement('div');
    wrap.className = 'control-inputs';

    const col = document.createElement('input');
    col.type = 'color';
    col.value = value || '#ff3366';

    const txt = document.createElement('input');
    txt.type = 'text';
    txt.className = 'text-input';
    txt.style.fontFamily = 'var(--font-code)';
    txt.value = value || '#ff3366';

    col.addEventListener('input', () => {
      txt.value = col.value;
      onChange(col.value);
    });

    txt.addEventListener('change', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(txt.value)) {
        col.value = txt.value;
        onChange(txt.value);
      }
    });

    wrap.appendChild(col);
    wrap.appendChild(txt);
    row.appendChild(lbl);
    row.appendChild(wrap);
    return row;
  }

  window.addEventListener('DOMContentLoaded', init);

  return {
    getScene: () => scene,
    getShaderCode: () => currentShaderCode
  };
})();
