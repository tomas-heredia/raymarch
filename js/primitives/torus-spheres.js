// ============================================================================
// IQ-SDF SUPREME ENGINE — Primitivas: Toroides y Esferas Cortadas
// Referencia: https://iquilezles.org/articles/distfunctions/
// Para agregar una primitiva: ver la receta en CLAUDE.md (sección Primitives).
// ============================================================================

(function () {
  const { registerPrimitive, P, Arg, Post } = window.SDFLibrary;

  registerPrimitive({
    key: 'torus',
    name: 'Torus (Toroide / Dona)',
    category: 'torus_spheres',
    iqName: 'Torus - exact',
    params: [
      P('tx', 'Radio Mayor (t.x)', 1.1, 0.05, 10, 0.05),
      P('ty', 'Radio Tubo (t.y)', 0.35, 0.02, 5, 0.02)
    ],
    args: [Arg.vec2('t')],
    glsl: `float sdTorus( vec3 p, vec2 t )
{
  vec2 q = vec2(length(p.xz)-t.x,p.y);
  return length(q)-t.y;
}`
  });

  registerPrimitive({
    key: 'cappedTorus',
    name: 'Capped Torus (Arco Toroidal)',
    category: 'torus_spheres',
    iqName: 'Capped Torus - exact',
    params: [
      P('angle', 'Ángulo Apertura (rad)', 2, 0.1, 3.1, 0.05),
      P('ra', 'Radio Mayor (ra)', 1.1, 0.1, 10, 0.05),
      P('rb', 'Radio Tubo (rb)', 0.3, 0.02, 5, 0.02)
    ],
    args: [Arg.sinCos('angle'), 'ra', 'rb'],
    glsl: `float sdCappedTorus( vec3 p, vec2 sc, float ra, float rb)
{
  p.x = abs(p.x);
  float k = (sc.y*p.x>sc.x*p.y) ? dot(p.xy,sc) : length(p.xy);
  return sqrt( dot(p,p) + ra*ra - 2.0*ra*k ) - rb;
}`
  });

  registerPrimitive({
    key: 'link',
    name: 'Link (Eslabón de Cadena)',
    category: 'torus_spheres',
    iqName: 'Link - exact',
    params: [
      P('le', 'Elongación (le)', 0.5, 0, 5, 0.05),
      P('r1', 'Radio Mayor (r1)', 0.75, 0.05, 5, 0.05),
      P('r2', 'Radio Tubo (r2)', 0.25, 0.02, 3, 0.02)
    ],
    args: ['le', 'r1', 'r2'],
    glsl: `float sdLink( vec3 p, float le, float r1, float r2 )
{
  vec3 q = vec3( p.x, max(abs(p.y)-le,0.0), p.z );
  return length(vec2(length(q.xy)-r1,q.z)) - r2;
}`
  });

  registerPrimitive({
    key: 'horseshoe',
    name: 'Horseshoe (Herradura 3D)',
    category: 'torus_spheres',
    iqName: 'Horseshoe - exact',
    params: [
      P('angle', 'Ángulo Arco (rad)', 1.3, 0.1, 3, 0.05),
      P('r', 'Radio Arco (r)', 1, 0.1, 5, 0.05),
      P('le', 'Largo Brazos (le)', 0.7, 0, 5, 0.05),
      P('wx', 'Grosor X (w.x)', 0.22, 0.02, 2, 0.02),
      P('wy', 'Grosor Y (w.y)', 0.22, 0.02, 2, 0.02)
    ],
    args: [Arg.cosSin('angle'), 'r', 'le', Arg.vec2('w')],
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
}`
  });

  registerPrimitive({
    key: 'revolvedStar',
    name: 'Revolved Profile (opRevolution 2D→3D)',
    category: 'torus_spheres',
    iqName: 'opRevolution (2D Cross Revolved)',
    params: [
      P('o', 'Radio Revolución (o)', 1, 0, 5, 0.05),
      P('size', 'Tamaño Perfil', 0.55, 0.05, 3, 0.05),
      P('thick', 'Grosor Perfil', 0.18, 0.02, 2, 0.02)
    ],
    args: ['o', 'size', 'thick'],
    glsl: `float sdRevolvedCross( vec3 p, float o, float size, float thick )
{
  vec2 q = vec2( length(p.xz) - o, p.y );
  vec2 q1 = abs(q) - vec2(size, thick);
  vec2 q2 = abs(q) - vec2(thick, size);
  float d1 = length(max(q1,0.0)) + min(max(q1.x,q1.y),0.0);
  float d2 = length(max(q2,0.0)) + min(max(q2.x,q2.y),0.0);
  return min(d1, d2);
}`
  });

  registerPrimitive({
    key: 'solidAngle',
    name: 'Solid Angle (Sector Cónico Esférico)',
    category: 'torus_spheres',
    iqName: 'Solid Angle - exact',
    params: [
      P('angle', 'Ángulo (rad)', 0.65, 0.05, 1.55, 0.05),
      P('ra', 'Radio Esfera (ra)', 1.3, 0.1, 10, 0.05)
    ],
    args: [Arg.sinCos('angle'), 'ra'],
    glsl: `float sdSolidAngle(vec3 p, vec2 c, float ra)
{
  vec2 q = vec2( length(p.xz), p.y );
  float l = length(q) - ra;
  float m = length(q - c*clamp(dot(q,c),0.0,ra) );
  return max(l,m*sign(c.y*q.x-c.x*q.y));
}`
  });

  registerPrimitive({
    key: 'cutSphere',
    name: 'Cut Sphere (Esfera Cortada)',
    category: 'torus_spheres',
    iqName: 'Cut Sphere - exact',
    params: [
      P('r', 'Radio (r)', 1.2, 0.1, 10, 0.05),
      P('h', 'Altura Corte (h)', 0.3, -5, 5, 0.05)
    ],
    args: ['r', 'h'],
    glsl: `float sdCutSphere( vec3 p, float r, float h )
{
  float w = sqrt(max(r*r-h*h, 0.0));
  vec2 q = vec2( length(p.xz), p.y );
  float s = max( (h-r)*q.x*q.x+w*w*(h+r-2.0*q.y), h*q.x-w*q.y );
  return (s<0.0) ? length(q)-r :
         (q.x<w) ? h - q.y     :
                   length(q-vec2(w,h));
}`
  });

  registerPrimitive({
    key: 'cutHollowSphere',
    name: 'Cut Hollow Sphere (Cuenco Esférico Hueco)',
    category: 'torus_spheres',
    iqName: 'Cut Hollow Sphere - exact',
    params: [
      P('r', 'Radio (r)', 1.2, 0.1, 10, 0.05),
      P('h', 'Altura Corte (h)', 0.2, -5, 5, 0.05),
      P('t', 'Espesor Pared (t)', 0.12, 0.01, 2, 0.01)
    ],
    args: ['r', 'h', 't'],
    glsl: `float sdCutHollowSphere( vec3 p, float r, float h, float t )
{
  float w = sqrt(max(r*r-h*h, 0.0));
  vec2 q = vec2( length(p.xz), p.y );
  return ((h*q.x<w*q.y) ? length(q-vec2(w,h)) : 
                          abs(length(q)-r) ) - t;
}`
  });

  registerPrimitive({
    key: 'deathStar',
    name: 'Death Star (Estrella de la Muerte)',
    category: 'torus_spheres',
    iqName: 'Death Star - exact',
    params: [
      P('ra', 'Radio Principal (ra)', 1.2, 0.1, 10, 0.05),
      P('rb', 'Radio Cavidad (rb)', 0.85, 0.05, 10, 0.05),
      P('d', 'Distancia Corte (d)', 1.4, 0.05, 10, 0.05)
    ],
    args: ['ra', 'rb', 'd'],
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
}`
  });

  registerPrimitive({
    key: 'vesicaSegment',
    name: 'Revolved Vesica (Vésica Revolucionada)',
    category: 'torus_spheres',
    iqName: 'Revolved Vesica - exact',
    params: [
      P('ax', 'Punto A.x', 0, -5, 5, 0.05),
      P('ay', 'Punto A.y', -1, -5, 5, 0.05),
      P('az', 'Punto A.z', 0, -5, 5, 0.05),
      P('bx', 'Punto B.x', 0, -5, 5, 0.05),
      P('by', 'Punto B.y', 1, -5, 5, 0.05),
      P('bz', 'Punto B.z', 0, -5, 5, 0.05),
      P('w', 'Ancho (w)', 0.65, 0.05, 5, 0.05)
    ],
    args: [Arg.vec3('a'), Arg.vec3('b'), 'w'],
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
}`
  });
})();
