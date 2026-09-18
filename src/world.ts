import { V3 } from './math.js';
export type RGB = [number, number, number];

/** Box in an orthonormal frame; translation may be animated deterministically. */
export class Box {
  position: V3;
  previous: V3;
  velocity = new V3();
  axes: V3[];
  constructor(
    public id: string, public origin: V3, public half: V3,
    public color: RGB = [0.27, 0.34, 0.37], public sticky = true,
    tilt = 0, public motion = 0,
  ) {
    this.position = origin.clone(); this.previous = origin.clone();
    this.axes = [new V3(1,0,0), new V3(0,Math.cos(tilt),Math.sin(tilt)), new V3(0,-Math.sin(tilt),Math.cos(tilt))];
  }
  update(time: number, dt: number): void {
    this.previous.copy(this.position);
    this.position.copy(this.origin);
    if (this.motion) this.position.x += Math.sin(time * 0.8) * this.motion;
    this.velocity.copy(this.position).sub(this.previous).scale(1/dt);
  }
  local(p: V3, out = new V3()): V3 {
    const x=p.x-this.position.x, y=p.y-this.position.y, z=p.z-this.position.z;
    return out.set(x*this.axes[0].x+y*this.axes[0].y+z*this.axes[0].z, x*this.axes[1].x+y*this.axes[1].y+z*this.axes[1].z, x*this.axes[2].x+y*this.axes[2].y+z*this.axes[2].z);
  }
  world(p: V3, out = new V3()): V3 { return out.copy(this.position).addScaled(this.axes[0],p.x).addScaled(this.axes[1],p.y).addScaled(this.axes[2],p.z); }
}
export interface Station { name: string; subtitle: string; hint: string; spawn: V3; goal: V3; goalRadius: number; }
export class World {
  time = 0;
  boxes: Box[] = [];
  stations: Station[] = [];
  constructor(laboratory = true) { if (laboratory) this.makeLaboratory(); }
  add(id: string, position: V3, half: V3, color?: RGB, sticky = true, tilt = 0, motion = 0): Box {
    const box = new Box(id,position,half,color,sticky,tilt,motion); this.boxes.push(box); return box;
  }
  step(dt: number): void { this.time += dt; for (const box of this.boxes) box.update(this.time,dt); }
  reset(): void { this.time=0; for (const box of this.boxes) { box.position.copy(box.origin); box.previous.copy(box.origin); box.velocity.set(0,0,0); } }
  private makeLaboratory(): void {
    const stone: RGB = [0.28,0.34,0.38], grip: RGB = [0.30,0.28,0.48], slick: RGB = [0.47,0.33,0.17];
    this.add('floor',new V3(0,-0.6,0),new V3(36,0.6,24),[0.12,0.17,0.19]);
    this.add('backstop',new V3(0,1,-22),new V3(36,1,0.5));
    // Separate, freely accessible stations; keys 1–5 also teleport/reset.
    this.stations = [
      {name:'Find your feet',subtitle:'01 / TRACTION & INERTIA',hint:'Move, reverse, then let go. Watch the front lead and the rest of the body catch up.',spawn:new V3(-19,1.4,6),goal:new V3(-19,1.0,-3),goalRadius:1.4},
      {name:'Load. Release.',subtitle:'02 / COMPRESSION & JUMP',hint:'Hold Space to flatten. Release to launch. Reach the top step; a quick tap makes a smaller hop.',spawn:new V3(-8,1.4,6),goal:new V3(-8,3.9,-4),goalRadius:1.5},
      {name:'Get a grip',subtitle:'03 / ADHESION & CLIMB',hint:'Approach the violet wall while holding Shift. W climbs, S descends. Release Shift to let go; Space jumps away.',spawn:new V3(4,1.4,4),goal:new V3(4,5.3,-4.4),goalRadius:1.9},
      {name:'Less height. Same slime.',subtitle:'04 / SQUEEZE & RECOVER',hint:'Hold Q before the low passage, then move through. Your body spreads out; its volume is not switched off.',spawn:new V3(16,1.4,5),goal:new V3(16,1,-5),goalRadius:1.4},
      {name:'Keep the momentum',subtitle:'05 / SLOPE & MOVING SURFACE',hint:'Roll down the amber ramp. Q reduces traction. Find the moving violet platform and hold Shift to ride it.',spawn:new V3(-18,4.4,-14),goal:new V3(-8,1.55,-10),goalRadius:1.6},
    ];
    this.add('low-bump',new V3(-21,0.18,-0.8),new V3(1.8,0.18,0.6),stone);
    this.add('step-one',new V3(-8,0.4,1),new V3(2,0.4,1.3),stone);
    this.add('step-two',new V3(-8,1,-1.5),new V3(2,1,1),stone);
    this.add('step-three',new V3(-8,1.55,-4),new V3(2,1.55,1.3),stone);
    this.add('grip-wall',new V3(4,2.5,-5.5),new V3(3,2.5,0.45),grip);
    this.add('grip-canopy',new V3(4,5.1,-4.4),new V3(3,0.18,1.5),grip);
    // Passage is 1.05 m high, versus roughly 1.8 m for the relaxed body.
    this.add('tunnel-roof',new V3(16,1.38,-0.5),new V3(2.7,0.33,2.6),stone);
    this.add('tunnel-left',new V3(13.1,0.8,-0.5),new V3(0.2,0.8,2.6),stone);
    this.add('tunnel-right',new V3(18.9,0.8,-0.5),new V3(0.2,0.8,2.6),stone);
    this.add('ramp',new V3(-18,1.55,-10),new V3(2.5,0.3,5.4),slick,false,-0.28);
    this.add('ramp-start',new V3(-18,1.9,-15.2),new V3(2.5,1.9,0.9),stone);
    this.add('moving-platform',new V3(-8,0.45,-10),new V3(1.8,0.25,1.6),grip,true,0,2.4);
    this.add('ceiling-practice',new V3(5,2.9,-13),new V3(3,0.2,2),grip);
  }
}
