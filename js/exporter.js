// ============================================================================
// IQ-SDF SUPREME ENGINE — Standalone HTML Exporter ("OUTPUT" Button)
// Exports a single self-contained HTML file with ONLY the final SDF render
// ============================================================================

window.SDFExporter = (function () {

  function generateStandaloneHTML(shaderCode, title = 'SDF Render Output') {
    const escapedShader = shaderCode.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

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
  <script>
    (function() {
      const canvas = document.getElementById('glcanvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        document.body.innerHTML = '<p style="color:#fff;padding:20px;">WebGL no soportado</p>';
        return;
      }

      const vsSource = 'attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }';
      const fsSource = document.getElementById('fragShader').textContent;

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

  function downloadStandaloneHTML(shaderCode, filename = 'sdf-output.html') {
    const htmlContent = generateStandaloneHTML(shaderCode, 'IQ-SDF Render Output');
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
    downloadStandaloneHTML
  };
})();
