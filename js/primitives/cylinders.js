// ============================================================================
// IQ-SDF SUPREME ENGINE — Primitivas: Cilindros, Cápsulas y Conos
// Referencia: https://iquilezles.org/articles/distfunctions/
// Para agregar una primitiva: ver la receta en CLAUDE.md (sección Primitives).
// ============================================================================

(function () {
  const { registerPrimitive, P, Arg, Post } = window.SDFLibrary;

  registerPrimitive({
    key: 'infiniteCylinder',
    name: 'Infinite Cylinder (Cilindro Infinito)',
    category: 'cylinders',
    iqName: 'Infinite Cylinder - exact',
    params: [
      P('cx', 'Centro X (c.x)', 0, -5, 5, 0.05),
      P('cy', 'Centro Z (c.y)', 0, -5, 5, 0.05),
      P('cz', 'Radio (c.z)', 0.6, 0.05, 5, 0.05)
    ],
    args: [Arg.vec3('c')],
    glsl: `float sdCylinder( vec3 p, vec3 c )
{
  return length(p.xz-c.xy)-c.z;
}`
  });

  registerPrimitive({
    key: 'cone',
    name: 'Cone (Cono Exacto)',
    category: 'cylinders',
    iqName: 'Cone - exact',
    params: [
      P('angle', 'Ángulo Cono (rad)', 0.55, 0.05, 1.5, 0.02),
      P('h', 'Altura (h)', 1.5, 0.1, 10, 0.05)
    ],
    args: [Arg.sinCos('angle'), 'h'],
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
}`
  });

  registerPrimitive({
    key: 'coneBound',
    name: 'Cone Bound (Cono Rápido)',
    category: 'cylinders',
    iqName: 'Cone - bound (not exact!)',
    params: [
      P('angle', 'Ángulo Cono (rad)', 0.55, 0.05, 1.5, 0.02),
      P('h', 'Altura (h)', 1.5, 0.1, 10, 0.05)
    ],
    args: [Arg.sinCos('angle'), 'h'],
    glsl: `float sdConeBound( vec3 p, vec2 c, float h )
{
  float q = length(p.xz);
  return max(dot(c.xy,vec2(q,p.y)),-h-p.y);
}`
  });

  registerPrimitive({
    key: 'infiniteCone',
    name: 'Infinite Cone (Cono Infinito)',
    category: 'cylinders',
    iqName: 'Infinite Cone - exact',
    params: [
      P('angle', 'Ángulo Cono (rad)', 0.5, 0.05, 1.5, 0.02)
    ],
    args: [Arg.sinCos('angle')],
    glsl: `float sdInfiniteCone( vec3 p, vec2 c )
{
  vec2 q = vec2( length(p.xz), -p.y );
  float d = length(q-c*max(dot(q,c), 0.0));
  return d * ((q.x*c.y-q.y*c.x<0.0)?-1.0:1.0);
}`
  });

  registerPrimitive({
    key: 'capsule',
    name: 'Capsule / Line (Cápsula entre 2 Puntos)',
    category: 'cylinders',
    iqName: 'Capsule / Line - exact',
    params: [
      P('ax', 'Punto A.x', -0.8, -5, 5, 0.05),
      P('ay', 'Punto A.y', -0.6, -5, 5, 0.05),
      P('az', 'Punto A.z', 0, -5, 5, 0.05),
      P('bx', 'Punto B.x', 0.8, -5, 5, 0.05),
      P('by', 'Punto B.y', 0.6, -5, 5, 0.05),
      P('bz', 'Punto B.z', 0, -5, 5, 0.05),
      P('r', 'Radio (r)', 0.4, 0.02, 5, 0.02)
    ],
    args: [Arg.vec3('a'), Arg.vec3('b'), 'r'],
    glsl: `float sdCapsule( vec3 p, vec3 a, vec3 b, float r )
{
  vec3 pa = p - a, ba = b - a;
  float h = clamp( dot(pa,ba)/dot(ba,ba), 0.0, 1.0 );
  return length( pa - ba*h ) - r;
}`
  });

  registerPrimitive({
    key: 'verticalCapsule',
    name: 'Vertical Capsule (Cápsula Vertical)',
    category: 'cylinders',
    iqName: 'Vertical Capsule - exact',
    params: [
      P('h', 'Altura (h)', 1.2, 0, 10, 0.05),
      P('r', 'Radio (r)', 0.5, 0.02, 5, 0.02)
    ],
    args: ['h', 'r'],
    glsl: `float sdVerticalCapsule( vec3 p, float h, float r )
{
  p.y -= clamp( p.y, 0.0, h );
  return length( p ) - r;
}`
  });

  registerPrimitive({
    key: 'cappedCylinder',
    name: 'Capped Cylinder (Cilindro Vertical)',
    category: 'cylinders',
    iqName: 'Vertical Cylinder - exact',
    params: [
      P('h', 'Semi-Altura (h)', 1, 0.05, 10, 0.05),
      P('r', 'Radio (r)', 0.6, 0.05, 10, 0.05)
    ],
    args: ['h', 'r'],
    glsl: `float sdCappedCylinder( vec3 p, float h, float r )
{
  vec2 d = abs(vec2(length(p.xz),p.y)) - vec2(r,h);
  return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}`
  });

  registerPrimitive({
    key: 'arbitraryCappedCylinder',
    name: 'Arbitrary Capped Cylinder (Cilindro A-B)',
    category: 'cylinders',
    iqName: 'Arbitrary Capped Cylinder - exact',
    params: [
      P('ax', 'Punto A.x', -0.7, -5, 5, 0.05),
      P('ay', 'Punto A.y', -0.7, -5, 5, 0.05),
      P('az', 'Punto A.z', 0, -5, 5, 0.05),
      P('bx', 'Punto B.x', 0.7, -5, 5, 0.05),
      P('by', 'Punto B.y', 0.7, -5, 5, 0.05),
      P('bz', 'Punto B.z', 0, -5, 5, 0.05),
      P('r', 'Radio (r)', 0.5, 0.05, 5, 0.05)
    ],
    args: [Arg.vec3('a'), Arg.vec3('b'), 'r'],
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
}`
  });

  registerPrimitive({
    key: 'roundedCylinder',
    name: 'Rounded Cylinder (Cilindro Redondeado)',
    category: 'cylinders',
    iqName: 'Rounded Cylinder - exact',
    params: [
      P('ra', 'Radio (ra)', 0.5, 0.05, 5, 0.05),
      P('rb', 'Bisel (rb)', 0.15, 0, 2, 0.02),
      P('h', 'Semi-Altura (h)', 0.8, 0.05, 5, 0.05)
    ],
    args: ['ra', 'rb', 'h'],
    glsl: `float sdRoundedCylinder( vec3 p, float ra, float rb, float h )
{
  vec2 d = vec2( length(p.xz)-2.0*ra+rb, abs(p.y) - h );
  return min(max(d.x,d.y),0.0) + length(max(d,0.0)) - rb;
}`
  });

  registerPrimitive({
    key: 'cappedCone',
    name: 'Capped Cone (Cono Truncado Vertical)',
    category: 'cylinders',
    iqName: 'Capped Cone - exact',
    deps: ['dot2_vec2'],
    params: [
      P('h', 'Semi-Altura (h)', 0.9, 0.05, 5, 0.05),
      P('r1', 'Radio Base (r1)', 0.9, 0.02, 5, 0.05),
      P('r2', 'Radio Tope (r2)', 0.35, 0.02, 5, 0.05)
    ],
    args: ['h', 'r1', 'r2'],
    glsl: `float sdCappedCone( vec3 p, float h, float r1, float r2 )
{
  vec2 q = vec2( length(p.xz), p.y );
  vec2 k1 = vec2(r2,h);
  vec2 k2 = vec2(r2-r1,2.0*h);
  vec2 ca = vec2(q.x-min(q.x,(q.y<0.0)?r1:r2), abs(q.y)-h);
  vec2 cb = q - k1 + k2*clamp( dot(k1-q,k2)/dot2(k2), 0.0, 1.0 );
  float s = (cb.x<0.0 && ca.y<0.0) ? -1.0 : 1.0;
  return s*sqrt( min(dot2(ca),dot2(cb)) );
}`
  });

  registerPrimitive({
    key: 'arbitraryCappedCone',
    name: 'Arbitrary Capped Cone (Cono Truncado A-B)',
    category: 'cylinders',
    iqName: 'Capped Cone (Segment) - exact',
    deps: ['dot2_vec3'],
    params: [
      P('ax', 'Punto A.x', -0.6, -5, 5, 0.05),
      P('ay', 'Punto A.y', -0.8, -5, 5, 0.05),
      P('az', 'Punto A.z', 0, -5, 5, 0.05),
      P('bx', 'Punto B.x', 0.6, -5, 5, 0.05),
      P('by', 'Punto B.y', 0.8, -5, 5, 0.05),
      P('bz', 'Punto B.z', 0, -5, 5, 0.05),
      P('ra', 'Radio A (ra)', 0.7, 0.02, 5, 0.05),
      P('rb', 'Radio B (rb)', 0.25, 0.02, 5, 0.05)
    ],
    args: [Arg.vec3('a'), Arg.vec3('b'), 'ra', 'rb'],
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
}`
  });

  registerPrimitive({
    key: 'roundCone',
    name: 'Round Cone (Cono Redondeado Vertical)',
    category: 'cylinders',
    iqName: 'Round Cone - exact',
    deps: ['dot2_vec2'],
    params: [
      P('r1', 'Radio Inferior (r1)', 0.7, 0.02, 5, 0.05),
      P('r2', 'Radio Superior (r2)', 0.25, 0.02, 5, 0.05),
      P('h', 'Altura (h)', 1.2, 0.05, 10, 0.05)
    ],
    args: ['r1', 'r2', 'h'],
    glsl: `float sdRoundCone( vec3 p, float r1, float r2, float h )
{
  vec2 q = vec2( length(p.xz), p.y );
  float b = (r1-r2)/h;
  float a = sqrt(max(1.0-b*b, 0.0001));
  float k = dot(q,vec2(-b,a));
  if( k < 0.0 ) return length(q) - r1;
  if( k > a*h ) return length(q-vec2(0.0,h)) - r2;
  return dot(q, vec2(a,b) ) - r1;
}`
  });

  registerPrimitive({
    key: 'arbitraryRoundCone',
    name: 'Arbitrary Round Cone (Cono Redondeado A-B)',
    category: 'cylinders',
    iqName: 'Round Cone (Segment) - exact',
    deps: ['dot2_vec3'],
    params: [
      P('ax', 'Punto A.x', -0.6, -5, 5, 0.05),
      P('ay', 'Punto A.y', -0.6, -5, 5, 0.05),
      P('az', 'Punto A.z', 0, -5, 5, 0.05),
      P('bx', 'Punto B.x', 0.6, -5, 5, 0.05),
      P('by', 'Punto B.y', 0.6, -5, 5, 0.05),
      P('bz', 'Punto B.z', 0, -5, 5, 0.05),
      P('r1', 'Radio A (r1)', 0.6, 0.02, 5, 0.05),
      P('r2', 'Radio B (r2)', 0.2, 0.02, 5, 0.05)
    ],
    args: [Arg.vec3('a'), Arg.vec3('b'), 'r1', 'r2'],
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
}`
  });
})();
