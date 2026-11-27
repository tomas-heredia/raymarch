// ============================================================================
// IQ-SDF SUPREME ENGINE — Primitivas: Básicas y Cajas
// Referencia: https://iquilezles.org/articles/distfunctions/
// Para agregar una primitiva: ver la receta en CLAUDE.md (sección Primitives).
// ============================================================================

(function () {
  const { registerPrimitive, P, Arg, Post } = window.SDFLibrary;

  registerPrimitive({
    key: 'sphere',
    name: 'Sphere (Esfera)',
    category: 'basic',
    iqName: 'Sphere - exact',
    params: [
      P('rad', 'Radio (rad)', 1, 0.05, 10, 0.05)
    ],
    args: [Arg.size(Arg.float('rad'), 'replace')],
    glsl: `float sphere(vec3 p, float rad) 
{
    return length(p) - rad;
}`
  });

  registerPrimitive({
    key: 'box',
    name: 'Box (Caja Exacta)',
    category: 'basic',
    iqName: 'Box - exact',
    params: [
      P('bx', 'Ancho X (b.x)', 1, 0.05, 10, 0.05),
      P('by', 'Alto Y (b.y)', 1, 0.05, 10, 0.05),
      P('bz', 'Profundidad Z (b.z)', 1, 0.05, 10, 0.05)
    ],
    args: [Arg.size(Arg.vec3('b'), 'scale')],
    glsl: `float sdBox( vec3 p, vec3 b )
{
  vec3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}`
  });

  registerPrimitive({
    key: 'roundBox',
    name: 'Round Box (Caja Redondeada)',
    category: 'basic',
    iqName: 'Round Box - exact',
    params: [
      P('bx', 'Ancho X (b.x)', 0.85, 0.05, 10, 0.05),
      P('by', 'Alto Y (b.y)', 0.85, 0.05, 10, 0.05),
      P('bz', 'Profundidad Z (b.z)', 0.85, 0.05, 10, 0.05),
      P('r', 'Bisel / Radio (r)', 0.2, 0, 3, 0.02)
    ],
    args: [Arg.vec3('b'), 'r'],
    glsl: `float sdRoundBox( vec3 p, vec3 b, float r )
{
  vec3 q = abs(p) - b + r;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0) - r;
}`
  });

  registerPrimitive({
    key: 'boxFrame',
    name: 'Box Frame (Marco de Caja)',
    category: 'basic',
    iqName: 'Box Frame - exact',
    params: [
      P('bx', 'Ancho X (b.x)', 1.1, 0.05, 10, 0.05),
      P('by', 'Alto Y (b.y)', 1.1, 0.05, 10, 0.05),
      P('bz', 'Profundidad Z (b.z)', 1.1, 0.05, 10, 0.05),
      P('e', 'Grosor Marco (e)', 0.12, 0.01, 2, 0.01)
    ],
    args: [Arg.vec3('b'), 'e'],
    glsl: `float sdBoxFrame( vec3 p, vec3 b, float e )
{
       p = abs(p  )-b;
  vec3 q = abs(p+e)-e;
  return min(min(
      length(max(vec3(p.x,q.y,q.z),0.0))+min(max(p.x,max(q.y,q.z)),0.0),
      length(max(vec3(q.x,p.y,q.z),0.0))+min(max(q.x,max(p.y,q.z)),0.0)),
      length(max(vec3(q.x,q.y,p.z),0.0))+min(max(q.x,max(q.y,p.z)),0.0));
}`
  });

  registerPrimitive({
    key: 'ellipsoid',
    name: 'Ellipsoid (Elipsoide)',
    category: 'basic',
    iqName: 'Ellipsoid - bound (not exact!)',
    params: [
      P('rx', 'Radio X (r.x)', 1.4, 0.05, 10, 0.05),
      P('ry', 'Radio Y (r.y)', 0.85, 0.05, 10, 0.05),
      P('rz', 'Radio Z (r.z)', 0.65, 0.05, 10, 0.05)
    ],
    args: [Arg.vec3('r')],
    glsl: `float sdEllipsoid( vec3 p, vec3 r )
{
  float k0 = length(p/r);
  float k1 = length(p/(r*r));
  return k0*(k0-1.0)/k1;
}`
  });
})();
