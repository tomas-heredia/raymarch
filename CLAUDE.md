# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Editor SDF con importación de mallas

## Objetivo
Editor de raymarching GLSL en navegador. Feature principal: importar mallas
(GLB/OBJ/STL desde Blender) y convertirlas a SDF usable como primitiva.

## Reglas
- Antes de cambios grandes, proponer un plan y esperar aprobación.
- Cada feature nueva incluye un modelo de prueba en `/samples`.
- Mantener los shaders en archivos `.glsl` separados, no en strings gigantes.
- Textos de UI y comentarios en **español**.

## Stack (objetivo)
- JS plano + WebGL2 (no migrar a frameworks sin preguntar).
- three.js solo para loaders, y three-mesh-bvh para generar el SDF.
- Sin build step si se puede (ES modules vía import maps).

## Arquitectura de mallas (objetivo)
- La malla se convierte a un SDF en grilla 3D (Float32/R16F) → `sampler3D`.
- En GLSL se expone como `float sdMesh(vec3 p)`, combinable con el resto de las primitivas.
- Fuera del bounding box: distancia a la caja + valor muestreado en el borde.
- Más adelante: exportación a GLSL puro (RBF / neural SDF), en un módulo aparte.

## Estado actual vs. objetivo

The code today does **not** match the target stack yet. Keep the gap in mind, and treat closing it as a "cambio grande" (propose a plan first):

| Hoy | Objetivo |
|---|---|
| WebGL1, GLSL ES 1.0 (`gl_FragColor`, `precision mediump`) | WebGL2, `#version 300 es` (`out vec4`, `texture()`), needed for `sampler3D` and R16F/float 3D textures |
| Scripts IIFE con globals `window.*`, orden de `<script>` importa | ES modules + import map (three.js, three-mesh-bvh) |
| GLSL embebido en strings JS (`js/primitives/*.js`, helpers en `sdf-library.js`, plantilla en `shader-generator.js`) | Archivos `.glsl` separados |
| Sin carpeta `/samples` | Un modelo de prueba por feature en `/samples` |

The WebGL2 migration also affects `js/exporter.js`: the exported HTML must create a `webgl2` context and, once meshes exist, embed or load the 3D SDF texture.

## Running

There is no build step, package manager, linter or test suite. Right now `index.html` can be opened directly. Serve the folder over HTTP instead. Python is not installed on this machine; use PHP from Laragon (`php -S 127.0.0.1:8765`, then `http://127.0.0.1:8765/index.html`), because ES modules, import maps and `fetch()` of `.glsl` files don't work from `file://`. To verify a change, load the page and check the shader status bar or error banner (GLSL compile errors appear there) and the browser console.

## Current architecture

The scripts are loaded in order by `index.html`. Each one is an IIFE that sets a global, and later files destructure earlier ones:

1. `js/sdf-library.js` → `window.SDFLibrary`: primitive/helper registry (`registerPrimitive`, `registerHelper`, `resolveHelpers`, `P`, `Arg`, `Post`), `PRIMITIVES`, `GLSL_HELPERS`, `CATEGORIES`, `fmt()`, `createNode()`.
   - `js/primitives/{basic,cylinders,torus-spheres,polyhedra}.js` only call `registerPrimitive`. They must load after `sdf-library.js` and before `shader-generator.js`.
2. `js/shader-generator.js` → `window.ShaderGenerator`: `generateMasterShader(scene)`, `getPresets()`.
3. `js/renderer.js` → `window.SDFRenderer`: full-screen-quad renderer plus a 2D-canvas gizmo overlay (`#gizmoCanvas` on top of `#glCanvas`).
4. `js/exporter.js` → `window.SDFExporter`: wraps the shader in a self-contained HTML file and downloads it.
5. `js/app.js` → `window.SDFApp`: owns `scene` state and all UI (DOM built imperatively with `build*Row` helpers).

### Data flow

`scene = { globals, nodes[] }` is plain JSON. Presets are deep-cloned with `JSON.parse(JSON.stringify(...))`. Every UI mutation calls `recompileSceneShader()`: `generateMasterShader(scene)` → textarea → `Renderer.updateFragmentShader()` → status/error UI. `requestAnimationFrame` calls `Renderer.renderFrame(scene, selectedNode)`. If compilation fails, the previous valid program stays active. While "Editar Manual" is on, the generator is bypassed and the textarea is the source of truth.

Scene values (params, transforms, camera, lights) are written into the GLSL as **literals**, not uniforms. Any slider change recompiles the whole shader.

### Primitives

Primitives are declared with `registerPrimitive()` in `js/primitives/<categoría>.js` (one file per entry in `CATEGORIES`). `sdf-library.js` holds only the registry, the helpers and `createNode`. **Adding a primitive = adding one declaration to its category file.** The catalog, the "Geometría IQ" select, the sliders and the generator pick it up automatically.

```js
registerPrimitive({
  key: 'roundBox', name: 'Round Box (Caja Redondeada)', category: 'basic', iqName: 'Round Box - exact',
  deps: [],                                   // optional: GLSL helpers used by glsl (e.g. 'dot2_vec3', 'ndot')
  params: [P('bx', 'Ancho X (b.x)', 0.85, 0.05, 10, 0.05), /* by, bz */ P('r', 'Bisel (r)', 0.2, 0, 3, 0.02)],
  args: [Arg.vec3('b'), 'r'],                 // GLSL arguments after p, built from params
  glsl: `float sdRoundBox( vec3 p, vec3 b, float r ) { ... }`
});
```

- `P(id, label, default, min, max, step)` declares a float param, which becomes a slider.
- The function name is read from the first `float name(` in `glsl`, and the call is generated as `name(pVar, ...args)`.
- `args` building blocks:
  - a bare string, or `Arg.float('id')`;
  - `Arg.vec2/vec3('prefix')` → `prefix`+x/y/z, or explicit ids;
  - `Arg.sinCos('angle')` / `Arg.cosSin('angle')` → `vec2` computed in JS;
  - `Arg.expr(refs, params => 'glsl')`;
  - `Arg.size(arg, 'replace' | 'scale')` marks the argument driven by "Modular Tamaño". Only primitives with an `Arg.size` show that checkbox (`prim.sizeable`).
- `post: Post.thickness('th')` wraps the call as `(call - th)`, used for unsigned distances. `post` also accepts a function `(expr, params) => string`.
- `call: (pVar, params, sizeExpr) => string` is an escape hatch that replaces `args`/`post`.
- An invalid declaration is **not registered**; the reason is logged to the console (`[SDFLibrary] Primitiva '…' no registrada`). The checks catch unknown category, duplicate key, args referencing undeclared params, default out of range, unknown `deps`, etc.
- Within a category, registration order is the order shown in the catalog.
- New GLSL helpers: `registerHelper(name, glsl, deps)` in `sdf-library.js`. `resolveHelpers()` emits each helper after its dependencies and before the primitives. The core helpers (`opSmooth*`, `rotate2d`) are always emitted after the primitives, unless a primitive depends on them.
- Every number emitted into GLSL goes through `fmt()`, so it always has a decimal point.

To check a refactor of the generator or the registry without a browser: both `sdf-library.js` + `js/primitives/*.js` and `shader-generator.js` are DOM-free. In Node, set `globalThis.window = globalThis`, load the files in `index.html` order with `vm.runInThisContext`, and call `ShaderGenerator.generateMasterShader(...)`. Compare the output before and after the change.

A mesh primitive (`sdMesh`) will also need a sampler uniform plus a bounding box, which doesn't fit the current "everything is a literal" model. Design for that explicitly; the `call` escape hatch alone is not enough.

### Nodes and `de()`

`createNode()` is the single source of truth for node fields: transform plus time animation, `domain`, `modifiers`, `colorConfig`, `operation`/`smoothK`/`swapOrder`. To add a node option:
- add its default in `createNode`,
- emit its GLSL in `generateNodeCode`,
- add its control in `renderInspector`.

`generateNodeCode` emits a block per node with numbered variables (`p{n}`, `geo{n}`, `col{n}`, `indexx_{n}`…). The operation order is fixed: translate → velocity → rotate Y/X/Z → symmetry → repetition → twist/bend → elongate → scale → primitive → round/onion/displace → color. Nodes are combined in list order into `float d`. Color goes into the global `vec3 objcol`, which `shade()` reads later, so `de()` has a side effect on `objcol`. The global domain transform (`globals.globalDomain`) is applied to `p` before all nodes.

### Uniforms

The shaders use `uniform float time`, `uniform vec2 resolution` and `uniform sampler2D backbuffer`. `time` is accumulated in the renderer and pauses with Play/Pause. `backbuffer` is ping-ponged between two FBOs, which means every frame is drawn twice (to the screen and to the FBO), even when the shader doesn't read it. `exporter.js` duplicates this uniform setup, so a new uniform or texture must be added in both `renderer.js` and `exporter.js`.

### Camera and gizmo

`globals.camera` (`pos`, `yaw`, `pitch`, `fov`) is baked into the generated `main()`: `dir = normalize(vec3(uv, fov))`, then `dir.yz *= rotate2d(pitch)`, then `dir.xz *= rotate2d(yaw)`. `project3D` in `renderer.js` reproduces this math so the 2D gizmo lines up with the render. If you change one, change the other.
