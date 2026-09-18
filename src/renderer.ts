import { clamp, lookAt, makeCage, multiply, perspective, V3 } from './math.js';
import { Slime } from './physics.js';
import { Box, RGB, Station, World } from './world.js';

const vertexShader = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec3 color;
layout(location=3) in float kind;
uniform mat4 vp;
out vec3 P; out vec3 N; out vec3 C; out float K;
void main(){P=position;N=normal;C=color;K=kind;gl_Position=vp*vec4(position,1.0);}`;
const fragmentShader = `#version 300 es
precision highp float;
in vec3 P; in vec3 N; in vec3 C; in float K;
uniform vec3 eye; uniform vec3 body; uniform float time;
out vec4 result;
void main(){
  vec3 n=normalize(N), light=normalize(vec3(-0.45,0.85,0.4));
  float diffuse=max(dot(n,light),0.0);
  vec3 col=C*(0.48+0.65*diffuse);
  if(K<0.5){
    vec2 uv=P.xz/2.0;vec2 grid=abs(fract(uv-0.5)-0.5)/max(fwidth(uv),vec2(0.0001));
    float line=1.0-min(min(grid.x,grid.y),1.0);
    col+=vec3(0.035,0.060,0.065)*line;
    vec2 d=P.xz-body.xz;float shadow=exp(-dot(d,d)/(0.95+max(body.y,0.0)*0.2));
    col*=1.0-0.40*shadow*exp(-max(body.y-0.8,0.0)*0.16);
  }
  if(K>1.5&&K<2.5){
    vec3 h=normalize(light+normalize(eye-P));float spec=pow(max(dot(n,h),0.0),48.0);
    float rim=pow(1.0-max(dot(n,normalize(eye-P)),0.0),3.0);
    col+=vec3(0.83,1.0,0.59)*spec*0.9+vec3(0.2,0.30,0.06)*rim;
  }
  if(K>2.5)col=C*(0.9+0.1*sin(time*2.0));
  float fog=1.0-exp(-length(eye-P)*0.013);
  col=mix(col,vec3(0.055,0.086,0.099),fog);
  result=vec4(pow(max(col,vec3(0.0)),vec3(0.85)),1.0);
}`;

/** Deliberately small WebGL2 view. All green surface positions come from physics. */
export class Renderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private data: number[]=[];
  private vpLocation: WebGLUniformLocation | null;
  private eyeLocation: WebGLUniformLocation | null;
  private bodyLocation: WebGLUniformLocation | null;
  private timeLocation: WebGLUniformLocation | null;
  private dotCage=makeCage(1);
  private points: V3[]=[];
  private normals: V3[]=[];
  yaw=0.25;
  pitch=0.58;
  distance=12.5;
  target=new V3();
  eye=new V3();
  debug=false;
  private matrix=new Float32Array(16);
  constructor(public canvas: HTMLCanvasElement){
    const gl=canvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'low-power'});
    if(!gl)throw new Error('WebGL 2 is unavailable. Enable hardware acceleration or try a current desktop browser.');
    this.gl=gl;
    const compile=(type:number,source:string):WebGLShader=>{
      const shader=gl.createShader(type);if(!shader)throw new Error('Cannot allocate shader.');
      gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)||'Shader compilation failed.');return shader;
    };
    const program=gl.createProgram();if(!program)throw new Error('Cannot allocate program.');
    const vs=compile(gl.VERTEX_SHADER,vertexShader),fs=compile(gl.FRAGMENT_SHADER,fragmentShader);
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Shader linking failed.');
    this.program=program;gl.useProgram(program);
    const buffer=gl.createBuffer();if(!buffer)throw new Error('Cannot allocate geometry buffer.');this.buffer=buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    for(const [index,size,offset] of [[0,3,0],[1,3,12],[2,3,24],[3,1,36]]){gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,40,offset);}
    this.vpLocation=gl.getUniformLocation(program,'vp');this.eyeLocation=gl.getUniformLocation(program,'eye');this.bodyLocation=gl.getUniformLocation(program,'body');this.timeLocation=gl.getUniformLocation(program,'time');
    gl.enable(gl.DEPTH_TEST);gl.clearColor(0.055,0.086,0.099,1);
    this.bindCamera();
  }
  private bindCamera():void{
    let pointer=-1,lastX=0,lastY=0;
    this.canvas.addEventListener('pointerdown',e=>{if(e.button!==0&&e.button!==2)return;pointer=e.pointerId;lastX=e.clientX;lastY=e.clientY;this.canvas.setPointerCapture(pointer);});
    this.canvas.addEventListener('pointermove',e=>{if(e.pointerId!==pointer)return;this.yaw-=(e.clientX-lastX)*0.006;this.pitch=clamp(this.pitch+(e.clientY-lastY)*0.004,0.2,1.28);lastX=e.clientX;lastY=e.clientY;});
    const release=():void=>{pointer=-1;};this.canvas.addEventListener('pointerup',release);this.canvas.addEventListener('pointercancel',release);this.canvas.addEventListener('lostpointercapture',release);
    this.canvas.addEventListener('contextmenu',e=>e.preventDefault());
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.distance=clamp(this.distance*Math.exp(e.deltaY*0.001),5,23);},{passive:false});
  }
  resetCamera(center:V3):void{this.yaw=0.25;this.pitch=0.58;this.distance=12.5;this.target.copy(center);}
  private vertex(p:V3,n:V3,c:RGB,kind:number):void{this.data.push(p.x,p.y,p.z,n.x,n.y,n.z,c[0],c[1],c[2],kind);}
  private triangle(a:V3,b:V3,c:V3,color:RGB,kind=1):void{
    const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();this.vertex(a,n,color,kind);this.vertex(b,n,color,kind);this.vertex(c,n,color,kind);
  }
  private occludes(box:Box, end:V3):boolean{
    const a=box.local(this.eye).array(),b=box.local(end).array(),h=box.half.array();let near=0,far=1;
    for(let k=0;k<3;k++){
      const d=b[k]-a[k];if(Math.abs(d)<1e-8){if(Math.abs(a[k])>h[k])return false;continue;}
      let t0=(-h[k]-a[k])/d,t1=(h[k]-a[k])/d;if(t0>t1)[t0,t1]=[t1,t0];near=Math.max(near,t0);far=Math.min(far,t1);
    }return near<far&&near>0.01&&near<0.98;
  }
  private box(box:Box, cutaway=false):void{
    const h=box.half;
    const v=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(p=>box.world(new V3(p[0]*h.x,p[1]*h.y,p[2]*h.z)));
    if(cutaway){
      for(const [a,b]of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]])this.segment(v[a],v[b],[0.30,0.45,0.48],0.014);
      return;
    }
    const faces=[[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]];
    for(const [a,b,c,d]of faces){this.triangle(v[a],v[b],v[c],box.color,box.id==='floor'?0:1);this.triangle(v[a],v[c],v[d],box.color,box.id==='floor'?0:1);}
  }
  private dot(p:V3,r:number,color:RGB):void{
    for(const face of this.dotCage.faces){const [a,b,c]=face.map(i=>this.dotCage.vertices[i].clone().scale(r).add(p));this.triangle(a,b,c,color,3);}
  }
  private ring(p:V3,r:number,color:RGB):void{
    for(let i=0;i<48;i++){
      const a=i*Math.PI/24,b=(i+1)*Math.PI/24;
      const point=(t:number,radius:number):V3=>new V3(p.x+Math.cos(t)*radius,p.y,p.z+Math.sin(t)*radius);
      this.triangle(point(a,r),point(b,r),point(a,r-0.055),color,3);this.triangle(point(b,r),point(b,r-0.055),point(a,r-0.055),color,3);
    }
  }
  private segment(a:V3,b:V3,color:RGB,width=0.018):void{
    const offset=b.clone().sub(a).cross(this.eye.clone().sub(a)).normalize().scale(width);
    this.triangle(a.clone().add(offset),b.clone().add(offset),a.clone().sub(offset),color,3);
    this.triangle(b.clone().add(offset),b.clone().sub(offset),a.clone().sub(offset),color,3);
  }
  render(world:World,slime:Slime,station:Station,alpha:number,dt:number,completed:boolean):void{
    const gl=this.gl,dpr=Math.min(window.devicePixelRatio||1,1.5),width=Math.round(this.canvas.clientWidth*dpr),height=Math.round(this.canvas.clientHeight*dpr);
    if(width!==this.canvas.width||height!==this.canvas.height){this.canvas.width=width;this.canvas.height=height;}
    if(width===0||height===0)return;
    while(this.points.length<slime.particles.length){this.points.push(new V3());this.normals.push(new V3());}
    const center=new V3();
    slime.particles.forEach((n,i)=>{this.points[i].copy(n.renderOld).lerp(n.p,alpha);center.add(this.points[i]);this.normals[i].set(0,0,0);});center.scale(1/slime.particles.length);
    this.target.lerp(center.clone().add(new V3(0,0.45,-0.5)),1-Math.exp(-5*dt));
    this.eye.set(Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),Math.cos(this.yaw)*Math.cos(this.pitch)).scale(this.distance).add(this.target);
    this.matrix=multiply(perspective(0.82,width/height,0.1,150),lookAt(this.eye,this.target));
    gl.viewport(0,0,width,height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.vpLocation,false,this.matrix);gl.uniform3f(this.eyeLocation,this.eye.x,this.eye.y,this.eye.z);gl.uniform3f(this.bodyLocation,center.x,center.y,center.z);gl.uniform1f(this.timeLocation,world.time);
    this.data.length=0;
    for(const box of world.boxes)this.box(box,box.id!=='floor'&&this.occludes(box,center));
    // Physical surface, with interpolated positions but no secondary shape animation.
    for(const [a,b,c] of slime.faces){const n=this.points[b].clone().sub(this.points[a]).cross(this.points[c].clone().sub(this.points[a]));this.normals[a].add(n);this.normals[b].add(n);this.normals[c].add(n);}
    for(const n of this.normals)n.normalize();
    const green:RGB=slime.anchors.length?[0.63,0.87,0.37]:slime.flatten<0.65?[0.48,0.84,0.30]:[0.68,0.91,0.32];
    for(const face of slime.faces)for(const i of face){const tint=1-0.07*Math.sin(i*12.7);this.vertex(this.points[i],this.normals[i],[green[0]*tint,green[1]*tint,green[2]*tint],2);}
    const goalColor:RGB=completed?[0.62,0.86,0.46]:[0.43,0.70,0.72];
    const goal=station.goal.clone();goal.y-=0.60;this.ring(goal,0.85,goalColor);
    this.dot(goal.clone().add(new V3(0,0.28+Math.sin(world.time*2)*0.08,0)),0.1,goalColor);
    if(this.debug){
      const contacts=new Set(slime.contacts.map(c=>c.node));
      for(let i=0;i<this.points.length;i++)this.dot(this.points[i],0.035,contacts.has(i)?[1,0.58,0.24]:[0.11,0.25,0.13]);
      for(const l of slime.links)if(!l.bend)this.segment(this.points[l.a],this.points[l.b],[0.14,0.28,0.16],0.009);
      for(const a of slime.anchors){const p=a.box.world(a.local);this.dot(p,0.06,[0.94,0.48,0.93]);this.segment(this.points[a.node],p,[0.94,0.48,0.93]);this.segment(p,p.clone().addScaled(a.normal,0.3),[0.94,0.48,0.93]);}
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(this.data),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,this.data.length/10);
  }
}
