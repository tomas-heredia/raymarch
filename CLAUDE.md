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
| Scripts IIFE con globals `window.*`, orden de `<script>` importa. Excepciones: `js/mesh-import.js` (ES module, import map, three.js 0.187.0 por jsDelivr) y `js/sdf-bake-worker.js` (module worker, three + three-mesh-bvh por esm.sh) | Todo en ES modules + import map (three.js, three-mesh-bvh) |
| GLSL embebido en strings JS (`js/primitives/*.js`, helpers en `sdf-library.js`, plantilla en `shader-generator.js`) | Archivos `.glsl` separados |
| SDF de mallas en grilla 3D (ya hecho) | Exportación a GLSL puro (RBF / neural SDF), en un módulo aparte |

Already done: WebGL2 + GLSL ES 3.00, and mesh → SDF grid → `sampler3D` → `sdMesh`.

## Running

There is no build step, package manager, linter or test suite. Requires **WebGL2**. `index.html` opens directly from `file://`, but **mesh import and SDF baking only work over HTTP**: they load an ES module + three.js from jsDelivr and a module Web Worker + three-mesh-bvh from esm.sh (so they also need internet). Python is not installed on this machine; use PHP from Laragon (`php -S 127.0.0.1:8765`, then `http://127.0.0.1:8765/index.html`).

Test models live in `samples/` (`node samples/generate-samples.js` regenerates them). `samples/README.md` lists the expected bounding box for each one. To verify a change, load the page and check the shader status bar or error banner (GLSL compile errors appear there) and the browser console.

## Current architecture

The scripts are loaded in order by `index.html`. Each one is an IIFE that sets a global, and later files destructure earlier ones:

1. `js/sdf-library.js` → `window.SDFLibrary`: primitive/helper registry (`registerPrimitive`, `registerHelper`, `resolveHelpers`, `P`, `Arg`, `Post`), `PRIMITIVES`, `GLSL_HELPERS`, `CATEGORIES`, `fmt()`, `createNode()`.
   - `js/primitives/{basic,cylinders,torus-spheres,polyhedra}.js` only call `registerPrimitive`. They must load after `sdf-library.js` and before `shader-generator.js`.
2. `js/shader-generator.js` → `window.ShaderGenerator`: `generateMasterShader(scene, { meshes })`, `getPresets()`. It emits GLSL ES 1.00 (`gl_FragColor`), byte-identical to the pre-WebGL2 output, so the code can be pasted into WebGL1 editors that prepend their own header. It switches to GLSL ES 3.00 (`#version 300 es`, `out vec4 fragColor`) **only** when the scene samples a ready mesh texture. It stays pure: mesh info is passed in, it never reads `SDFMeshStore`.
3. `js/renderer.js` → `window.SDFRenderer`: WebGL2 full-screen-quad renderer plus a 2D-canvas gizmo overlay (`#gizmoCanvas` on top of `#glCanvas`). It picks a `#version 300 es` or 1.00 vertex shader to match the fragment shader, so old GLSL 1.00 code pasted in "Editar Manual" still compiles. It also owns the meshes' 3D textures (`uploadMeshSdf` / `deleteMeshSdf`).
4. `js/exporter.js` → `window.SDFExporter`: wraps the shader in a self-contained WebGL2 HTML file and downloads it, embedding each referenced mesh SDF.
5. `js/mesh-store.js` → `window.SDFMeshStore`: imported meshes and their SDF state (see "Imported meshes" below). It has no three.js dependency.
6. `js/sdf-baker.js` → `window.SDFBaker`: runs one Web Worker per bake job. Re-baking a mesh terminates its previous job.
7. `js/app.js` → `window.SDFApp`: owns `scene` state and all UI (DOM built imperatively with `build*Row` helpers).

Not in that list: `js/mesh-import.js`, an ES module that `app.js` loads lazily with `import()`, and `js/sdf-bake-worker.js`, a module worker.

### Imported meshes (GLB / OBJ / STL)

- **Entry points:** drag & drop onto `.viewport-container`, or the "⬆ Importar Malla" button. Both call `importMeshFiles()` in `app.js`.
- **`mesh-import.js`:** `parseMeshFile(file)` uses three's `GLTFLoader` / `OBJLoader` / `STLLoader`. It applies every node's world matrix (and instancing) and merges everything into one non-indexed `Float32Array` of triangles. It throws `MeshImportError` with a Spanish, user-facing message. Draco/meshopt-compressed GLBs and external-file `.gltf` are rejected on purpose.
- **`SDFMeshStore`:** holds the meshes **outside `scene`**, because scenes are JSON-cloned and replaced by presets. Positions are kept as the file had them. `upAxis` (`y` | `z`, default `z` for STL because that's how Blender exports it) converts to editor space with Z-up `(x, y, z)` → `(x, z, -y)`, and is applied when computing `bbox` (`min/max/size/center`). The originals are never mutated. `onChange` re-renders the panels.
- **Selection:** `selectedMeshId` and the node selection are mutually exclusive (`selectNode()` clears the mesh). While a mesh is selected, the inspector shows `renderMeshInspector()` and `renderFrame` gets `null` as the node, so no node gizmo is drawn.
- **Drawing:** `Renderer.renderFrame(scene, node, meshBoxes)` draws each bbox with `drawWireBox()` (solid + label if selected, dashed otherwise). The boxes follow the gizmo toggle (H).
- **Framing:** `frameBBox()` keeps yaw/pitch, moves the camera so the bbox's bounding sphere fits the narrower side of the viewport, and sets `orbitTarget` to its center.

### Mesh SDF (grid → 3D texture → `sdMesh`)

- **When it bakes:** `MeshStore.onChange` in `app.js` starts `startSdfBake()` for every mesh whose `sdf.status` is `'idle'`. That happens on import, and when the up axis or the resolution changes (both reset the status to `idle`). Resolution means voxels on the longest axis (32/64/96/128, default 64).
- **Worker (`sdf-bake-worker.js`):**
  - **Imports:** workers do **not** see the page's import map, so three + three-mesh-bvh 0.10.0 are imported by full URL from esm.sh, with `?deps=three@0.187.0` to pin the version.
  - **Grid:** cubic voxels, with a 10 % margin around the bbox in editor space.
  - **Distance:** `MeshBVH.closestPointToPoint`.
  - **Sign:** majority vote of 3 rays in non-axis-aligned directions (`raycastFirst`; hitting a back face means inside). This assumes a closed mesh.
  - **Result:** a `Float32Array`, indexed `x + nx*(y + ny*z)`, transferred back (no copy).
- **Order matters on completion:** `Renderer.uploadMeshSdf()` first (an `R16F` 3D texture), then `MeshStore.setSdf({status:'ready'})`. Setting the status triggers the recompile, so the new shader that declares the sampler already finds its texture. `bindMeshTextures()` binds every active `sampler3D uMeshSdf_<meshId>` to units 1..N each frame, or a 1×1×1 dummy if its texture is missing.
- **Node type `'mesh'`:**
  - **Fields:** `node.meshId`, and `params` with these optional keys:
    - `size`: the longest side in world units. Default is the mesh's own size.
    - `sx`, `sy`, `sz`: per-axis scale. Default 1.
  - It is not in `PRIMITIVES`, so the generator (`meshPrimitive(node, info)`) and the inspector special-case it.
  - **Size and scale in the shader:** `sdMesh(p / S) * min(S)`. With non-uniform scale this is a lower bound of the distance (conservative), so the raymarcher never overshoots. Default values emit a plain `sdMesh_<id>(p)`.
  - **Size modulation:** it is `sizeable`, so `spsize` replaces `size`.
  - **"Normalizar a 2" / "Original":** these buttons also scale `position` by the same factor, as if changing the file's units. The size slider does not.
  - **Creation:** ➕ in "Mallas importadas", or the "📦 Mallas importadas" category of the IQ catalog, calls `addMeshNodeToScene()`. Its local origin is the **bbox center**, and the node's `position` starts there, so rotation and scale pivot on the mesh. All transforms, domain ops, modifiers and CSG apply as usual.
- **`sdMesh_<meshId>(p)`**, emitted by `generateMeshFunction()`:
  - **Ready:** **manual trilinear interpolation with 8 `texelFetch`**. Do not switch it to `texture()`: hardware filtering uses ~8-bit weights, and the finite-difference normals (`det`) come out grainy.
  - **Outside the grid:** distance to the grid plus the clamped border sample.
  - **Still baking, or bake failed:** the bbox as a box SDF placeholder.
  - **Mesh removed:** `1000.0`, and the node shows "MALLA FALTANTE".
  - Mesh ids must be valid GLSL identifiers; the generator skips mesh nodes with invalid ids.
- **Export:** OUTPUT embeds the SDF of every `uMeshSdf_*` uniform found in the shader (this works in manual mode too). The data goes in as half floats in base64 (`toHalf()`, round-to-nearest-even) and is uploaded as `R16F` / `HALF_FLOAT`. A 64³ grid adds about 0.5 MB; 128³, a few MB.
- **Reference numbers:**
  - `samples/l-shape.obj` at 64: 47×64×30 voxels in about 0.25 s, matching the exact analytic SDF to about 1e-7.
  - Soldier.glb (11k tris): about 0.8 s at 64³ and about 6 s at 128³, and the UI keeps running at full frame rate.

### Data flow

`scene = { globals, nodes[] }` is plain JSON. Presets are deep-cloned with `JSON.parse(JSON.stringify(...))`. Every UI mutation calls `recompileSceneShader()`: `generateMasterShader(scene, { meshes: getMeshShaderInfos() })` → textarea → `Renderer.updateFragmentShader()` → status/error UI. `requestAnimationFrame` calls `Renderer.renderFrame(scene, selectedNode, meshBoxes)`. If compilation fails, the previous valid program stays active. While "Editar Manual" is on, the generator is bypassed and the textarea is the source of truth.

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

The shaders use `uniform float time`, `uniform vec2 resolution`, `uniform sampler2D backbuffer` (unit 0) and, for each mesh in use, `uniform highp sampler3D uMeshSdf_<meshId>` (units 1..N). `time` is accumulated in the renderer and pauses with Play/Pause. `backbuffer` is ping-ponged between two FBOs, which means every frame is drawn twice (to the screen and to the FBO), even when the shader doesn't read it. `exporter.js` duplicates this uniform setup, so a new uniform or texture must be added in both `renderer.js` and `exporter.js`.

### Camera and gizmo

`globals.camera` (`pos`, `yaw`, `pitch`, `fov`) is baked into the generated `main()`: `dir = normalize(vec3(uv, fov))`, then `dir.yz *= rotate2d(pitch)`, then `dir.xz *= rotate2d(yaw)`. `project3D` in `renderer.js` reproduces this math so the 2D gizmo lines up with the render. If you change one, change the other.
