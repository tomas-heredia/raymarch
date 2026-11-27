// ============================================================================
// IQ-SDF SUPREME ENGINE — Primitivas: Poliedros, Prismas y Superficies
// Referencia: https://iquilezles.org/articles/distfunctions/
// Para agregar una primitiva: ver la receta en CLAUDE.md (sección Primitives).
// ============================================================================

(function () {
  const { registerPrimitive, P, Arg, Post } = window.SDFLibrary;

  registerPrimitive({
    key: 'extrudedCross',
    name: 'Extruded Cross (opExtrussion 2D→3D)',
    category: 'polyhedra',
    iqName: 'opExtrussion (2D Cross Extruded)',
    params: [
      P('size', 'Largo Brazo (b.x)', 1.1, 0.1, 5, 0.05),
      P('thick', 'Ancho Brazo (b.y)', 0.35, 0.05, 3, 0.05),
      P('h', 'Extrusión Z (h)', 0.45, 0.02, 5, 0.05)
    ],
    args: ['size', 'thick', 'h'],
    glsl: `float sdExtrudedCross( vec3 p, float size, float thick, float h )
{
  vec2 q1 = abs(p.xy) - vec2(size, thick);
  vec2 q2 = abs(p.xy) - vec2(thick, size);
  float d1 = length(max(q1,0.0)) + min(max(q1.x,q1.y),0.0);
  float d2 = length(max(q2,0.0)) + min(max(q2.x,q2.y),0.0);
  float d = min(d1, d2);
  vec2 w = vec2( d, abs(p.z) - h );
  return min(max(w.x,w.y),0.0) + length(max(w,0.0));
}`
  });

  registerPrimitive({
    key: 'plane',
    name: 'Plane (Plano Infinito)',
    category: 'polyhedra',
    iqName: 'Plane - exact',
    params: [
      P('nx', 'Normal X', 0, -1, 1, 0.05),
      P('ny', 'Normal Y', 1, -1, 1, 0.05),
      P('nz', 'Normal Z', 0, -1, 1, 0.05),
      P('h', 'Desplazamiento (h)', 1.5, -10, 10, 0.1)
    ],
    args: [Arg.vec3('n'), 'h'],
    glsl: `float sdPlane( vec3 p, vec3 n, float h )
{
  return dot(p,normalize(n)) + h;
}`
  });

  registerPrimitive({
    key: 'hexPrism',
    name: 'Hexagonal Prism (Prisma Hexagonal)',
    category: 'polyhedra',
    iqName: 'Hexagonal Prism - exact',
    params: [
      P('hx', 'Radio Hexágono (h.x)', 0.9, 0.05, 10, 0.05),
      P('hy', 'Profundidad Z (h.y)', 0.5, 0.05, 10, 0.05)
    ],
    args: [Arg.vec2('h')],
    glsl: `float sdHexPrism( vec3 p, vec2 h )
{
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  p = abs(p);
  p.xy -= 2.0*min(dot(k.xy, p.xy), 0.0)*k.xy;
  vec2 d = vec2(
       length(p.xy-vec2(clamp(p.x,-k.z*h.x,k.z*h.x), h.x))*sign(p.y-h.x),
       p.z-h.y );
  return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}`
  });

  registerPrimitive({
    key: 'triPrism',
    name: 'Triangular Prism (Prisma Triangular)',
    category: 'polyhedra',
    iqName: 'Triangular Prism - bound',
    params: [
      P('hx', 'Tamaño Triángulo (h.x)', 1, 0.05, 10, 0.05),
      P('hy', 'Profundidad Z (h.y)', 0.5, 0.05, 10, 0.05)
    ],
    args: [Arg.vec2('h')],
    glsl: `float sdTriPrism( vec3 p, vec2 h )
{
  vec3 q = abs(p);
  return max(q.z-h.y,max(q.x*0.866025+p.y*0.5,-p.y)-h.x*0.5);
}`
  });

  registerPrimitive({
    key: 'rhombus',
    name: 'Rhombus (Rombo 3D)',
    category: 'polyhedra',
    iqName: 'Rhombus - exact',
    deps: ['ndot'],
    params: [
      P('la', 'Diagonal A (la)', 1.1, 0.05, 5, 0.05),
      P('lb', 'Diagonal B (lb)', 0.7, 0.05, 5, 0.05),
      P('h', 'Semi-Altura Y (h)', 0.25, 0.02, 5, 0.02),
      P('ra', 'Redondeo (ra)', 0.08, 0, 2, 0.02)
    ],
    args: ['la', 'lb', 'h', 'ra'],
    glsl: `float sdRhombus(vec3 p, float la, float lb, float h, float ra)
{
  p = abs(p);
  vec2 b = vec2(la,lb);
  float f = clamp( (ndot(b,b-2.0*p.xz))/dot(b,b), -1.0, 1.0 );
  vec2 q = vec2(length(p.xz-0.5*b*vec2(1.0-f,1.0+f))*sign(p.x*b.y+p.z*b.x-b.x*b.y)-ra, p.y-h);
  return min(max(q.x,q.y),0.0) + length(max(q,0.0));
}`
  });

  registerPrimitive({
    key: 'octahedron',
    name: 'Octahedron (Octaedro Exacto)',
    category: 'polyhedra',
    iqName: 'Octahedron - exact',
    params: [
      P('s', 'Tamaño (s)', 1.3, 0.05, 10, 0.05)
    ],
    args: ['s'],
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
}`
  });

  registerPrimitive({
    key: 'octahedronBound',
    name: 'Octahedron Bound (Octaedro Rápido)',
    category: 'polyhedra',
    iqName: 'Octahedron - bound (not exact)',
    params: [
      P('s', 'Tamaño (s)', 1.3, 0.05, 10, 0.05)
    ],
    args: ['s'],
    glsl: `float sdOctahedronBound( vec3 p, float s)
{
  p = abs(p);
  return (p.x+p.y+p.z-s)*0.57735027;
}`
  });

  registerPrimitive({
    key: 'pyramid',
    name: 'Pyramid (Pirámide Exacta)',
    category: 'polyhedra',
    iqName: 'Pyramid - exact',
    params: [
      P('h', 'Altura (h)', 1.3, 0.1, 10, 0.05)
    ],
    args: ['h'],
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
}`
  });

  registerPrimitive({
    key: 'triangle',
    name: 'Triangle 3D (Triángulo Exacto)',
    category: 'polyhedra',
    iqName: 'Triangle - exact',
    deps: ['dot2_vec3'],
    params: [
      P('ax', 'Vértice A.x', -1, -5, 5, 0.05),
      P('ay', 'Vértice A.y', -0.7, -5, 5, 0.05),
      P('az', 'Vértice A.z', 0, -5, 5, 0.05),
      P('bx', 'Vértice B.x', 1, -5, 5, 0.05),
      P('by', 'Vértice B.y', -0.7, -5, 5, 0.05),
      P('bz', 'Vértice B.z', 0, -5, 5, 0.05),
      P('cx', 'Vértice C.x', 0, -5, 5, 0.05),
      P('cy', 'Vértice C.y', 1, -5, 5, 0.05),
      P('cz', 'Vértice C.z', 0, -5, 5, 0.05),
      P('th', 'Grosor Superficie', 0.06, 0.01, 1, 0.01)
    ],
    args: [Arg.vec3('a'), Arg.vec3('b'), Arg.vec3('c')],
    post: Post.thickness('th'),
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
}`
  });

  registerPrimitive({
    key: 'quad',
    name: 'Quad 3D (Cuadrilátero Exacto)',
    category: 'polyhedra',
    iqName: 'Quad - exact',
    deps: ['dot2_vec3'],
    params: [
      P('ax', 'Vértice A.x', -1, -5, 5, 0.05),
      P('ay', 'Vértice A.y', -1, -5, 5, 0.05),
      P('az', 'Vértice A.z', 0, -5, 5, 0.05),
      P('bx', 'Vértice B.x', 1, -5, 5, 0.05),
      P('by', 'Vértice B.y', -1, -5, 5, 0.05),
      P('bz', 'Vértice B.z', 0, -5, 5, 0.05),
      P('cx', 'Vértice C.x', 1, -5, 5, 0.05),
      P('cy', 'Vértice C.y', 1, -5, 5, 0.05),
      P('cz', 'Vértice C.z', 0, -5, 5, 0.05),
      P('dx', 'Vértice D.x', -1, -5, 5, 0.05),
      P('dy', 'Vértice D.y', 1, -5, 5, 0.05),
      P('dz', 'Vértice D.z', 0, -5, 5, 0.05),
      P('th', 'Grosor Superficie', 0.06, 0.01, 1, 0.01)
    ],
    args: [Arg.vec3('a'), Arg.vec3('b'), Arg.vec3('c'), Arg.vec3('d')],
    post: Post.thickness('th'),
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
}`
  });
})();
