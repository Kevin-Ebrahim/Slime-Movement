/** Small allocation-conscious math layer. Physics does not depend on a renderer. */
export class V3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: V3): this { return this.set(v.x, v.y, v.z); }
  clone(): V3 { return new V3(this.x, this.y, this.z); }
  add(v: V3): this { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v: V3): this { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  scale(s: number): this { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaled(v: V3, s: number): this { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  dot(v: V3): number { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v: V3): this { return this.set(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x); }
  lengthSq(): number { return this.dot(this); }
  length(): number { return Math.sqrt(this.lengthSq()); }
  normalize(): this { const n = this.length(); return n > 1e-10 ? this.scale(1 / n) : this.set(0, 0, 0); }
  distance(v: V3): number { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  lerp(v: V3, t: number): this { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  finite(): boolean { return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z); }
  array(): number[] { return [this.x, this.y, this.z]; }
}
export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
export const UP = new V3(0, 1, 0);

/** Outward-wound, indexed 42-particle / 80-triangle geodesic surface. */
export function makeCage(radius: number): { vertices: V3[]; faces: number[][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(v => new V3(...v).normalize().scale(radius));
  const base = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  const midpoints = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = `${Math.min(a,b)}:${Math.max(a,b)}`;
    const old = midpoints.get(key); if (old !== undefined) return old;
    const id = vertices.length;
    vertices.push(vertices[a].clone().add(vertices[b]).normalize().scale(radius));
    midpoints.set(key, id); return id;
  };
  const faces: number[][] = [];
  for (const [a,b,c] of base) {
    const ab = midpoint(a,b), bc = midpoint(b,c), ca = midpoint(c,a);
    faces.push([a,ab,ca], [b,bc,ab], [c,ca,bc], [ab,bc,ca]);
  }
  return { vertices, faces };
}

/** Column-major matrices, matching WebGL. */
export function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
}
export function lookAt(eye: V3, target: V3): Float32Array {
  const z = eye.clone().sub(target).normalize(), x = UP.clone().cross(z).normalize(), y = z.clone().cross(x);
  return new Float32Array([x.x,y.x,z.x,0, x.y,y.y,z.y,0, x.z,y.z,z.z,0, -x.dot(eye),-y.dot(eye),-z.dot(eye),1]);
}
export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const r = new Float32Array(16);
  for (let c=0;c<4;c++) for (let row=0;row<4;row++) for (let k=0;k<4;k++) r[c*4+row] += a[k*4+row]*b[c*4+k];
  return r;
}
