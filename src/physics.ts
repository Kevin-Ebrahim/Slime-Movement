import { clamp, makeCage, UP, V3 } from './math.js';
import { Box, World } from './world.js';

export const FIXED_DT = 1 / 60;
const SUBSTEPS = 4, ITERATIONS = 8, SKIN = 0.065, RADIUS = 0.84;
export interface Input { x: number; z: number; climb: number; strafe: number; jump: boolean; grip: boolean; relax: boolean; }
export const idleInput = (): Input => ({x:0,z:0,climb:0,strafe:0,jump:false,grip:false,relax:false});
interface Particle { p: V3; old: V3; renderOld: V3; v: V3; cooldown: number; }
interface Link { a: number; b: number; rest: number; target: number; bend: boolean; lambda: number; }
interface Contact { node: number; box: Box; normal: V3; }
interface Anchor { node: number; box: Box; local: V3; normal: V3; age: number; }
export interface Settings { stiffness: number; traction: number; airControl: number; }

/**
 * Authoritative 3D soft body: surface particles, XPBD distance/volume constraints,
 * swept particle/box collisions, breakable material-point attachments.
 * There is no rigid capsule, prescribed center translation, or visual squash.
 * The deliberately game-like assists are isolated in drive() and jump release.
 */
export class Slime {
  particles: Particle[];
  faces: number[][];
  links: Link[] = [];
  anchors: Anchor[] = [];
  contacts: Contact[] = [];
  center = new V3();
  velocity = new V3();
  support = UP.clone();
  restVolume: number;
  charge = 0;
  flatten = 1;
  time = 0;
  recoveries = 0;
  settings: Settings = {stiffness:1,traction:1,airControl:1};
  private rest: V3[];
  private gradients: V3[];
  private volumeLambda = 0;
  private held = false;
  private grace = 0;
  private releaseCooldown = 0;
  private spawn = new V3();
  private chargeNormal = UP.clone();
  private scratch = new V3();
  private q = new V3();
  private prevLocal = new V3();
  private normal = new V3();

  constructor(spawn = new V3(0,1.5,0)) {
    const cage = makeCage(RADIUS); this.rest=cage.vertices; this.faces=cage.faces;
    this.particles=this.rest.map(p=>({p:p.clone(),old:p.clone(),renderOld:p.clone(),v:new V3(),cooldown:0}));
    this.gradients=this.rest.map(()=>new V3());
    const edgeMap=new Map<string,{a:number;b:number;opposites:number[]}>();
    for(const face of this.faces) for(let j=0;j<3;j++) {
      const a=face[j],b=face[(j+1)%3],c=face[(j+2)%3], key=`${Math.min(a,b)}:${Math.max(a,b)}`;
      const e=edgeMap.get(key); if(e)e.opposites.push(c);else edgeMap.set(key,{a,b,opposites:[c]});
    }
    const known=new Set<string>();
    const link=(a:number,b:number,bend:boolean):void=>{
      const key=`${Math.min(a,b)}:${Math.max(a,b)}`; if(known.has(key))return; known.add(key);
      const rest=this.rest[a].distance(this.rest[b]);this.links.push({a,b,rest,target:rest,bend,lambda:0});
    };
    for(const e of edgeMap.values()) {link(e.a,e.b,false);if(e.opposites.length===2)link(e.opposites[0],e.opposites[1],true);}
    // Sparse diametric braces prevent catastrophic shell folding without a rigid core.
    for(let i=0;i<this.rest.length;i++) for(let j=i+1;j<this.rest.length;j++) if(this.rest[i].dot(this.rest[j])<-RADIUS*RADIUS*0.999)link(i,j,true);
    this.restVolume=this.volume(); this.reset(spawn);
  }
  reset(spawn = this.spawn): void {
    this.spawn.copy(spawn); this.anchors=[]; this.contacts=[];
    this.charge=0;this.flatten=1;this.held=false;this.grace=0;this.releaseCooldown=0;this.time=0;
    this.support.copy(UP);this.chargeNormal.copy(UP);this.velocity.set(0,0,0);
    this.particles.forEach((n,i)=>{n.p.copy(this.rest[i]).add(spawn);n.old.copy(n.p);n.renderOld.copy(n.p);n.v.set(0,0,0);n.cooldown=0;});
    this.measure();
  }
  cancelInput(): void { this.held=false; this.charge=0; this.anchors=[]; }
  measure(): void {
    this.center.set(0,0,0);this.velocity.set(0,0,0);
    for(const n of this.particles){this.center.add(n.p);this.velocity.add(n.v);}
    this.center.scale(1/this.particles.length);this.velocity.scale(1/this.particles.length);
  }
  volume(): number {
    // Closed surface: tetrahedra about an arbitrary reference are translation invariant.
    const o=this.particles[0].p;let v=0;
    for(const [a,b,c] of this.faces){const p=this.particles[a].p,q=this.particles[b].p,r=this.particles[c].p;
      v+=((p.x-o.x)*((q.y-o.y)*(r.z-o.z)-(q.z-o.z)*(r.y-o.y))+(p.y-o.y)*((q.z-o.z)*(r.x-o.x)-(q.x-o.x)*(r.z-o.z))+(p.z-o.z)*((q.x-o.x)*(r.y-o.y)-(q.y-o.y)*(r.x-o.x)))/6;
    } return v;
  }
  bounds(): {min: V3; max: V3; height: number; width: number} {
    const min=new V3(Infinity,Infinity,Infinity),max=new V3(-Infinity,-Infinity,-Infinity);
    for(const {p} of this.particles){min.x=Math.min(min.x,p.x);min.y=Math.min(min.y,p.y);min.z=Math.min(min.z,p.z);max.x=Math.max(max.x,p.x);max.y=Math.max(max.y,p.y);max.z=Math.max(max.z,p.z);}
    return {min,max,height:max.y-min.y,width:max.x-min.x};
  }
  get state(): string { return this.charge>0.04?'COMPRESSING':this.anchors.length?'ADHERED':this.flatten<0.7?'FLOWING':this.contacts.length?'GROUNDED':'AIRBORNE'; }

  step(world: World, input: Input, dt = FIXED_DT): void {
    if(!Number.isFinite(dt)||dt<=0||dt>FIXED_DT+1e-8)throw new RangeError('Use positive fixed steps no larger than 1/60 s.');
    for(const n of this.particles)n.renderOld.copy(n.p);
    this.time+=dt; this.measure(); this.chooseSupport(input);
    const supported=this.contacts.length>0||this.anchors.length>0;
    this.grace=supported?0.10:Math.max(0,this.grace-dt);
    this.releaseCooldown=Math.max(0,this.releaseCooldown-dt);
    if(input.jump&&this.grace>0&&this.releaseCooldown===0){this.charge=Math.min(1,this.charge+dt/0.72);this.chargeNormal.copy(this.support);}
    if(!input.jump&&this.held){
      if(this.grace>0&&this.charge>0&&this.releaseCooldown===0){
        const direction=this.chargeNormal.clone();if(direction.y<0.45)direction.addScaled(UP,0.75);direction.normalize();
        const impulse=5.2+5.8*this.charge;
        // Explicit jump assistance, not an assertion of energy-conserving elasticity.
        const cancelFall=Math.max(0,-this.velocity.dot(direction));
        for(const n of this.particles)n.v.addScaled(direction,impulse+cancelFall);
        this.anchors=[];this.contacts=[];this.releaseCooldown=0.20;this.grace=0;
      }
      this.charge=0;
    }
    if(!input.jump)this.charge=0;
    this.held=input.jump;
    const target=input.relax?0.43:1-this.charge*0.51;
    this.flatten+=(target-this.flatten)*(1-Math.exp(-12*dt));
    const h=dt/SUBSTEPS;
    for(let sub=0;sub<SUBSTEPS;sub++){
      world.step(h);this.measure();this.chooseSupport(input);
      const direction=this.drive(input,h);
      this.updateAnchors(input,direction,h);
      for(const n of this.particles){n.old.copy(n.p);n.cooldown=Math.max(0,n.cooldown-h);n.v.y-=18*h;n.v.scale(Math.exp(-0.18*h));n.p.addScaled(n.v,h);}
      for(const link of this.links){
        const a=this.particles[link.a].p,b=this.particles[link.b].p;
        const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z,len=Math.hypot(dx,dy,dz)||1;
        const vertical=(dx*this.chargeNormal.x+dy*this.chargeNormal.y+dz*this.chargeNormal.z)/len;
        const f=this.flatten;
        link.target=link.rest/Math.sqrt((1-vertical*vertical)*f+vertical*vertical/(f*f));link.lambda=0;
      }
      this.volumeLambda=0;
      // Sweep the predicted motion before constraint iterations to catch thin surfaces.
      this.collide(world,true,false);
      for(let iter=0;iter<ITERATIONS;iter++){
        this.solveLinks(h,input.relax);
        this.solveVolume(h);
        this.solveSelfCollision();
        for(const anchor of this.anchors){const p=this.particles[anchor.node].p;anchor.box.world(anchor.local,this.scratch);p.lerp(this.scratch,0.48);}
        this.collide(world,false,iter===ITERATIONS-1);
      }
      this.measure();
      for(const n of this.particles)n.v.copy(n.p).sub(n.old).scale(1/h);
      // Dampen internal vibration, not bulk momentum.
      this.measure();
      for(const n of this.particles)n.v.lerp(this.velocity,1-Math.exp(-2.4*h));
      for(const contact of this.contacts){
        const n=this.particles[contact.node],normal=contact.normal,sv=contact.box.velocity;
        this.scratch.copy(n.v).sub(sv);const vn=this.scratch.dot(normal);
        if(vn<0)n.v.addScaled(normal,-vn);
        this.scratch.copy(n.v).sub(sv).addScaled(normal,-n.v.clone().sub(sv).dot(normal));
        const speed=this.scratch.length(),mu=(input.relax?0.045:contact.box.sticky?0.72:0.12)*this.settings.traction;
        if(speed>0)n.v.addScaled(this.scratch,-Math.min(1,mu*(18*h+Math.max(0,-vn))/speed));
      }
      // A generous emergency speed cap bounds collision travel; ordinary movement is far below it.
      for(const n of this.particles){const speed=n.v.length();if(speed>45)n.v.scale(45/speed);}
      this.acquireAnchors(input);
    }
    this.measure();
    const ratio=this.volume()/this.restVolume;
    if(!this.center.finite()||!this.particles.every(n=>n.p.finite()&&n.v.finite())||ratio<0.12||ratio>3||this.center.y<-12||Math.abs(this.center.x)>70||Math.abs(this.center.z)>60){this.recoveries++;this.reset();}
  }
  private chooseSupport(input: Input): void {
    const normal=new V3();let wallCount=0;
    if(input.grip){
      for(const a of this.anchors)if(a.normal.y<0.5){normal.add(a.normal);wallCount++;}
      if(!wallCount)for(const c of this.contacts)if(c.box.sticky&&c.normal.y<0.5){normal.add(c.normal);wallCount++;}
    }
    if(!wallCount){for(const c of this.contacts)if(c.normal.y>0.35)normal.add(c.normal);for(const a of this.anchors)normal.add(a.normal);}
    if(normal.lengthSq()>0.01)this.support.copy(normal).normalize();else if(!this.anchors.length)this.support.copy(UP);
  }
  private drive(input: Input, h: number): V3 {
    const dir=new V3(input.x,0,input.z),attached=this.anchors.length>0,grounded=this.contacts.length>0;
    if(input.grip&&this.support.y<0.5&&this.support.y>-0.5&&(attached||grounded)){
      dir.copy(UP).cross(this.support).scale(input.strafe).addScaled(UP,input.climb);
    }else dir.addScaled(this.support,-dir.dot(this.support));
    const amount=Math.min(1,dir.length());dir.normalize();
    const surface=grounded||attached;
    const speed=input.relax?3.0:input.grip?3.4:6.2;
    const along=this.velocity.dot(dir);
    const motor=surface?clamp((speed*amount-along)*8,-32,42):2.2*this.settings.airControl*amount;
    for(const n of this.particles){
      if(amount>0){
        const height=this.scratch.copy(n.p).sub(this.center).dot(this.support)/RADIUS;
        // Free/leading material is pulled harder than the contact patch. Friction and
        // internal constraints turn that asymmetric force into crawl/roll and stretch.
        const weight=surface?clamp(1+height*0.9,0.15,1.9):1;
        n.v.addScaled(dir,motor*weight*h);
        if(!surface){const r=this.scratch.copy(n.p).sub(this.center);const axis=this.support.clone().cross(dir);n.v.addScaled(axis.cross(r),3.5*h);}
      }
    }
    return dir.scale(amount);
  }
  private updateAnchors(input: Input, direction: V3, h: number): void {
    if(!input.grip||this.releaseCooldown>0){this.anchors=[];return;}
    const moving=direction.lengthSq()>0.01;
    this.anchors=this.anchors.filter(a=>{
      a.age+=h;const n=this.particles[a.node];a.box.world(a.local,this.scratch);
      const behind=n.p.clone().sub(this.center).dot(direction)<-0.12;
      const release=n.p.distance(this.scratch)>0.70||(moving&&((a.age>0.16&&behind)||a.age>0.48));
      if(release)n.cooldown=0.09;return !release;
    });
  }
  private acquireAnchors(input: Input): void {
    if(!input.grip||this.releaseCooldown>0)return;
    for(const c of this.contacts){
      if(this.anchors.length>=8)break;
      const n=this.particles[c.node];
      if(!c.box.sticky||n.cooldown>0||this.anchors.some(a=>a.node===c.node))continue;
      this.anchors.push({node:c.node,box:c.box,local:c.box.local(n.p),normal:c.normal.clone(),age:0});
    }
  }
  private solveLinks(h: number, relax: boolean): void {
    for(const l of this.links){
      const a=this.particles[l.a].p,b=this.particles[l.b].p;
      const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z,len=Math.hypot(dx,dy,dz);if(len<1e-9)continue;
      const compliance=(l.bend?0.00020:0.000018)*(relax?2.5:1)/clamp(this.settings.stiffness,0.25,2.5);
      const alpha=compliance/(h*h),delta=(-(len-l.target)-alpha*l.lambda)/(2+alpha);l.lambda+=delta;
      const s=delta/len;a.x+=dx*s;a.y+=dy*s;a.z+=dz*s;b.x-=dx*s;b.y-=dy*s;b.z-=dz*s;
    }
  }
  private solveVolume(h: number): void {
    for(const g of this.gradients)g.set(0,0,0);
    const o=this.center;let volume=0;
    for(const [a,b,c] of this.faces){
      const pa=this.particles[a].p,pb=this.particles[b].p,pc=this.particles[c].p;
      const ax=pa.x-o.x,ay=pa.y-o.y,az=pa.z-o.z,bx=pb.x-o.x,by=pb.y-o.y,bz=pb.z-o.z,cx=pc.x-o.x,cy=pc.y-o.y,cz=pc.z-o.z;
      const x=by*cz-bz*cy,y=bz*cx-bx*cz,z=bx*cy-by*cx;volume+=(ax*x+ay*y+az*z)/6;
      this.gradients[a].x+=x/6;this.gradients[a].y+=y/6;this.gradients[a].z+=z/6;
      this.gradients[b].x+=(cy*az-cz*ay)/6;this.gradients[b].y+=(cz*ax-cx*az)/6;this.gradients[b].z+=(cx*ay-cy*ax)/6;
      this.gradients[c].x+=(ay*bz-az*by)/6;this.gradients[c].y+=(az*bx-ax*bz)/6;this.gradients[c].z+=(ax*by-ay*bx)/6;
    }
    let denom=0;for(const g of this.gradients)denom+=g.lengthSq();
    const alpha=0.0000005/(h*h),delta=(-(volume-this.restVolume)-alpha*this.volumeLambda)/(denom+alpha);this.volumeLambda+=delta;
    for(let i=0;i<this.particles.length;i++)this.particles[i].p.addScaled(this.gradients[i],delta);
  }
  private solveSelfCollision(): void {
    const min=0.105;
    for(let i=0;i<this.particles.length;i++)for(let j=i+1;j<this.particles.length;j++){
      const a=this.particles[i].p,b=this.particles[j].p,dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z,ds=dx*dx+dy*dy+dz*dz;
      if(ds<min*min&&ds>1e-12){const d=Math.sqrt(ds),s=(min-d)*0.5/d;a.x+=dx*s;a.y+=dy*s;a.z+=dz*s;b.x-=dx*s;b.y-=dy*s;b.z-=dz*s;}
    }
  }
  private collide(world: World, sweep: boolean, record: boolean): void {
    if(record)this.contacts=[];
    for(let i=0;i<this.particles.length;i++){
      const node=this.particles[i];
      for(const box of world.boxes){
        box.local(node.p,this.q);
        const half=[box.half.x+SKIN,box.half.y+SKIN,box.half.z+SKIN];
        let coords=[this.q.x,this.q.y,this.q.z],axis=-1,sign=1;
        if(sweep){
          // Relative motion includes platform translation. Slab sweep against a
          // skin-expanded box is conservative at edges/corners (intentional).
          this.scratch.copy(node.old).add(box.position).sub(box.previous);box.local(this.scratch,this.prevLocal);
          const start=[this.prevLocal.x,this.prevLocal.y,this.prevLocal.z];
          if(start.some((v,k)=>Math.abs(v)>half[k]+1e-7)){
            let enter=0,exit=1,entryAxis=-1,entrySign=1;
            for(let k=0;k<3;k++){
              const d=coords[k]-start[k];
              if(Math.abs(d)<1e-10){if(Math.abs(start[k])>half[k]){exit=-1;break;}continue;}
              let near=(-half[k]-start[k])/d,far=(half[k]-start[k])/d;let ns=-1;
              if(near>far){[near,far]=[far,near];ns=1;}
              if(near>enter){enter=near;entryAxis=k;entrySign=ns;}exit=Math.min(exit,far);
            }
            if(enter<=exit&&enter>=0&&enter<=1&&entryAxis>=0){axis=entryAxis;sign=entrySign;coords[axis]=sign*half[axis];this.q.set(...coords as [number,number,number]);box.world(this.q,node.p);}
          }
        }
        if(coords.every((v,k)=>Math.abs(v)<=half[k]+1e-6)){
          let depth=Infinity;
          for(let k=0;k<3;k++){const d=half[k]-Math.abs(coords[k]);if(d<depth){depth=d;axis=k;sign=coords[k]>=0?1:-1;}}
          coords[axis]=sign*half[axis];this.q.set(...coords as [number,number,number]);box.world(this.q,node.p);
        }else if(record){
          // Small contact slop makes support stable after elastic constraints.
          const candidates=coords.map((v,k)=>Math.abs(Math.abs(v)-half[k]));
          const k=candidates.indexOf(Math.min(...candidates));
          if(candidates[k]<0.018&&coords.every((v,j)=>j===k||Math.abs(v)<=half[j]+0.01)){axis=k;sign=coords[k]>=0?1:-1;}
        }
        if(record&&axis>=0){this.normal.copy(box.axes[axis]).scale(sign);this.contacts.push({node:i,box,normal:this.normal.clone()});}
      }
    }
  }
  snapshot(): Record<string, unknown> {
    const b=this.bounds();return {center:this.center.array(),velocity:this.velocity.array(),volumeRatio:this.volume()/this.restVolume,height:b.height,width:b.width,contacts:this.contacts.length,anchors:this.anchors.length,charge:this.charge,state:this.state,recoveries:this.recoveries,particles:this.particles.map(n=>n.p.array())};
  }
}
