// ============================================================================
// IQ-SDF SUPREME ENGINE — Registro de primitivas SDF, helpers GLSL y nodos
// Reference: https://iquilezles.org/articles/distfunctions/
//
// Las primitivas NO viven acá: cada una se declara con registerPrimitive()
// en js/primitives/<categoría>.js (ver receta en CLAUDE.md).
// ============================================================================

window.SDFLibrary = (function () {

  // --------------------------------------------------------------------------
  // Categorías (pestañas del catálogo). Cada una tiene su archivo en js/primitives/.
  // --------------------------------------------------------------------------
  const CATEGORIES = [
    { id: 'basic', name: 'Básicas y Cajas', icon: '●' },
    { id: 'cylinders', name: 'Cilindros, Cápsulas y Conos', icon: '▲' },
    { id: 'torus_spheres', name: 'Toroides y Esferas Cortadas', icon: '◎' },
    { id: 'polyhedra', name: 'Poliedros, Prismas y Superficies', icon: '◆' }
  ];

  function fmt(n) {
    const num = Number(n);
    if (isNaN(num)) return '0.0';
    let s = num.toFixed(4).replace(/0+$/, '');
    if (s.endsWith('.')) s += '0';
    return s;
  }

  function reportProblems(what, problems) {
    console.error(`[SDFLibrary] ${what}:\n  - ${problems.join('\n  - ')}`);
  }

  // --------------------------------------------------------------------------
  // Helpers GLSL con dependencias.
  // El orden de registro es el orden de emisión cuando no hay dependencias entre ellos.
  // --------------------------------------------------------------------------
  const HELPERS = {};       // name -> { glsl, deps }
  const GLSL_HELPERS = {};  // name -> glsl (vista de solo lectura, compatibilidad)

  function registerHelper(name, glsl, deps = []) {
    const problems = [];
    if (HELPERS[name]) problems.push('nombre duplicado');
    deps.forEach(d => { if (!HELPERS[d]) problems.push(`dependencia desconocida '${d}' (registrala antes)`); });
    if (problems.length) { reportProblems(`Helper '${name}'`, problems); return; }
    HELPERS[name] = { glsl, deps };
    GLSL_HELPERS[name] = glsl;
  }

  // Devuelve los nombres pedidos + sus dependencias transitivas, cada dependencia
  // antes de quien la usa, y en orden de registro como desempate.
  function resolveHelpers(names) {
    const order = Object.keys(HELPERS);
    const sorted = [...new Set(names)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const result = [];
    const visit = (name, stack) => {
      if (result.includes(name)) return;
      if (!HELPERS[name]) { reportProblems('resolveHelpers', [`helper desconocido '${name}'`]); return; }
      if (stack.includes(name)) { reportProblems('resolveHelpers', [`ciclo: ${[...stack, name].join(' -> ')}`]); return; }
      HELPERS[name].deps.forEach(d => visit(d, [...stack, name]));
      result.push(name);
    };
    sorted.forEach(n => visit(n, []));
    return result;
  }

  registerHelper('dot2_vec2', `float dot2(vec2 v) { return dot(v, v); }`);
  registerHelper('dot2_vec3', `float dot2(vec3 v) { return dot(v, v); }`);
  registerHelper('ndot', `float ndot(vec2 a, vec2 b) { return a.x*b.x - a.y*b.y; }`);
  registerHelper('sdRound3', `vec3 round3(vec3 v) { return floor(v + 0.5); }`);
  registerHelper('opRepPolar', `vec2 opRepPolar(vec2 p, float repetitions)
{
  float angle = 6.28318530718 / repetitions;
  float a = atan(p.y, p.x) + angle * 0.5;
  float r = length(p);
  a = mod(a, angle) - angle * 0.5;
  return vec2(cos(a), sin(a)) * r;
}`);
  registerHelper('opXor', `float opXor(float a, float b)
{
  return max(min(a, b), -max(a, b));
}`);
  registerHelper('opSmoothUnion', `float opSmoothUnion( float a, float b, float k )
{
  k *= 4.0;
  float h = max(k-abs(a-b),0.0);
  return min(a, b) - h*h*0.25/k;
}`);
  registerHelper('opSmoothSubtraction', `float opSmoothSubtraction( float a, float b, float k )
{
  return -opSmoothUnion(a,-b,k);

  // k *= 4.0;
  // float h = max(k-abs(-a-b),0.0);
  // return max(-a, b) + h*h*0.25/k;
}`, ['opSmoothUnion']);
  registerHelper('opSmoothIntersection', `float opSmoothIntersection( float a, float b, float k )
{
  return -opSmoothUnion(-a,-b,k);

  // k *= 4.0;
  // float h = max(k-abs(a-b),0.0);
  // return max(a, b) + h*h*0.25/k;
}`, ['opSmoothUnion']);
  registerHelper('rotate2d', `mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}`);

  // --------------------------------------------------------------------------
  // Declaración de parámetros y argumentos de primitivas
  // --------------------------------------------------------------------------

  // Parámetro float con slider en el inspector.
  function P(id, label, def, min, max, step) {
    return { id, label, type: 'float', default: def, min, max, step };
  }

  function makeArg(refs, emit) {
    return { refs, emit };
  }

  // vec2('t') -> tx, ty ; vec3('b') -> bx, by, bz ; o ids explícitos.
  function vecArg(n, ids) {
    const names = ids.length === 1 ? 'xyzw'.slice(0, n).split('').map(c => ids[0] + c) : ids;
    if (names.length !== n) {
      reportProblems(`Arg.vec${n}`, [`espera 1 prefijo o ${n} ids, recibió ${ids.length}`]);
    }
    return makeArg(names, p => `vec${n}(${names.map(id => fmt(p[id])).join(', ')})`);
  }

  // Cada Arg convierte params del nodo en una expresión GLSL de argumento.
  // En `args`, un string suelto equivale a Arg.float(string).
  const Arg = {
    float: id => makeArg([id], p => fmt(p[id])),
    vec2: (...ids) => vecArg(2, ids),
    vec3: (...ids) => vecArg(3, ids),
    // Ángulo en radianes -> vec2(sin, cos) / vec2(cos, sin), calculado en JS.
    sinCos: id => makeArg([id], p => `vec2(${fmt(Math.sin(p[id]))}, ${fmt(Math.cos(p[id]))})`),
    cosSin: id => makeArg([id], p => `vec2(${fmt(Math.cos(p[id]))}, ${fmt(Math.sin(p[id]))})`),
    // Expresión libre: refs = ids de params que usa, fn(params) -> string GLSL.
    expr: (refs, fn) => makeArg(refs, fn),
    // Marca el argumento que controla la "Modulación de Tamaño" del inspector.
    //  'replace': el valor se reemplaza por spsize (base = valor del param).  Ej: radio.
    //  'scale'  : el valor se multiplica por spsize (base = 1.0).             Ej: vec3 de medidas.
    size: (inner, mode = 'replace') => ({
      refs: inner.refs,
      sizeMode: mode,
      base: p => (mode === 'replace' ? Number(p[inner.refs[0]]) : 1.0),
      emit: (p, ctx) => {
        if (!ctx.sizeExpr) return inner.emit(p, ctx);
        return mode === 'replace' ? ctx.sizeExpr : `${inner.emit(p, ctx)} * (${ctx.sizeExpr})`;
      }
    })
  };

  // Post-procesos de la distancia devuelta por la función.
  const Post = {
    // (d - th): para distancias sin signo (udTriangle, udQuad) con grosor.
    thickness: id => ({ refs: [id], apply: (expr, p) => `(${expr} - ${fmt(p[id])})` })
  };

  // --------------------------------------------------------------------------
  // Registro de primitivas
  // --------------------------------------------------------------------------
  const PRIMITIVES = {};

  /**
   * def = {
   *   key, name, category, iqName,
   *   params: [P(...)],
   *   glsl:   'float sdAlgo(vec3 p, ...) {...}'   (el nombre se lee de acá)
   *   args:   [Arg.*, 'paramId', ...]              (argumentos después de p)
   *   deps?:  ['dot2_vec3', ...]                    (helpers que usa el glsl)
   *   post?:  Post.* | (expr, params) => string
   *   call?:  (pVar, params, sizeExpr) => string   (escape hatch: reemplaza args/post)
   * }
   * Si la declaración tiene errores se informa por consola y NO se registra.
   */
  function registerPrimitive(def) {
    const problems = [];
    const key = def && def.key;
    if (!key) problems.push('falta key');
    else if (PRIMITIVES[key]) problems.push('key duplicada');
    if (!def.name) problems.push('falta name');
    if (!CATEGORIES.some(c => c.id === def.category)) {
      problems.push(`categoría desconocida '${def.category}' (opciones: ${CATEGORIES.map(c => c.id).join(', ')})`);
    }

    const glsl = def.glsl || '';
    const m = glsl.match(/^\s*float\s+(\w+)\s*\(/);
    const funcName = def.funcName || (m && m[1]);
    if (!funcName) {
      problems.push('no se pudo leer el nombre de la función: glsl debe empezar con "float nombre("');
    } else if (!new RegExp(`\\b${funcName}\\s*\\(`).test(glsl)) {
      problems.push(`la función '${funcName}' no aparece en glsl`);
    }

    const params = def.params || [];
    const paramIds = new Set();
    params.forEach(p => {
      if (!p || !p.id) { problems.push('param sin id'); return; }
      if (paramIds.has(p.id)) problems.push(`param '${p.id}' duplicado`);
      paramIds.add(p.id);
      const nums = ['default', 'min', 'max', 'step'];
      const bad = nums.filter(k => !Number.isFinite(p[k]));
      if (bad.length) problems.push(`param '${p.id}': falta/no numérico ${bad.join(', ')}`);
      else if (p.default < p.min || p.default > p.max) problems.push(`param '${p.id}': default ${p.default} fuera de [${p.min}, ${p.max}]`);
      if (!p.label) problems.push(`param '${p.id}': falta label`);
    });

    const args = (def.args || []).map(a => (typeof a === 'string' ? Arg.float(a) : a));
    const post = typeof def.post === 'function' ? { refs: [], apply: def.post } : def.post;
    if (!def.call) {
      if (!def.args) problems.push('falta args (o un call propio)');
      [...args, ...(post ? [post] : [])].forEach(a => {
        (a.refs || []).forEach(r => { if (!paramIds.has(r)) problems.push(`args/post usan el param '${r}', que no está en params`); });
      });
    }
    const sizeArgs = args.filter(a => a.sizeMode);
    if (sizeArgs.length > 1) problems.push('solo un argumento puede ser Arg.size');
    sizeArgs.forEach(a => {
      if (a.sizeMode !== 'replace' && a.sizeMode !== 'scale') problems.push(`Arg.size: modo '${a.sizeMode}' inválido (replace | scale)`);
      if (a.sizeMode === 'replace' && a.refs.length !== 1) problems.push(`Arg.size 'replace' necesita un argumento float`);
    });

    const deps = def.deps || [];
    deps.forEach(d => { if (!HELPERS[d]) problems.push(`dep desconocida '${d}' (helpers: ${Object.keys(HELPERS).join(', ')})`); });

    if (problems.length) {
      reportProblems(`Primitiva '${key || '?'}' no registrada`, problems);
      return null;
    }

    const sizeArg = sizeArgs[0] || null;
    const call = def.call || ((pVar, p, sizeExpr) => {
      const ctx = { sizeExpr };
      const expr = `${funcName}(${[pVar, ...args.map(a => a.emit(p, ctx))].join(', ')})`;
      return post ? post.apply(expr, p) : expr;
    });

    const prim = {
      id: key,
      name: def.name,
      category: def.category,
      iqName: def.iqName || def.name,
      funcName,
      dependencies: deps,
      params,
      glsl,
      call,
      sizeable: !!sizeArg,
      sizeBase: p => (sizeArg ? sizeArg.base(p) : 1.0)
    };
    PRIMITIVES[key] = prim;
    return prim;
  }

  // Create a fresh node instance with all IQ transform, domain, alteration, deformation & color options
  function createNode(type, overrides = {}) {
    const prim = PRIMITIVES[type] || PRIMITIVES.sphere;
    const defaultParams = {};
    prim.params.forEach(p => {
      defaultParams[p.id] = p.default;
    });

    const id = 'sdf_' + Math.random().toString(36).substring(2, 8);
    return {
      id: overrides.id || id,
      name: overrides.name || prim.name.split(' (')[0],
      type: prim.id,
      enabled: overrides.enabled !== undefined ? overrides.enabled : true,

      // Combination Operation (CSG / Smooth CSG)
      operation: overrides.operation || 'smoothUnion', // 'union', 'subtraction', 'intersection', 'xor', 'smoothUnion', 'smoothSubtraction', 'smoothIntersection'
      smoothK: overrides.smoothK !== undefined ? overrides.smoothK : 0.25,
      swapOrder: overrides.swapOrder || false, // e.g., opSmoothSubtraction(geo1, geo2, k) vs (d, geo, k)

      // Primitive geometric parameters
      params: Object.assign({}, defaultParams, overrides.params || {}),

      // Dynamic Size Modulation (e.g. spsize = 1.5 + sin(indexz*10. + time)*0.6)
      sizeModEnabled: overrides.sizeModEnabled || false,
      sizeModAxis: overrides.sizeModAxis || 'z', // 'x', 'y', 'z'
      sizeModFreq: overrides.sizeModFreq !== undefined ? overrides.sizeModFreq : 10.0,
      sizeModSpeed: overrides.sizeModSpeed !== undefined ? overrides.sizeModSpeed : 1.0,
      sizeModAmp: overrides.sizeModAmp !== undefined ? overrides.sizeModAmp : 0.6,

      // 3D Transform (Position, Rotation, Scale + Time animation)
      position: Object.assign({ x: 0.0, y: 0.0, z: 0.0 }, overrides.position || {}),
      linearVel: Object.assign({ x: 0.0, y: 0.0, z: 0.0 }, overrides.linearVel || {}), // p += time * vel
      rot: Object.assign({ x: 0.0, y: 0.0, z: 0.0 }, overrides.rot || {}), // radians
      rotSpeed: Object.assign({ x: 0.0, y: 0.0, z: 0.0 }, overrides.rotSpeed || {}), // rotate2d(time * speed)
      scale: overrides.scale !== undefined ? overrides.scale : 1.0,

      // Domain Subdivision & Symmetry (https://iquilezles.org/articles/distfunctions/)
      domain: Object.assign({
        // Symmetry / Mirroring (opSymX, opSymY, opSymZ)
        symX: false,
        symY: false,
        symZ: false,
        symOffset: { x: 0.0, y: 0.0, z: 0.0 },

        // Repetition mode: 'none' | 'infinite' | 'finite' | 'polar'
        repMode: 'none',
        // Infinite repetition (mod(p, ms) - ms/2.0 with index = floor(p/ms))
        repAxes: { x: true, y: true, z: true },
        ms: { x: 10.0, y: 10.0, z: 5.0 },
        // Index-based spatial wave offset (e.g. p.x += sin(indexz*1.0 + time))
        indexWaveEnabled: false,
        indexWaveTargetAxis: 'x',
        indexWaveSourceAxis: 'z',
        indexWaveFreq: 1.0,
        indexWaveSpeed: 1.0,
        indexWaveAmp: 1.0,

        // Finite / Limited repetition: p - s*clamp(round3(p/s), -limA, limB)
        limPeriod: { x: 3.0, y: 3.0, z: 3.0 },
        limMin: { x: 1.0, y: 0.0, z: 1.0 },
        limMax: { x: 1.0, y: 0.0, z: 1.0 },

        // Polar repetition (opRepPolar)
        polarCount: 6.0,
        polarPlane: 'xz', // 'xz', 'xy', 'yz'
        polarRadiusOffset: 2.0
      }, overrides.domain || {}),

      // IQ Alterations & Deformations
      modifiers: Object.assign({
        // Elongation (opElongate)
        elongateEnabled: false,
        elongate: { x: 0.5, y: 0.0, z: 0.0 },

        // Rounding (opRound: d - r)
        roundEnabled: false,
        roundRad: 0.1,

        // Onion / Shell (opOnion: abs(d) - thickness)
        onionEnabled: false,
        onionThickness: 0.1,
        onionLayers: 1,

        // Twist (opTwist)
        twistEnabled: false,
        twistAxis: 'y',
        twistAmount: 1.2,

        // Cheap Bend (opBend)
        bendEnabled: false,
        bendAxis: 'x',
        bendAmount: 0.5,

        // Sine Displacement (opDisplace)
        displaceEnabled: false,
        displaceFreq: 5.0,
        displaceAmp: 0.08,
        displaceSpeed: 0.0
      }, overrides.modifiers || {}),

      // Color & Material Blending
      colorConfig: Object.assign({
        mode: 'solid', // 'solid' | 'indexWave' | 'distanceMix' | 'normalGrad'
        color1: '#ff3366',
        color2: '#00ffff',
        // For indexWave: mix(c1, c2, sin(index*freq + time*speed)*0.5 + 0.5)
        waveIndexAxis: 'x',
        waveFreq: 1.0,
        waveSpeed: 2.0,
        // How this node's color combines into objcol: 'auto' | 'rawDistanceMix' | 'override'
        blendStyle: 'auto'
      }, overrides.colorConfig || {})
    };
  }

  return {
    GLSL_HELPERS,
    CATEGORIES,
    PRIMITIVES,
    fmt,
    createNode,
    registerHelper,
    resolveHelpers,
    registerPrimitive,
    P,
    Arg,
    Post
  };
})();
