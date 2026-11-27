// ============================================================================
// IQ-SDF SUPREME ENGINE — WebGL Raymarcher + 3D Transform Gizmo Overlay
// Supports uniform float time, uniform vec2 resolution, uniform sampler2D backbuffer
// ============================================================================

window.SDFRenderer = (function () {
  let gl = null;
  let glCanvas = null;
  let gizmoCanvas = null;
  let gctx = null;

  let program = null;
  let quadBuffer = null;
  let fbos = [null, null];
  let fboTextures = [null, null];
  let currentFboIdx = 0;

  let startTime = performance.now();
  let elapsedTime = 0;
  let isPlaying = true;
  let lastFrameTime = performance.now();
  let fps = 60;
  let resScale = 1.0;

  // Gizmo state
  let gizmoMode = 'translate'; // 'translate' | 'rotate' | 'scale'
  let showGizmo = true;
  let hoveredAxis = null; // 'x' | 'y' | 'z' | 'center' | null
  let activeDragAxis = null;
  let dragStartMouse = { x: 0, y: 0 };
  let dragStartValue = null;
  let screenHandles = {};

  // WebGL2 acepta shaders GLSL ES 1.00 y 3.00, pero vertex y fragment deben tener la misma versión.
  // El generador emite 3.00 (necesario para sampler3D); un shader viejo pegado en "Editar Manual"
  // en 1.00 sigue funcionando porque se elige el vertex shader que corresponde.
  const VERTEX_SHADER_300 = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;
  const VERTEX_SHADER_100 = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

  function isGLSL300(source) {
    return /^\s*#version\s+300\s+es\b/.test(source);
  }

  // Texturas 3D con el SDF de cada malla importada: meshId -> { tex, dims }
  // En el shader se leen con `uniform highp sampler3D uMeshSdf_<meshId>`.
  const meshTextures = new Map();
  let dummyTex3D = null; // 1x1x1, para samplers declarados sin textura (evita conflictos de unidad)

  function init(canvasEl, gizmoCanvasEl) {
    glCanvas = canvasEl;
    gizmoCanvas = gizmoCanvasEl;
    gctx = gizmoCanvas.getContext('2d');

    gl = glCanvas.getContext('webgl2', { preserveDrawingBuffer: true });

    if (!gl) {
      console.error('WebGL2 no soportado');
      return false;
    }

    dummyTex3D = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, dummyTex3D);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, 1, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([1000]));
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    resize();
    window.addEventListener('resize', resize);
    return true;
  }

  function createFBO(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex };
  }

  function resize() {
    if (!glCanvas || !gl) return;
    const rect = glCanvas.parentElement.getBoundingClientRect();
    const w = Math.max(64, Math.floor(rect.width * resScale));
    const h = Math.max(64, Math.floor(rect.height * resScale));

    if (glCanvas.width !== w || glCanvas.height !== h) {
      glCanvas.width = w;
      glCanvas.height = h;
      for (let i = 0; i < 2; i++) {
        if (fbos[i]) gl.deleteFramebuffer(fbos[i]);
        if (fboTextures[i]) gl.deleteTexture(fboTextures[i]);
        const created = createFBO(w, h);
        fbos[i] = created.fbo;
        fboTextures[i] = created.tex;
      }
    }

    if (gizmoCanvas) {
      gizmoCanvas.width = Math.max(64, Math.floor(rect.width));
      gizmoCanvas.height = Math.max(64, Math.floor(rect.height));
    }
  }

  function compileShader(source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      return { error: info };
    }
    return { shader };
  }

  // Sube (o reemplaza) el SDF de una malla como textura 3D R16F con filtrado lineal.
  // data: Float32Array de nx*ny*nz distancias, índice = x + nx*(y + ny*z).
  function uploadMeshSdf(meshId, data, nx, ny, nz) {
    if (!gl) return;
    deleteMeshSdf(meshId);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, nx, ny, nz, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_3D, null);
    meshTextures.set(meshId, { tex, dims: [nx, ny, nz] });
  }

  function deleteMeshSdf(meshId) {
    const entry = meshTextures.get(meshId);
    if (entry && gl) gl.deleteTexture(entry.tex);
    meshTextures.delete(meshId);
  }

  // Vincula cada sampler3D uMeshSdf_<id> activo del programa a su textura (unidades 1..N).
  function bindMeshTextures() {
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    let unit = 1; // la unidad 0 es del backbuffer
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info || info.type !== gl.SAMPLER_3D) continue;
      const m = /^uMeshSdf_(.+)$/.exec(info.name);
      const entry = m && meshTextures.get(m[1]);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_3D, entry ? entry.tex : dummyTex3D);
      gl.uniform1i(gl.getUniformLocation(program, info.name), unit);
      unit++;
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  function updateFragmentShader(fragSource) {
    if (!gl) return { ok: false, error: 'WebGL2 no inicializado' };
    // #version tiene que ser lo primero del código: se descartan espacios/saltos iniciales.
    fragSource = fragSource.replace(/^\s+/, '');
    const vs = compileShader(isGLSL300(fragSource) ? VERTEX_SHADER_300 : VERTEX_SHADER_100, gl.VERTEX_SHADER);
    if (vs.error) return { ok: false, error: vs.error };

    const fs = compileShader(fragSource, gl.FRAGMENT_SHADER);
    if (fs.error) {
      gl.deleteShader(vs.shader);
      return { ok: false, error: fs.error };
    }

    const newProg = gl.createProgram();
    gl.attachShader(newProg, vs.shader);
    gl.attachShader(newProg, fs.shader);
    gl.linkProgram(newProg);

    gl.deleteShader(vs.shader);
    gl.deleteShader(fs.shader);

    if (!gl.getProgramParameter(newProg, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(newProg);
      gl.deleteProgram(newProg);
      return { ok: false, error: err };
    }

    if (program) gl.deleteProgram(program);
    program = newProg;
    return { ok: true };
  }

  // Project a 3D world point to 2D gizmoCanvas coordinates matching main(void) camera math
  function project3D(worldPt, camera) {
    if (!gizmoCanvas) return null;
    const W = gizmoCanvas.width;
    const H = gizmoCanvas.height;
    const aspect = W / H;

    // Relative to camera position
    let dx = worldPt.x - camera.pos.x;
    let dy = worldPt.y - camera.pos.y;
    let dz = worldPt.z - camera.pos.z;

    // In main(void), dir starts in camera space and is rotated by:
    // dir.yz *= rotate2d(pitch);
    // dir.xz *= rotate2d(yaw);
    // Notice in GLSL: v *= mat2(cos,-sin,sin,cos) multiplies row-vector v by M,
    // which rotates v by +angle. So inverse rotation (world -> camera) rotates by -yaw then -pitch!
    const yaw = Number(camera.yaw) || 0;
    const pitch = Number(camera.pitch) || 0;

    // Inverse yaw on xz
    const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
    const rx = dx * cy + dz * sy;
    const rz1 = -dx * sy + dz * cy;

    // Inverse pitch on yz
    const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
    const ry = dy * cp + rz1 * sp;
    const rz = -dy * sp + rz1 * cp;

    if (rz <= 0.1) return null; // Behind camera

    const fov = Number(camera.fov) || 1.0;
    const uvx = (rx / rz) * fov;
    const uvy = (ry / rz) * fov;

    const screenX = (uvx / aspect + 0.5) * W;
    const screenY = (0.5 - uvy) * H;
    return { x: screenX, y: screenY, depth: rz };
  }

  // Rotate local axis vector by node's Euler rotation matching de(vec3 p)
  function getNodeWorldPoint(node) {
    return {
      x: Number(node.position.x) || 0,
      y: Number(node.position.y) || 0,
      z: Number(node.position.z) || 0
    };
  }

  function renderGizmo(scene, selectedNode, meshBoxes) {
    if (!gctx || !gizmoCanvas) return;
    const W = gizmoCanvas.width;
    const H = gizmoCanvas.height;
    gctx.clearRect(0, 0, W, H);
    screenHandles = {};

    if (!showGizmo || !scene) return;
    const cam = scene.globals.camera;

    // Draw subtle world origin grid/axes indicator
    const orig2D = project3D({ x: 0, y: 0, z: 0 }, cam);
    if (orig2D) {
      gctx.save();
      gctx.strokeStyle = 'rgba(255,255,255,0.12)';
      gctx.lineWidth = 1;
      for (let i = -4; i <= 4; i += 2) {
        const p1 = project3D({ x: i, y: 0, z: -4 }, cam);
        const p2 = project3D({ x: i, y: 0, z: 4 }, cam);
        if (p1 && p2) {
          gctx.beginPath();
          gctx.moveTo(p1.x, p1.y);
          gctx.lineTo(p2.x, p2.y);
          gctx.stroke();
        }
        const p3 = project3D({ x: -4, y: 0, z: i }, cam);
        const p4 = project3D({ x: 4, y: 0, z: i }, cam);
        if (p3 && p4) {
          gctx.beginPath();
          gctx.moveTo(p3.x, p3.y);
          gctx.lineTo(p4.x, p4.y);
          gctx.stroke();
        }
      }
      gctx.restore();
    }

    // Bounding boxes de mallas importadas (no se raymarchean todavía: solo su caja)
    (meshBoxes || []).forEach(mb => drawMeshBox(mb, cam));

    if (!selectedNode || !selectedNode.enabled) return;

    const center3D = getNodeWorldPoint(selectedNode);
    const c2d = project3D(center3D, cam);
    if (!c2d) return;

    // If domain repetition is enabled on this node, draw a dashed domain cell box!
    if (selectedNode.domain && selectedNode.domain.repMode === 'infinite') {
      const hx = (Number(selectedNode.domain.ms?.x) || 10) * 0.5;
      const hy = (Number(selectedNode.domain.ms?.y) || 10) * 0.5;
      const hz = (Number(selectedNode.domain.ms?.z) || 5) * 0.5;
      drawWireBox(center3D, hx, hy, hz, cam, 'rgba(0, 245, 212, 0.35)');
    }

    const axisLen = Math.max(1.2, c2d.depth * 0.16);
    const axes = [
      { id: 'x', dir: { x: 1, y: 0, z: 0 }, color: '#ff3355', hoverColor: '#ff8899', label: 'X' },
      { id: 'y', dir: { x: 0, y: 1, z: 0 }, color: '#22ee66', hoverColor: '#88ffaa', label: 'Y' },
      { id: 'z', dir: { x: 0, y: 0, z: 1 }, color: '#3388ff', hoverColor: '#88bbff', label: 'Z' }
    ];

    axes.forEach(ax => {
      const tip3D = {
        x: center3D.x + ax.dir.x * axisLen,
        y: center3D.y + ax.dir.y * axisLen,
        z: center3D.z + ax.dir.z * axisLen
      };
      const tip2D = project3D(tip3D, cam);
      if (!tip2D) return;

      const isActive = hoveredAxis === ax.id || activeDragAxis === ax.id;
      const col = isActive ? ax.hoverColor : ax.color;

      gctx.save();
      gctx.strokeStyle = col;
      gctx.fillStyle = col;
      gctx.lineWidth = isActive ? 3.5 : 2.5;

      // Axis line
      gctx.beginPath();
      gctx.moveTo(c2d.x, c2d.y);
      gctx.lineTo(tip2D.x, tip2D.y);
      gctx.stroke();

      // Axis tip handle depending on gizmoMode
      const angle = Math.atan2(tip2D.y - c2d.y, tip2D.x - c2d.x);
      if (gizmoMode === 'translate') {
        // Cone arrowhead
        gctx.beginPath();
        gctx.moveTo(tip2D.x, tip2D.y);
        gctx.lineTo(tip2D.x - 13 * Math.cos(angle - 0.35), tip2D.y - 13 * Math.sin(angle - 0.35));
        gctx.lineTo(tip2D.x - 13 * Math.cos(angle + 0.35), tip2D.y - 13 * Math.sin(angle + 0.35));
        gctx.closePath();
        gctx.fill();
      } else if (gizmoMode === 'scale') {
        // Cube handle
        gctx.fillRect(tip2D.x - 6, tip2D.y - 6, 12, 12);
      } else if (gizmoMode === 'rotate') {
        // Ring handle
        gctx.beginPath();
        gctx.arc(tip2D.x, tip2D.y, 7, 0, Math.PI * 2);
        gctx.stroke();
      }

      // Label
      gctx.font = 'bold 11px monospace';
      gctx.fillText(ax.label, tip2D.x + 9, tip2D.y + 4);
      gctx.restore();

      screenHandles[ax.id] = {
        c2d,
        tip2D,
        dir2D: {
          x: tip2D.x - c2d.x,
          y: tip2D.y - c2d.y
        }
      };
    });

    // Center pivot dot
    gctx.save();
    gctx.fillStyle = (hoveredAxis === 'center' || activeDragAxis === 'center') ? '#ffffff' : '#ffbe0b';
    gctx.strokeStyle = '#000000';
    gctx.lineWidth = 1.5;
    gctx.beginPath();
    gctx.arc(c2d.x, c2d.y, 6, 0, Math.PI * 2);
    gctx.fill();
    gctx.stroke();
    gctx.restore();

    screenHandles.center = { c2d, tip2D: c2d };
  }

  // meshBox = { name, bbox: { min, max, center, size }, selected }
  function drawMeshBox(meshBox, cam) {
    const { bbox, selected, name } = meshBox;
    const s = bbox.size;
    // Una malla plana (tamaño 0 en un eje) igual se dibuja como rectángulo.
    drawWireBox(bbox.center, s.x / 2, s.y / 2, s.z / 2, cam,
      selected ? 'rgba(255, 190, 11, 0.95)' : 'rgba(255, 190, 11, 0.4)',
      { dashed: !selected, lineWidth: selected ? 1.6 : 1.1 });

    if (!selected) return;
    const tag = project3D({ x: bbox.min.x, y: bbox.max.y, z: bbox.min.z }, cam);
    if (!tag) return;
    const fmt3 = v => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
    const label = `${name}  ${fmt3(s.x)} × ${fmt3(s.y)} × ${fmt3(s.z)}`;
    gctx.save();
    gctx.font = '11px "Segoe UI", system-ui, sans-serif';
    const w = gctx.measureText(label).width + 10;
    gctx.fillStyle = 'rgba(12, 15, 24, 0.85)';
    gctx.fillRect(tag.x, tag.y - 20, w, 17);
    gctx.fillStyle = '#ffbe0b';
    gctx.fillText(label, tag.x + 5, tag.y - 7);
    gctx.restore();
  }

  function drawWireBox(center, hx, hy, hz, cam, strokeStyle, opts = {}) {
    const { dashed = true, lineWidth = 1.2 } = opts;
    const corners = [
      { x: center.x - hx, y: center.y - hy, z: center.z - hz },
      { x: center.x + hx, y: center.y - hy, z: center.z - hz },
      { x: center.x + hx, y: center.y + hy, z: center.z - hz },
      { x: center.x - hx, y: center.y + hy, z: center.z - hz },
      { x: center.x - hx, y: center.y - hy, z: center.z + hz },
      { x: center.x + hx, y: center.y - hy, z: center.z + hz },
      { x: center.x + hx, y: center.y + hy, z: center.z + hz },
      { x: center.x - hx, y: center.y + hy, z: center.z + hz }
    ].map(pt => project3D(pt, cam));

    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7]
    ];

    gctx.save();
    gctx.strokeStyle = strokeStyle;
    gctx.setLineDash(dashed ? [4, 4] : []);
    gctx.lineWidth = lineWidth;
    edges.forEach(([a, b]) => {
      if (corners[a] && corners[b]) {
        gctx.beginPath();
        gctx.moveTo(corners[a].x, corners[a].y);
        gctx.lineTo(corners[b].x, corners[b].y);
        gctx.stroke();
      }
    });
    gctx.restore();
  }

  function hitTestGizmo(mx, my) {
    if (!showGizmo) return null;
    for (const id of ['x', 'y', 'z', 'center']) {
      const h = screenHandles[id];
      if (!h) continue;
      // Check tip distance
      const dx = mx - h.tip2D.x;
      const dy = my - h.tip2D.y;
      if (Math.hypot(dx, dy) < 16) return id;

      // Also check segment distance for X, Y, Z axes
      if (id !== 'center') {
        const vx = h.tip2D.x - h.c2d.x;
        const vy = h.tip2D.y - h.c2d.y;
        const len2 = vx * vx + vy * vy;
        if (len2 > 1) {
          const t = Math.max(0, Math.min(1, ((mx - h.c2d.x) * vx + (my - h.c2d.y) * vy) / len2));
          const px = h.c2d.x + t * vx;
          const py = h.c2d.y + t * vy;
          if (Math.hypot(mx - px, my - py) < 10) return id;
        }
      }
    }
    return null;
  }

  function renderFrame(scene, selectedNode, meshBoxes) {
    const now = performance.now();
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    fps = Math.round(fps * 0.9 + (1 / Math.max(dt, 0.001)) * 0.1);

    if (isPlaying) {
      elapsedTime += dt;
    }

    if (gl && program) {
      const w = glCanvas.width;
      const h = glCanvas.height;
      const prevFboIdx = 1 - currentFboIdx;

      gl.useProgram(program);

      const posLoc = gl.getAttribLocation(program, 'position');
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      const timeLoc = gl.getUniformLocation(program, 'time');
      const resLoc = gl.getUniformLocation(program, 'resolution');
      const bbLoc = gl.getUniformLocation(program, 'backbuffer');

      if (timeLoc) gl.uniform1f(timeLoc, elapsedTime);
      if (resLoc) gl.uniform2f(resLoc, w, h);

      if (bbLoc && fboTextures[prevFboIdx]) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fboTextures[prevFboIdx]);
        gl.uniform1i(bbLoc, 0);
      }

      bindMeshTextures();

      // Render to screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Copy/render to current FBO for backbuffer ping-pong
      if (fbos[currentFboIdx]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[currentFboIdx]);
        gl.viewport(0, 0, w, h);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        currentFboIdx = prevFboIdx;
      }
    }

    renderGizmo(scene, selectedNode, meshBoxes);
  }

  return {
    init,
    resize,
    updateFragmentShader,
    renderFrame,
    hitTestGizmo,
    getScreenHandles: () => screenHandles,
    setGizmoMode: (m) => { gizmoMode = m; },
    getGizmoMode: () => gizmoMode,
    setShowGizmo: (v) => { showGizmo = v; },
    getShowGizmo: () => showGizmo,
    setHoveredAxis: (a) => { hoveredAxis = a; },
    setActiveDragAxis: (a) => { activeDragAxis = a; },
    getActiveDragAxis: () => activeDragAxis,
    setPlaying: (p) => { isPlaying = p; },
    isPlaying: () => isPlaying,
    resetTime: () => { elapsedTime = 0; },
    getTime: () => elapsedTime,
    getFPS: () => fps,
    setResScale: (s) => { resScale = s; resize(); },
    uploadMeshSdf,
    deleteMeshSdf
  };
})();
