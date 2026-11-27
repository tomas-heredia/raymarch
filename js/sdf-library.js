// ============================================================================
// IQ-SDF SUPREME ENGINE — Complete 3D SDF Library from Inigo Quilez
// Reference: https://iquilezles.org/articles/distfunctions/
// ============================================================================

window.SDFLibrary = (function () {

  // Helper GLSL functions used by primitives & domain operations
  const GLSL_HELPERS = {
    dot2_vec2: `float dot2(vec2 v) { return dot(v, v); }`,
    dot2_vec3: `float dot2(vec3 v) { return dot(v, v); }`,
    ndot: `float ndot(vec2 a, vec2 b) { return a.x*b.x - a.y*b.y; }`,
    sdRound3: `vec3 round3(vec3 v) { return floor(v + 0.5); }`,
    rotate2d: `mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}`,
    opSmoothUnion: `float opSmoothUnion( float a, float b, float k )
{
  k *= 4.0;
  float h = max(k-abs(a-b),0.0);
  return min(a, b) - h*h*0.25/k;
}`,
    opSmoothSubtraction: `float opSmoothSubtraction( float a, float b, float k )
{
  return -opSmoothUnion(a,-b,k);

  // k *= 4.0;
  // float h = max(k-abs(-a-b),0.0);
  // return max(-a, b) + h*h*0.25/k;
}`,
    opSmoothIntersection: `float opSmoothIntersection( float a, float b, float k )
{
  return -opSmoothUnion(-a,-b,k);

  // k *= 4.0;
  // float h = max(k-abs(a-b),0.0);
  // return max(a, b) + h*h*0.25/k;
}`,
    opXor: `float opXor(float a, float b)
{
  return max(min(a, b), -max(a, b));
}`,
    opRepPolar: `vec2 opRepPolar(vec2 p, float repetitions)
{
  float angle = 6.28318530718 / repetitions;
  float a = atan(p.y, p.x) + angle * 0.5;
  float r = length(p);
  a = mod(a, angle) - angle * 0.5;
  return vec2(cos(a), sin(a)) * r;
}`
  };

  // Categories for UI organization
  const CATEGORIES = [
    { id: 'basic', name: 'Básicas y Cajas', icon: '●' },
    { id: 'cylinders', name: 'Cilindros, Cápsulas y Conos', icon: '▲' },
    { id: 'torus_spheres', name: 'Toroides y Esferas Cortadas', icon: '◎' },
    { id: 'polyhedra', name: 'Poliedros, Prismas y Superficies', icon: '◆' }
  ];

  // Complete catalog of 34 3D SDF Primitives from https://iquilezles.org/articles/distfunctions/
  const PRIMITIVES = {
    sphere: {
      id: 'sphere',
      name: 'Sphere (Esfera)',
      category: 'basic',
      iqName: 'Sphere - exact',
      funcName: 'sphere',
      dependencies: [],
      params: [
        { id: 'rad', label: 'Radio (rad)', type: 'float', default: 1.0, min: 0.05, max: 10.0, step: 0.05 }
      ],
      glsl: `float sphere(vec3 p, float rad) 
{
    return length(p) - rad;
}`,
      call: (pVar, params, sizeExpr) => {
        const r = sizeExpr || fmt(params.rad);
        return `sphere(${pVar}, ${r})`;
      }
    },

    box: {
      id: 'box',
      name: 'Box (Caja Exacta)',
      category: 'basic',
      iqName: 'Box - exact',
      funcName: 'sdBox',
      dependencies: [],
      params: [
        { id: 'bx', label: 'Ancho X (b.x)', type: 'float', default: 1.0, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'by', label: 'Alto Y (b.y)', type: 'float', default: 1.0, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'bz', label: 'Profundidad Z (b.z)', type: 'float', default: 1.0, min: 0.05, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdBox( vec3 p, vec3 b )
{
  vec3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}`,
      call: (pVar, params, sizeExpr) => {
        if (sizeExpr) return `sdBox(${pVar}, vec3(${ fmt(params.bx) }, ${ fmt(params.by) }, ${ fmt(params.bz) }) * (${sizeExpr}))`;
        return `sdBox(${pVar}, vec3(${fmt(params.bx)}, ${fmt(params.by)}, ${fmt(params.bz)}))`;
      }
    },

    roundBox: {
      id: 'roundBox',
      name: 'Round Box (Caja Redondeada)',
      category: 'basic',
      iqName: 'Round Box - exact',
      funcName: 'sdRoundBox',
      dependencies: [],
      params: [
        { id: 'bx', label: 'Ancho X (b.x)', type: 'float', default: 0.85, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'by', label: 'Alto Y (b.y)', type: 'float', default: 0.85, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'bz', label: 'Profundidad Z (b.z)', type: 'float', default: 0.85, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'r', label: 'Bisel / Radio (r)', type: 'float', default: 0.2, min: 0.0, max: 3.0, step: 0.02 }
      ],
      glsl: `float sdRoundBox( vec3 p, vec3 b, float r )
{
  vec3 q = abs(p) - b + r;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0) - r;
}`,
      call: (pVar, params) => `sdRoundBox(${pVar}, vec3(${fmt(params.bx)}, ${fmt(params.by)}, ${fmt(params.bz)}), ${fmt(params.r)})`
    },

    boxFrame: {
      id: 'boxFrame',
      name: 'Box Frame (Marco de Caja)',
      category: 'basic',
      iqName: 'Box Frame - exact',
      funcName: 'sdBoxFrame',
      dependencies: [],
      params: [
        { id: 'bx', label: 'Ancho X (b.x)', type: 'float', default: 1.1, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'by', label: 'Alto Y (b.y)', type: 'float', default: 1.1, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'bz', label: 'Profundidad Z (b.z)', type: 'float', default: 1.1, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'e', label: 'Grosor Marco (e)', type: 'float', default: 0.12, min: 0.01, max: 2.0, step: 0.01 }
      ],
      glsl: `float sdBoxFrame( vec3 p, vec3 b, float e )
{
       p = abs(p  )-b;
  vec3 q = abs(p+e)-e;
  return min(min(
      length(max(vec3(p.x,q.y,q.z),0.0))+min(max(p.x,max(q.y,q.z)),0.0),
      length(max(vec3(q.x,p.y,q.z),0.0))+min(max(q.x,max(p.y,q.z)),0.0)),
      length(max(vec3(q.x,q.y,p.z),0.0))+min(max(q.x,max(q.y,p.z)),0.0));
}`,
      call: (pVar, params) => `sdBoxFrame(${pVar}, vec3(${fmt(params.bx)}, ${fmt(params.by)}, ${fmt(params.bz)}), ${fmt(params.e)})`
    },

    torus: {
      id: 'torus',
      name: 'Torus (Toroide / Dona)',
      category: 'torus_spheres',
      iqName: 'Torus - exact',
      funcName: 'sdTorus',
      dependencies: [],
      params: [
        { id: 'tx', label: 'Radio Mayor (t.x)', type: 'float', default: 1.1, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'ty', label: 'Radio Tubo (t.y)', type: 'float', default: 0.35, min: 0.02, max: 5.0, step: 0.02 }
      ],
      glsl: `float sdTorus( vec3 p, vec2 t )
{
  vec2 q = vec2(length(p.xz)-t.x,p.y);
  return length(q)-t.y;
}`,
      call: (pVar, params) => `sdTorus(${pVar}, vec2(${fmt(params.tx)}, ${fmt(params.ty)}))`
    },

    cappedTorus: {
      id: 'cappedTorus',
      name: 'Capped Torus (Arco Toroidal)',
      category: 'torus_spheres',
      iqName: 'Capped Torus - exact',
      funcName: 'sdCappedTorus',
      dependencies: [],
      params: [
        { id: 'angle', label: 'Ángulo Apertura (rad)', type: 'float', default: 2.0, min: 0.1, max: 3.1, step: 0.05 },
        { id: 'ra', label: 'Radio Mayor (ra)', type: 'float', default: 1.1, min: 0.1, max: 10.0, step: 0.05 },
        { id: 'rb', label: 'Radio Tubo (rb)', type: 'float', default: 0.3, min: 0.02, max: 5.0, step: 0.02 }
      ],
      glsl: `float sdCappedTorus( vec3 p, vec2 sc, float ra, float rb)
{
  p.x = abs(p.x);
  float k = (sc.y*p.x>sc.x*p.y) ? dot(p.xy,sc) : length(p.xy);
  return sqrt( dot(p,p) + ra*ra - 2.0*ra*k ) - rb;
}`,
      call: (pVar, params) => {
        const s = Math.sin(params.angle);
        const c = Math.cos(params.angle);
        return `sdCappedTorus(${pVar}, vec2(${fmt(s)}, ${fmt(c)}), ${fmt(params.ra)}, ${fmt(params.rb)})`;
      }
    },

    link: {
      id: 'link',
      name: 'Link (Eslabón de Cadena)',
      category: 'torus_spheres',
      iqName: 'Link - exact',
      funcName: 'sdLink',
      dependencies: [],
      params: [
        { id: 'le', label: 'Elongación (le)', type: 'float', default: 0.5, min: 0.0, max: 5.0, step: 0.05 },
        { id: 'r1', label: 'Radio Mayor (r1)', type: 'float', default: 0.75, min: 0.05, max: 5.0, step: 0.05 },
        { id: 'r2', label: 'Radio Tubo (r2)', type: 'float', default: 0.25, min: 0.02, max: 3.0, step: 0.02 }
      ],
      glsl: `float sdLink( vec3 p, float le, float r1, float r2 )
{
  vec3 q = vec3( p.x, max(abs(p.y)-le,0.0), p.z );
  return length(vec2(length(q.xy)-r1,q.z)) - r2;
}`,
      call: (pVar, params) => `sdLink(${pVar}, ${fmt(params.le)}, ${fmt(params.r1)}, ${fmt(params.r2)})`
    },

    infiniteCylinder: {
      id: 'infiniteCylinder',
      name: 'Infinite Cylinder (Cilindro Infinito)',
      category: 'cylinders',
      iqName: 'Infinite Cylinder - exact',
      funcName: 'sdCylinder',
      dependencies: [],
      params: [
        { id: 'cx', label: 'Centro X (c.x)', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'cy', label: 'Centro Z (c.y)', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'cz', label: 'Radio (c.z)', type: 'float', default: 0.6, min: 0.05, max: 5.0, step: 0.05 }
      ],
      glsl: `float sdCylinder( vec3 p, vec3 c )
{
  return length(p.xz-c.xy)-c.z;
}`,
      call: (pVar, params) => `sdCylinder(${pVar}, vec3(${fmt(params.cx)}, ${fmt(params.cy)}, ${fmt(params.cz)}))`
    },

    cone: {
      id: 'cone',
      name: 'Cone (Cono Exacto)',
      category: 'cylinders',
      iqName: 'Cone - exact',
      funcName: 'sdCone',
      dependencies: [],
      params: [
        { id: 'angle', label: 'Ángulo Cono (rad)', type: 'float', default: 0.55, min: 0.05, max: 1.5, step: 0.02 },
        { id: 'h', label: 'Altura (h)', type: 'float', default: 1.5, min: 0.1, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdCone( vec3 p, vec2 c, float h )
{
  vec2 q = h*vec2(c.x/c.y,-1.0);
  vec2 w = vec2( length(p.xz), p.y );
  vec2 a = w - q*clamp( dot(w,q)/dot(q,q), 0.0, 1.0 );
  vec2 b = w - q*vec2( clamp( w.x/q.x, 0.0, 1.0 ), 1.0 );
  float k = sign( q.y );
  float d = min(dot( a, a ),dot(b, b));
  float s = max( k*(w.x*q.y-w.y*q.x),k*(w.y-q.y)  );
  return sqrt(d)*sign(s);
}`,
      call: (pVar, params) => {
        const s = Math.sin(params.angle);
        const c = Math.cos(params.angle);
        return `sdCone(${pVar}, vec2(${fmt(s)}, ${fmt(c)}), ${fmt(params.h)})`;
      }
    },

    coneBound: {
      id: 'coneBound',
      name: 'Cone Bound (Cono Rápido)',
      category: 'cylinders',
      iqName: 'Cone - bound (not exact!)',
      funcName: 'sdConeBound',
      dependencies: [],
      params: [
        { id: 'angle', label: 'Ángulo Cono (rad)', type: 'float', default: 0.55, min: 0.05, max: 1.5, step: 0.02 },
        { id: 'h', label: 'Altura (h)', type: 'float', default: 1.5, min: 0.1, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdConeBound( vec3 p, vec2 c, float h )
{
  float q = length(p.xz);
  return max(dot(c.xy,vec2(q,p.y)),-h-p.y);
}`,
      call: (pVar, params) => {
        const s = Math.sin(params.angle);
        const c = Math.cos(params.angle);
        return `sdConeBound(${pVar}, vec2(${fmt(s)}, ${fmt(c)}), ${fmt(params.h)})`;
      }
    },

    horseshoe: {
      id: 'horseshoe',
      name: 'Horseshoe (Herradura 3D)',
      category: 'torus_spheres',
      iqName: 'Horseshoe - exact',
      funcName: 'sdHorseshoe',
      dependencies: [],
      params: [
        { id: 'angle', label: 'Ángulo Arco (rad)', type: 'float', default: 1.3, min: 0.1, max: 3.0, step: 0.05 },
        { id: 'r', label: 'Radio Arco (r)', type: 'float', default: 1.0, min: 0.1, max: 5.0, step: 0.05 },
        { id: 'le', label: 'Largo Brazos (le)', type: 'float', default: 0.7, min: 0.0, max: 5.0, step: 0.05 },
        { id: 'wx', label: 'Grosor X (w.x)', type: 'float', default: 0.22, min: 0.02, max: 2.0, step: 0.02 },
        { id: 'wy', label: 'Grosor Y (w.y)', type: 'float', default: 0.22, min: 0.02, max: 2.0, step: 0.02 }
      ],
      glsl: `float sdHorseshoe( in vec3 p, in vec2 c, in float r, in float le, vec2 w )
{
  p.x = abs(p.x);
  float l = length(p.xy);
  p.xy = mat2(-c.x, c.y, c.y, c.x)*p.xy;
  p.xy = vec2((p.y>0.0 || p.x>0.0)?p.x:l*sign(-c.x),
              (p.x>0.0)?p.y:l );
  p.xy = vec2(p.x,abs(p.y-r))-vec2(le,0.0);
  vec2 q = vec2(length(max(p.xy,0.0)) + min(0.0,max(p.x,p.y)),p.z);
  vec2 d = abs(q) - w;
  return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}`,
      call: (pVar, params) => {
        const c = Math.cos(params.angle);
        const s = Math.sin(params.angle);
        return `sdHorseshoe(${pVar}, vec2(${fmt(c)}, ${fmt(s)}), ${fmt(params.r)}, ${fmt(params.le)}, vec2(${fmt(params.wx)}, ${fmt(params.wy)}))`;
      }
    },

    extrudedCross: {
      id: 'extrudedCross',
      name: 'Extruded Cross (opExtrussion 2D→3D)',
      category: 'polyhedra',
      iqName: 'opExtrussion (2D Cross Extruded)',
      funcName: 'sdExtrudedCross',
      dependencies: [],
      params: [
        { id: 'size', label: 'Largo Brazo (b.x)', type: 'float', default: 1.1, min: 0.1, max: 5.0, step: 0.05 },
        { id: 'thick', label: 'Ancho Brazo (b.y)', type: 'float', default: 0.35, min: 0.05, max: 3.0, step: 0.05 },
        { id: 'h', label: 'Extrusión Z (h)', type: 'float', default: 0.45, min: 0.02, max: 5.0, step: 0.05 }
      ],
      glsl: `float sdExtrudedCross( vec3 p, float size, float thick, float h )
{
  vec2 q1 = abs(p.xy) - vec2(size, thick);
  vec2 q2 = abs(p.xy) - vec2(thick, size);
  float d1 = length(max(q1,0.0)) + min(max(q1.x,q1.y),0.0);
  float d2 = length(max(q2,0.0)) + min(max(q2.x,q2.y),0.0);
  float d = min(d1, d2);
  vec2 w = vec2( d, abs(p.z) - h );
  return min(max(w.x,w.y),0.0) + length(max(w,0.0));
}`,
      call: (pVar, params) => `sdExtrudedCross(${pVar}, ${fmt(params.size)}, ${fmt(params.thick)}, ${fmt(params.h)})`
    },

    revolvedStar: {
      id: 'revolvedStar',
      name: 'Revolved Profile (opRevolution 2D→3D)',
      category: 'torus_spheres',
      iqName: 'opRevolution (2D Cross Revolved)',
      funcName: 'sdRevolvedCross',
      dependencies: [],
      params: [
        { id: 'o', label: 'Radio Revolución (o)', type: 'float', default: 1.0, min: 0.0, max: 5.0, step: 0.05 },
        { id: 'size', label: 'Tamaño Perfil', type: 'float', default: 0.55, min: 0.05, max: 3.0, step: 0.05 },
        { id: 'thick', label: 'Grosor Perfil', type: 'float', default: 0.18, min: 0.02, max: 2.0, step: 0.02 }
      ],
      glsl: `float sdRevolvedCross( vec3 p, float o, float size, float thick )
{
  vec2 q = vec2( length(p.xz) - o, p.y );
  vec2 q1 = abs(q) - vec2(size, thick);
  vec2 q2 = abs(q) - vec2(thick, size);
  float d1 = length(max(q1,0.0)) + min(max(q1.x,q1.y),0.0);
  float d2 = length(max(q2,0.0)) + min(max(q2.x,q2.y),0.0);
  return min(d1, d2);
}`,
      call: (pVar, params) => `sdRevolvedCross(${pVar}, ${fmt(params.o)}, ${fmt(params.size)}, ${fmt(params.thick)})`
    },

    infiniteCone: {
      id: 'infiniteCone',
      name: 'Infinite Cone (Cono Infinito)',
      category: 'cylinders',
      iqName: 'Infinite Cone - exact',
      funcName: 'sdInfiniteCone',
      dependencies: [],
      params: [
        { id: 'angle', label: 'Ángulo Cono (rad)', type: 'float', default: 0.5, min: 0.05, max: 1.5, step: 0.02 }
      ],
      glsl: `float sdInfiniteCone( vec3 p, vec2 c )
{
  vec2 q = vec2( length(p.xz), -p.y );
  float d = length(q-c*max(dot(q,c), 0.0));
  return d * ((q.x*c.y-q.y*c.x<0.0)?-1.0:1.0);
}`,
      call: (pVar, params) => {
        const s = Math.sin(params.angle);
        const c = Math.cos(params.angle);
        return `sdInfiniteCone(${pVar}, vec2(${fmt(s)}, ${fmt(c)}))`;
      }
    },

    plane: {
      id: 'plane',
      name: 'Plane (Plano Infinito)',
      category: 'polyhedra',
      iqName: 'Plane - exact',
      funcName: 'sdPlane',
      dependencies: [],
      params: [
        { id: 'nx', label: 'Normal X', type: 'float', default: 0.0, min: -1.0, max: 1.0, step: 0.05 },
        { id: 'ny', label: 'Normal Y', type: 'float', default: 1.0, min: -1.0, max: 1.0, step: 0.05 },
        { id: 'nz', label: 'Normal Z', type: 'float', default: 0.0, min: -1.0, max: 1.0, step: 0.05 },
        { id: 'h', label: 'Desplazamiento (h)', type: 'float', default: 1.5, min: -10.0, max: 10.0, step: 0.1 }
      ],
      glsl: `float sdPlane( vec3 p, vec3 n, float h )
{
  return dot(p,normalize(n)) + h;
}`,
      call: (pVar, params) => `sdPlane(${pVar}, vec3(${fmt(params.nx)}, ${fmt(params.ny)}, ${fmt(params.nz)}), ${fmt(params.h)})`
    },

    hexPrism: {
      id: 'hexPrism',
      name: 'Hexagonal Prism (Prisma Hexagonal)',
      category: 'polyhedra',
      iqName: 'Hexagonal Prism - exact',
      funcName: 'sdHexPrism',
      dependencies: [],
      params: [
        { id: 'hx', label: 'Radio Hexágono (h.x)', type: 'float', default: 0.9, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'hy', label: 'Profundidad Z (h.y)', type: 'float', default: 0.5, min: 0.05, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdHexPrism( vec3 p, vec2 h )
{
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  p = abs(p);
  p.xy -= 2.0*min(dot(k.xy, p.xy), 0.0)*k.xy;
  vec2 d = vec2(
       length(p.xy-vec2(clamp(p.x,-k.z*h.x,k.z*h.x), h.x))*sign(p.y-h.x),
       p.z-h.y );
  return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}`,
      call: (pVar, params) => `sdHexPrism(${pVar}, vec2(${fmt(params.hx)}, ${fmt(params.hy)}))`
    },

    triPrism: {
      id: 'triPrism',
      name: 'Triangular Prism (Prisma Triangular)',
      category: 'polyhedra',
      iqName: 'Triangular Prism - bound',
      funcName: 'sdTriPrism',
      dependencies: [],
      params: [
        { id: 'hx', label: 'Tamaño Triángulo (h.x)', type: 'float', default: 1.0, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'hy', label: 'Profundidad Z (h.y)', type: 'float', default: 0.5, min: 0.05, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdTriPrism( vec3 p, vec2 h )
{
  vec3 q = abs(p);
  return max(q.z-h.y,max(q.x*0.866025+p.y*0.5,-p.y)-h.x*0.5);
}`,
      call: (pVar, params) => `sdTriPrism(${pVar}, vec2(${fmt(params.hx)}, ${fmt(params.hy)}))`
    },

    capsule: {
      id: 'capsule',
      name: 'Capsule / Line (Cápsula entre 2 Puntos)',
      category: 'cylinders',
      iqName: 'Capsule / Line - exact',
      funcName: 'sdCapsule',
      dependencies: [],
      params: [
        { id: 'ax', label: 'Punto A.x', type: 'float', default: -0.8, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'ay', label: 'Punto A.y', type: 'float', default: -0.6, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'az', label: 'Punto A.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bx', label: 'Punto B.x', type: 'float', default: 0.8, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'by', label: 'Punto B.y', type: 'float', default: 0.6, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bz', label: 'Punto B.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'r', label: 'Radio (r)', type: 'float', default: 0.4, min: 0.02, max: 5.0, step: 0.02 }
      ],
      glsl: `float sdCapsule( vec3 p, vec3 a, vec3 b, float r )
{
  vec3 pa = p - a, ba = b - a;
  float h = clamp( dot(pa,ba)/dot(ba,ba), 0.0, 1.0 );
  return length( pa - ba*h ) - r;
}`,
      call: (pVar, params) => `sdCapsule(${pVar}, vec3(${fmt(params.ax)}, ${fmt(params.ay)}, ${fmt(params.az)}), vec3(${fmt(params.bx)}, ${fmt(params.by)}, ${fmt(params.bz)}), ${fmt(params.r)})`
    },

    verticalCapsule: {
      id: 'verticalCapsule',
      name: 'Vertical Capsule (Cápsula Vertical)',
      category: 'cylinders',
      iqName: 'Vertical Capsule - exact',
      funcName: 'sdVerticalCapsule',
      dependencies: [],
      params: [
        { id: 'h', label: 'Altura (h)', type: 'float', default: 1.2, min: 0.0, max: 10.0, step: 0.05 },
        { id: 'r', label: 'Radio (r)', type: 'float', default: 0.5, min: 0.02, max: 5.0, step: 0.02 }
      ],
      glsl: `float sdVerticalCapsule( vec3 p, float h, float r )
{
  p.y -= clamp( p.y, 0.0, h );
  return length( p ) - r;
}`,
      call: (pVar, params) => `sdVerticalCapsule(${pVar}, ${fmt(params.h)}, ${fmt(params.r)})`
    },

    cappedCylinder: {
      id: 'cappedCylinder',
      name: 'Capped Cylinder (Cilindro Vertical)',
      category: 'cylinders',
      iqName: 'Vertical Cylinder - exact',
      funcName: 'sdCappedCylinder',
      dependencies: [],
      params: [
        { id: 'h', label: 'Semi-Altura (h)', type: 'float', default: 1.0, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'r', label: 'Radio (r)', type: 'float', default: 0.6, min: 0.05, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdCappedCylinder( vec3 p, float h, float r )
{
  vec2 d = abs(vec2(length(p.xz),p.y)) - vec2(r,h);
  return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}`,
      call: (pVar, params) => `sdCappedCylinder(${pVar}, ${fmt(params.h)}, ${fmt(params.r)})`
    },

    arbitraryCappedCylinder: {
      id: 'arbitraryCappedCylinder',
      name: 'Arbitrary Capped Cylinder (Cilindro A-B)',
      category: 'cylinders',
      iqName: 'Arbitrary Capped Cylinder - exact',
      funcName: 'sdCappedCylinderSeg',
      dependencies: [],
      params: [
        { id: 'ax', label: 'Punto A.x', type: 'float', default: -0.7, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'ay', label: 'Punto A.y', type: 'float', default: -0.7, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'az', label: 'Punto A.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bx', label: 'Punto B.x', type: 'float', default: 0.7, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'by', label: 'Punto B.y', type: 'float', default: 0.7, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bz', label: 'Punto B.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'r', label: 'Radio (r)', type: 'float', default: 0.5, min: 0.05, max: 5.0, step: 0.05 }
      ],
      glsl: `float sdCappedCylinderSeg(vec3 p, vec3 a, vec3 b, float r)
{
  vec3  ba = b - a;
  vec3  pa = p - a;
  float baba = dot(ba,ba);
  float paba = dot(pa,ba);
  float x = length(pa*baba-ba*paba) - r*baba;
  float y = abs(paba-baba*0.5)-baba*0.5;
  float x2 = x*x;
  float y2 = y*y*baba;
  float d = (max(x,y)<0.0)?-min(x2,y2):(((x>0.0)?x2:0.0)+((y>0.0)?y2:0.0));
  return sign(d)*sqrt(abs(d))/baba;
}`,
      call: (pVar, params) => `sdCappedCylinderSeg(${pVar}, vec3(${fmt(params.ax)}, ${fmt(params.ay)}, ${fmt(params.az)}), vec3(${fmt(params.bx)}, ${fmt(params.by)}, ${fmt(params.bz)}), ${fmt(params.r)})`
    },

    roundedCylinder: {
      id: 'roundedCylinder',
      name: 'Rounded Cylinder (Cilindro Redondeado)',
      category: 'cylinders',
      iqName: 'Rounded Cylinder - exact',
      funcName: 'sdRoundedCylinder',
      dependencies: [],
      params: [
        { id: 'ra', label: 'Radio (ra)', type: 'float', default: 0.5, min: 0.05, max: 5.0, step: 0.05 },
        { id: 'rb', label: 'Bisel (rb)', type: 'float', default: 0.15, min: 0.0, max: 2.0, step: 0.02 },
        { id: 'h', label: 'Semi-Altura (h)', type: 'float', default: 0.8, min: 0.05, max: 5.0, step: 0.05 }
      ],
      glsl: `float sdRoundedCylinder( vec3 p, float ra, float rb, float h )
{
  vec2 d = vec2( length(p.xz)-2.0*ra+rb, abs(p.y) - h );
  return min(max(d.x,d.y),0.0) + length(max(d,0.0)) - rb;
}`,
      call: (pVar, params) => `sdRoundedCylinder(${pVar}, ${fmt(params.ra)}, ${fmt(params.rb)}, ${fmt(params.h)})`
    },

    cappedCone: {
      id: 'cappedCone',
      name: 'Capped Cone (Cono Truncado Vertical)',
      category: 'cylinders',
      iqName: 'Capped Cone - exact',
      funcName: 'sdCappedCone',
      dependencies: ['dot2_vec2'],
      params: [
        { id: 'h', label: 'Semi-Altura (h)', type: 'float', default: 0.9, min: 0.05, max: 5.0, step: 0.05 },
        { id: 'r1', label: 'Radio Base (r1)', type: 'float', default: 0.9, min: 0.02, max: 5.0, step: 0.05 },
        { id: 'r2', label: 'Radio Tope (r2)', type: 'float', default: 0.35, min: 0.02, max: 5.0, step: 0.05 }
      ],
      glsl: `float sdCappedCone( vec3 p, float h, float r1, float r2 )
{
  vec2 q = vec2( length(p.xz), p.y );
  vec2 k1 = vec2(r2,h);
  vec2 k2 = vec2(r2-r1,2.0*h);
  vec2 ca = vec2(q.x-min(q.x,(q.y<0.0)?r1:r2), abs(q.y)-h);
  vec2 cb = q - k1 + k2*clamp( dot(k1-q,k2)/dot2(k2), 0.0, 1.0 );
  float s = (cb.x<0.0 && ca.y<0.0) ? -1.0 : 1.0;
  return s*sqrt( min(dot2(ca),dot2(cb)) );
}`,
      call: (pVar, params) => `sdCappedCone(${pVar}, ${fmt(params.h)}, ${fmt(params.r1)}, ${fmt(params.r2)})`
    },

    arbitraryCappedCone: {
      id: 'arbitraryCappedCone',
      name: 'Arbitrary Capped Cone (Cono Truncado A-B)',
      category: 'cylinders',
      iqName: 'Capped Cone (Segment) - exact',
      funcName: 'sdCappedConeSeg',
      dependencies: ['dot2_vec3'],
      params: [
        { id: 'ax', label: 'Punto A.x', type: 'float', default: -0.6, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'ay', label: 'Punto A.y', type: 'float', default: -0.8, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'az', label: 'Punto A.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bx', label: 'Punto B.x', type: 'float', default: 0.6, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'by', label: 'Punto B.y', type: 'float', default: 0.8, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bz', label: 'Punto B.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'ra', label: 'Radio A (ra)', type: 'float', default: 0.7, min: 0.02, max: 5.0, step: 0.05 },
        { id: 'rb', label: 'Radio B (rb)', type: 'float', default: 0.25, min: 0.02, max: 5.0, step: 0.05 }
      ],
      glsl: `float sdCappedConeSeg(vec3 p, vec3 a, vec3 b, float ra, float rb)
{
  float rba  = rb-ra;
  float baba = dot(b-a,b-a);
  float papa = dot(p-a,p-a);
  float paba = dot(p-a,b-a)/baba;
  float x = sqrt( papa - paba*paba*baba );
  float cax = max(0.0,x-((paba<0.5)?ra:rb));
  float cay = abs(paba-0.5)-0.5;
  float k = rba*rba + baba;
  float f = clamp( (rba*(x-ra)+paba*baba)/k, 0.0, 1.0 );
  float cbx = x-ra - f*rba;
  float cby = paba - f;
  float s = (cbx<0.0 && cay<0.0) ? -1.0 : 1.0;
  return s*sqrt( min(cax*cax + cay*cay*baba,
                     cbx*cbx + cby*cby*baba) );
}`,
      call: (pVar, params) => `sdCappedConeSeg(${pVar}, vec3(${fmt(params.ax)}, ${fmt(params.ay)}, ${fmt(params.az)}), vec3(${fmt(params.bx)}, ${fmt(params.by)}, ${fmt(params.bz)}), ${fmt(params.ra)}, ${fmt(params.rb)})`
    },

    solidAngle: {
      id: 'solidAngle',
      name: 'Solid Angle (Sector Cónico Esférico)',
      category: 'torus_spheres',
      iqName: 'Solid Angle - exact',
      funcName: 'sdSolidAngle',
      dependencies: [],
      params: [
        { id: 'angle', label: 'Ángulo (rad)', type: 'float', default: 0.65, min: 0.05, max: 1.55, step: 0.05 },
        { id: 'ra', label: 'Radio Esfera (ra)', type: 'float', default: 1.3, min: 0.1, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdSolidAngle(vec3 p, vec2 c, float ra)
{
  vec2 q = vec2( length(p.xz), p.y );
  float l = length(q) - ra;
  float m = length(q - c*clamp(dot(q,c),0.0,ra) );
  return max(l,m*sign(c.y*q.x-c.x*q.y));
}`,
      call: (pVar, params) => {
        const s = Math.sin(params.angle);
        const c = Math.cos(params.angle);
        return `sdSolidAngle(${pVar}, vec2(${fmt(s)}, ${fmt(c)}), ${fmt(params.ra)})`;
      }
    },

    cutSphere: {
      id: 'cutSphere',
      name: 'Cut Sphere (Esfera Cortada)',
      category: 'torus_spheres',
      iqName: 'Cut Sphere - exact',
      funcName: 'sdCutSphere',
      dependencies: [],
      params: [
        { id: 'r', label: 'Radio (r)', type: 'float', default: 1.2, min: 0.1, max: 10.0, step: 0.05 },
        { id: 'h', label: 'Altura Corte (h)', type: 'float', default: 0.3, min: -5.0, max: 5.0, step: 0.05 }
      ],
      glsl: `float sdCutSphere( vec3 p, float r, float h )
{
  float w = sqrt(max(r*r-h*h, 0.0));
  vec2 q = vec2( length(p.xz), p.y );
  float s = max( (h-r)*q.x*q.x+w*w*(h+r-2.0*q.y), h*q.x-w*q.y );
  return (s<0.0) ? length(q)-r :
         (q.x<w) ? h - q.y     :
                   length(q-vec2(w,h));
}`,
      call: (pVar, params) => `sdCutSphere(${pVar}, ${fmt(params.r)}, ${fmt(params.h)})`
    },

    cutHollowSphere: {
      id: 'cutHollowSphere',
      name: 'Cut Hollow Sphere (Cuenco Esférico Hueco)',
      category: 'torus_spheres',
      iqName: 'Cut Hollow Sphere - exact',
      funcName: 'sdCutHollowSphere',
      dependencies: [],
      params: [
        { id: 'r', label: 'Radio (r)', type: 'float', default: 1.2, min: 0.1, max: 10.0, step: 0.05 },
        { id: 'h', label: 'Altura Corte (h)', type: 'float', default: 0.2, min: -5.0, max: 5.0, step: 0.05 },
        { id: 't', label: 'Espesor Pared (t)', type: 'float', default: 0.12, min: 0.01, max: 2.0, step: 0.01 }
      ],
      glsl: `float sdCutHollowSphere( vec3 p, float r, float h, float t )
{
  float w = sqrt(max(r*r-h*h, 0.0));
  vec2 q = vec2( length(p.xz), p.y );
  return ((h*q.x<w*q.y) ? length(q-vec2(w,h)) : 
                          abs(length(q)-r) ) - t;
}`,
      call: (pVar, params) => `sdCutHollowSphere(${pVar}, ${fmt(params.r)}, ${fmt(params.h)}, ${fmt(params.t)})`
    },

    deathStar: {
      id: 'deathStar',
      name: 'Death Star (Estrella de la Muerte)',
      category: 'torus_spheres',
      iqName: 'Death Star - exact',
      funcName: 'sdDeathStar',
      dependencies: [],
      params: [
        { id: 'ra', label: 'Radio Principal (ra)', type: 'float', default: 1.2, min: 0.1, max: 10.0, step: 0.05 },
        { id: 'rb', label: 'Radio Cavidad (rb)', type: 'float', default: 0.85, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'd', label: 'Distancia Corte (d)', type: 'float', default: 1.4, min: 0.05, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdDeathStar( vec3 p2, float ra, float rb, float d )
{
  float a = (ra*ra - rb*rb + d*d)/(2.0*d);
  float b = sqrt(max(ra*ra-a*a,0.0));
  vec2 p = vec2( p2.x, length(p2.yz) );
  if( p.x*b-p.y*a > d*max(b-p.y,0.0) )
    return length(p-vec2(a,b));
  else
    return max( (length(p          )-ra),
               -(length(p-vec2(d,0))-rb));
}`,
      call: (pVar, params) => `sdDeathStar(${pVar}, ${fmt(params.ra)}, ${fmt(params.rb)}, ${fmt(params.d)})`
    },

    roundCone: {
      id: 'roundCone',
      name: 'Round Cone (Cono Redondeado Vertical)',
      category: 'cylinders',
      iqName: 'Round Cone - exact',
      funcName: 'sdRoundCone',
      dependencies: ['dot2_vec2'],
      params: [
        { id: 'r1', label: 'Radio Inferior (r1)', type: 'float', default: 0.7, min: 0.02, max: 5.0, step: 0.05 },
        { id: 'r2', label: 'Radio Superior (r2)', type: 'float', default: 0.25, min: 0.02, max: 5.0, step: 0.05 },
        { id: 'h', label: 'Altura (h)', type: 'float', default: 1.2, min: 0.05, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdRoundCone( vec3 p, float r1, float r2, float h )
{
  vec2 q = vec2( length(p.xz), p.y );
  float b = (r1-r2)/h;
  float a = sqrt(max(1.0-b*b, 0.0001));
  float k = dot(q,vec2(-b,a));
  if( k < 0.0 ) return length(q) - r1;
  if( k > a*h ) return length(q-vec2(0.0,h)) - r2;
  return dot(q, vec2(a,b) ) - r1;
}`,
      call: (pVar, params) => `sdRoundCone(${pVar}, ${fmt(params.r1)}, ${fmt(params.r2)}, ${fmt(params.h)})`
    },

    arbitraryRoundCone: {
      id: 'arbitraryRoundCone',
      name: 'Arbitrary Round Cone (Cono Redondeado A-B)',
      category: 'cylinders',
      iqName: 'Round Cone (Segment) - exact',
      funcName: 'sdRoundConeSeg',
      dependencies: ['dot2_vec3'],
      params: [
        { id: 'ax', label: 'Punto A.x', type: 'float', default: -0.6, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'ay', label: 'Punto A.y', type: 'float', default: -0.6, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'az', label: 'Punto A.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bx', label: 'Punto B.x', type: 'float', default: 0.6, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'by', label: 'Punto B.y', type: 'float', default: 0.6, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bz', label: 'Punto B.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'r1', label: 'Radio A (r1)', type: 'float', default: 0.6, min: 0.02, max: 5.0, step: 0.05 },
        { id: 'r2', label: 'Radio B (r2)', type: 'float', default: 0.2, min: 0.02, max: 5.0, step: 0.05 }
      ],
      glsl: `float sdRoundConeSeg(vec3 p, vec3 a, vec3 b, float r1, float r2)
{
  vec3  ba = b - a;
  float l2 = dot(ba,ba);
  float rr = r1 - r2;
  float a2 = l2 - rr*rr;
  float il2 = 1.0/l2;
  vec3 pa = p - a;
  float y = dot(pa,ba);
  float z = y - l2;
  float x2 = dot2( pa*l2 - ba*y );
  float y2 = y*y*l2;
  float z2 = z*z*l2;
  float k = sign(rr)*rr*rr*x2;
  if( sign(z)*a2*z2>k ) return  sqrt(x2 + z2)        *il2 - r2;
  if( sign(y)*a2*y2<k ) return  sqrt(x2 + y2)        *il2 - r1;
                        return (sqrt(x2*a2*il2)+y*rr)*il2 - r1;
}`,
      call: (pVar, params) => `sdRoundConeSeg(${pVar}, vec3(${fmt(params.ax)}, ${fmt(params.ay)}, ${fmt(params.az)}), vec3(${fmt(params.bx)}, ${fmt(params.by)}, ${fmt(params.bz)}), ${fmt(params.r1)}, ${fmt(params.r2)})`
    },

    ellipsoid: {
      id: 'ellipsoid',
      name: 'Ellipsoid (Elipsoide)',
      category: 'basic',
      iqName: 'Ellipsoid - bound (not exact!)',
      funcName: 'sdEllipsoid',
      dependencies: [],
      params: [
        { id: 'rx', label: 'Radio X (r.x)', type: 'float', default: 1.4, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'ry', label: 'Radio Y (r.y)', type: 'float', default: 0.85, min: 0.05, max: 10.0, step: 0.05 },
        { id: 'rz', label: 'Radio Z (r.z)', type: 'float', default: 0.65, min: 0.05, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdEllipsoid( vec3 p, vec3 r )
{
  float k0 = length(p/r);
  float k1 = length(p/(r*r));
  return k0*(k0-1.0)/k1;
}`,
      call: (pVar, params) => `sdEllipsoid(${pVar}, vec3(${fmt(params.rx)}, ${fmt(params.ry)}, ${fmt(params.rz)}))`
    },

    vesicaSegment: {
      id: 'vesicaSegment',
      name: 'Revolved Vesica (Vésica Revolucionada)',
      category: 'torus_spheres',
      iqName: 'Revolved Vesica - exact',
      funcName: 'sdVesicaSegment',
      dependencies: [],
      params: [
        { id: 'ax', label: 'Punto A.x', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'ay', label: 'Punto A.y', type: 'float', default: -1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'az', label: 'Punto A.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bx', label: 'Punto B.x', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'by', label: 'Punto B.y', type: 'float', default: 1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bz', label: 'Punto B.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'w', label: 'Ancho (w)', type: 'float', default: 0.65, min: 0.05, max: 5.0, step: 0.05 }
      ],
      glsl: `float sdVesicaSegment( in vec3 p, in vec3 a, in vec3 b, in float w )
{
  vec3  c = (a+b)*0.5;
  float l = length(b-a);
  vec3  v = (b-a)/l;
  float y = dot(p-c,v);
  vec2  q = vec2(length(p-c-y*v),abs(y));
  float r = 0.5*l;
  float d = 0.5*(r*r-w*w)/w;
  vec3  h = (r*q.x<d*(q.y-r)) ? vec3(0.0,r,0.0) : vec3(-d,0.0,d+w);
  return length(q-h.xy) - h.z;
}`,
      call: (pVar, params) => `sdVesicaSegment(${pVar}, vec3(${fmt(params.ax)}, ${fmt(params.ay)}, ${fmt(params.az)}), vec3(${fmt(params.bx)}, ${fmt(params.by)}, ${fmt(params.bz)}), ${fmt(params.w)})`
    },

    rhombus: {
      id: 'rhombus',
      name: 'Rhombus (Rombo 3D)',
      category: 'polyhedra',
      iqName: 'Rhombus - exact',
      funcName: 'sdRhombus',
      dependencies: ['ndot'],
      params: [
        { id: 'la', label: 'Diagonal A (la)', type: 'float', default: 1.1, min: 0.05, max: 5.0, step: 0.05 },
        { id: 'lb', label: 'Diagonal B (lb)', type: 'float', default: 0.7, min: 0.05, max: 5.0, step: 0.05 },
        { id: 'h', label: 'Semi-Altura Y (h)', type: 'float', default: 0.25, min: 0.02, max: 5.0, step: 0.02 },
        { id: 'ra', label: 'Redondeo (ra)', type: 'float', default: 0.08, min: 0.0, max: 2.0, step: 0.02 }
      ],
      glsl: `float sdRhombus(vec3 p, float la, float lb, float h, float ra)
{
  p = abs(p);
  vec2 b = vec2(la,lb);
  float f = clamp( (ndot(b,b-2.0*p.xz))/dot(b,b), -1.0, 1.0 );
  vec2 q = vec2(length(p.xz-0.5*b*vec2(1.0-f,1.0+f))*sign(p.x*b.y+p.z*b.x-b.x*b.y)-ra, p.y-h);
  return min(max(q.x,q.y),0.0) + length(max(q,0.0));
}`,
      call: (pVar, params) => `sdRhombus(${pVar}, ${fmt(params.la)}, ${fmt(params.lb)}, ${fmt(params.h)}, ${fmt(params.ra)})`
    },

    octahedron: {
      id: 'octahedron',
      name: 'Octahedron (Octaedro Exacto)',
      category: 'polyhedra',
      iqName: 'Octahedron - exact',
      funcName: 'sdOctahedron',
      dependencies: [],
      params: [
        { id: 's', label: 'Tamaño (s)', type: 'float', default: 1.3, min: 0.05, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdOctahedron( vec3 p, float s )
{
  p = abs(p);
  float m = p.x+p.y+p.z-s;
  vec3 q;
       if( 3.0*p.x < m ) q = p.xyz;
  else if( 3.0*p.y < m ) q = p.yzx;
  else if( 3.0*p.z < m ) q = p.zxy;
  else return m*0.57735027;
  float k = clamp(0.5*(q.z-q.y+s),0.0,s); 
  return length(vec3(q.x,q.y-s+k,q.z-k)); 
}`,
      call: (pVar, params) => `sdOctahedron(${pVar}, ${fmt(params.s)})`
    },

    octahedronBound: {
      id: 'octahedronBound',
      name: 'Octahedron Bound (Octaedro Rápido)',
      category: 'polyhedra',
      iqName: 'Octahedron - bound (not exact)',
      funcName: 'sdOctahedronBound',
      dependencies: [],
      params: [
        { id: 's', label: 'Tamaño (s)', type: 'float', default: 1.3, min: 0.05, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdOctahedronBound( vec3 p, float s)
{
  p = abs(p);
  return (p.x+p.y+p.z-s)*0.57735027;
}`,
      call: (pVar, params) => `sdOctahedronBound(${pVar}, ${fmt(params.s)})`
    },

    pyramid: {
      id: 'pyramid',
      name: 'Pyramid (Pirámide Exacta)',
      category: 'polyhedra',
      iqName: 'Pyramid - exact',
      funcName: 'sdPyramid',
      dependencies: [],
      params: [
        { id: 'h', label: 'Altura (h)', type: 'float', default: 1.3, min: 0.1, max: 10.0, step: 0.05 }
      ],
      glsl: `float sdPyramid( vec3 p, float h )
{
  float m2 = h*h + 0.25;
  p.xz = abs(p.xz);
  p.xz = (p.z>p.x) ? p.zx : p.xz;
  p.xz -= 0.5;
  vec3 q = vec3( p.z, h*p.y - 0.5*p.x, h*p.x + 0.5*p.y);
  float s = max(-q.x,0.0);
  float t = clamp( (q.y-0.5*p.z)/(m2+0.25), 0.0, 1.0 );
  float a = m2*(q.x+s)*(q.x+s) + q.y*q.y;
  float b = m2*(q.x+0.5*t)*(q.x+0.5*t) + (q.y-m2*t)*(q.y-m2*t);
  float d2 = min(q.y,-q.x*m2-q.y*0.5) > 0.0 ? 0.0 : min(a,b);
  return sqrt( (d2+q.z*q.z)/m2 ) * sign(max(q.z,-p.y));
}`,
      call: (pVar, params) => `sdPyramid(${pVar}, ${fmt(params.h)})`
    },

    triangle: {
      id: 'triangle',
      name: 'Triangle 3D (Triángulo Exacto)',
      category: 'polyhedra',
      iqName: 'Triangle - exact',
      funcName: 'udTriangle',
      dependencies: ['dot2_vec3'],
      params: [
        { id: 'ax', label: 'Vértice A.x', type: 'float', default: -1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'ay', label: 'Vértice A.y', type: 'float', default: -0.7, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'az', label: 'Vértice A.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bx', label: 'Vértice B.x', type: 'float', default: 1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'by', label: 'Vértice B.y', type: 'float', default: -0.7, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bz', label: 'Vértice B.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'cx', label: 'Vértice C.x', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'cy', label: 'Vértice C.y', type: 'float', default: 1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'cz', label: 'Vértice C.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'th', label: 'Grosor Superficie', type: 'float', default: 0.06, min: 0.01, max: 1.0, step: 0.01 }
      ],
      glsl: `float udTriangle( vec3 p, vec3 a, vec3 b, vec3 c )
{
  vec3 ba = b - a; vec3 pa = p - a;
  vec3 cb = c - b; vec3 pb = p - b;
  vec3 ac = a - c; vec3 pc = p - c;
  vec3 nor = cross( ba, ac );
  return sqrt(
    (sign(dot(cross(ba,nor),pa)) +
     sign(dot(cross(cb,nor),pb)) +
     sign(dot(cross(ac,nor),pc))<2.0)
     ?
     min( min(
     dot2(ba*clamp(dot(ba,pa)/dot2(ba),0.0,1.0)-pa),
     dot2(cb*clamp(dot(cb,pb)/dot2(cb),0.0,1.0)-pb) ),
     dot2(ac*clamp(dot(ac,pc)/dot2(ac),0.0,1.0)-pc) )
     :
     dot(nor,pa)*dot(nor,pa)/dot2(nor) );
}`,
      call: (pVar, params) => `(udTriangle(${pVar}, vec3(${fmt(params.ax)}, ${fmt(params.ay)}, ${fmt(params.az)}), vec3(${fmt(params.bx)}, ${fmt(params.by)}, ${fmt(params.bz)}), vec3(${fmt(params.cx)}, ${fmt(params.cy)}, ${fmt(params.cz)})) - ${fmt(params.th)})`
    },

    quad: {
      id: 'quad',
      name: 'Quad 3D (Cuadrilátero Exacto)',
      category: 'polyhedra',
      iqName: 'Quad - exact',
      funcName: 'udQuad',
      dependencies: ['dot2_vec3'],
      params: [
        { id: 'ax', label: 'Vértice A.x', type: 'float', default: -1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'ay', label: 'Vértice A.y', type: 'float', default: -1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'az', label: 'Vértice A.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bx', label: 'Vértice B.x', type: 'float', default: 1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'by', label: 'Vértice B.y', type: 'float', default: -1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'bz', label: 'Vértice B.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'cx', label: 'Vértice C.x', type: 'float', default: 1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'cy', label: 'Vértice C.y', type: 'float', default: 1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'cz', label: 'Vértice C.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'dx', label: 'Vértice D.x', type: 'float', default: -1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'dy', label: 'Vértice D.y', type: 'float', default: 1.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'dz', label: 'Vértice D.z', type: 'float', default: 0.0, min: -5.0, max: 5.0, step: 0.05 },
        { id: 'th', label: 'Grosor Superficie', type: 'float', default: 0.06, min: 0.01, max: 1.0, step: 0.01 }
      ],
      glsl: `float udQuad( vec3 p, vec3 a, vec3 b, vec3 c, vec3 d )
{
  vec3 ba = b - a; vec3 pa = p - a;
  vec3 cb = c - b; vec3 pb = p - b;
  vec3 dc = d - c; vec3 pc = p - c;
  vec3 ad = a - d; vec3 pd = p - d;
  vec3 nor = cross( ba, ad );
  return sqrt(
    (sign(dot(cross(ba,nor),pa)) +
     sign(dot(cross(cb,nor),pb)) +
     sign(dot(cross(dc,nor),pc)) +
     sign(dot(cross(ad,nor),pd))<3.0)
     ?
     min( min( min(
     dot2(ba*clamp(dot(ba,pa)/dot2(ba),0.0,1.0)-pa),
     dot2(cb*clamp(dot(cb,pb)/dot2(cb),0.0,1.0)-pb) ),
     dot2(dc*clamp(dot(dc,pc)/dot2(dc),0.0,1.0)-pc) ),
     dot2(ad*clamp(dot(ad,pd)/dot2(ad),0.0,1.0)-pd) )
     :
     dot(nor,pa)*dot(nor,pa)/dot2(nor) );
}`,
      call: (pVar, params) => `(udQuad(${pVar}, vec3(${fmt(params.ax)}, ${fmt(params.ay)}, ${fmt(params.az)}), vec3(${fmt(params.bx)}, ${fmt(params.by)}, ${fmt(params.bz)}), vec3(${fmt(params.cx)}, ${fmt(params.cy)}, ${fmt(params.cz)}), vec3(${fmt(params.dx)}, ${fmt(params.dy)}, ${fmt(params.dz)})) - ${fmt(params.th)})`
    }
  };

  function fmt(n) {
    const num = Number(n);
    if (isNaN(num)) return '0.0';
    let s = num.toFixed(4).replace(/0+$/, '');
    if (s.endsWith('.')) s += '0';
    return s;
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
    createNode
  };
})();
