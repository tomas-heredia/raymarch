// ============================================================================
// IQ-SDF SUPREME ENGINE — Standalone HTML Exporter ("OUTPUT" Button)
// Exports a single self-contained HTML file with ONLY the final SDF render.
// WebGL2. The SDF grid of each imported mesh used by the shader is embedded as
// half-floats in base64 and uploaded as a 3D texture (uniform uMeshSdf_<id>).
// ============================================================================

window.SDFExporter = (function () {

  // Float32 -> half float (IEEE 754 binary16), redondeo al más cercano con empates a par.
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  function shiftRoundEven(m, shift) {
    const r = m >>> shift;
    const rem = m & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    return r + (rem > half || (rem === half && (r & 1)) ? 1 : 0);
  }
  function toHalf(v) {
    f32[0] = v;
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    const exp = ((x >>> 23) & 0xff) - 127 + 15;
    const mant = x & 0x7fffff;
    if (exp >= 31) return sign | 0x7c00;                         // fuera de rango -> infinito
    if (exp <= 0) {                                               // subnormal o cero
      if (exp < -10) return sign;
      return sign | shiftRoundEven(mant | 0x800000, 14 - exp);
    }
    return sign | ((exp << 10) + shiftRoundEven(mant, 13));        // '+' propaga el acarreo del redondeo
  }

  function float32ToHalfBase64(data) {
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = toHalf(data[i]);
    const bytes = new Uint8Array(half.buffer);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  /**
   * textures: [{ id, dims: [nx, ny, nz], data: Float32Array }] — SDF de mallas que usa el shader.
   */
  function generateStandaloneHTML(shaderCode, title = 'SDF Render Output', textures = []) {
    const meshJson = JSON.stringify(textures.map(t => ({ id: t.id, dims: t.dims, b64: float32ToHalfBase64(t.data) })));

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    canvas { display: block; width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <canvas id="glcanvas"></canvas>
  <script id="fragShader" type="x-shader/x-fragment">
${shaderCode}
  </script>
  <script id="meshSdf" type="application/json">${meshJson}</script>
  <script>
    (function() {
      const canvas = document.getElementById('glcanvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) {
        document.body.innerHTML = '<p style="color:#fff;padding:20px;">WebGL2 no soportado</p>';
        return;
      }

      // #version debe ser lo primero del código
      const fsSource = document.getElementById('fragShader').textContent.replace(/^\\s+/, '');
      const is300 = /^#version\\s+300\\s+es\\b/.test(fsSource);
      const vsSource = is300
        ? '#version 300 es\\nin vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }'
        : 'attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }';

      function compile(src, type) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.error(gl.getShaderInfoLog(s));
        }
        return s;
      }

      const prog = gl.createProgram();
      gl.attachShader(prog, compile(vsSource, gl.VERTEX_SHADER));
      gl.attachShader(prog, compile(fsSource, gl.FRAGMENT_SHADER));
      gl.linkProgram(prog);
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

      const posLoc = gl.getAttribLocation(prog, 'position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      const timeLoc = gl.getUniformLocation(prog, 'time');
      const resLoc = gl.getUniformLocation(prog, 'resolution');
      const bbLoc = gl.getUniformLocation(prog, 'backbuffer');

      // SDF de mallas: half floats en base64 -> textura 3D R16F en la unidad 1..N
      const meshes = JSON.parse(document.getElementById('meshSdf').textContent);
      let unit = 1;
      meshes.forEach(m => {
        const loc = gl.getUniformLocation(prog, 'uMeshSdf_' + m.id);
        if (!loc) return;
        const bin = atob(m.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_3D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, m.dims[0], m.dims[1], m.dims[2], 0, gl.RED, gl.HALF_FLOAT, new Uint16Array(bytes.buffer));
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.uniform1i(loc, unit);
        unit++;
      });
      gl.activeTexture(gl.TEXTURE0);

      // Backbuffer ping-pong textures
      let fbos = [null, null], texs = [null, null], idx = 0;
      function initFBOs(w, h) {
        for (let i = 0; i < 2; i++) {
          if (fbos[i]) gl.deleteFramebuffer(fbos[i]);
          if (texs[i]) gl.deleteTexture(texs[i]);
          const t = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          const f = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, f);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
          fbos[i] = f; texs[i] = t;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        initFBOs(canvas.width, canvas.height);
      }
      window.addEventListener('resize', resize);
      resize();

      const start = performance.now();
      function loop(now) {
        const t = (now - start) * 0.001;
        const w = canvas.width, h = canvas.height;
        const prev = 1 - idx;

        if (timeLoc) gl.uniform1f(timeLoc, t);
        if (resLoc) gl.uniform2f(resLoc, w, h);
        if (bbLoc && texs[prev]) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texs[prev]);
          gl.uniform1i(bbLoc, 0);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        if (fbos[idx]) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[idx]);
          gl.viewport(0, 0, w, h);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          idx = prev;
        }
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
    })();
  </script>
</body>
</html>`;
  }

  function downloadStandaloneHTML(shaderCode, filename = 'sdf-output.html', textures = []) {
    const htmlContent = generateStandaloneHTML(shaderCode, 'IQ-SDF Render Output', textures);
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  return {
    generateStandaloneHTML,
    downloadStandaloneHTML,
    toHalf // expuesto para pruebas
  };
})();
