import { clamp } from './math.js';
import { FIXED_DT, idleInput, Input, Slime } from './physics.js';
import { Renderer } from './renderer.js';
import { World } from './world.js';

const element = <T extends HTMLElement>(id:string):T => {
  const el=document.getElementById(id);if(!el)throw new Error(`Missing UI element: ${id}`);return el as T;
};
const fatal=element('fatal');
try { start(); } catch(error){fatal.hidden=false;fatal.textContent=error instanceof Error?error.message:String(error);console.error(error);}

function start():void{
  const canvas=element<HTMLCanvasElement>('scene'),renderer=new Renderer(canvas),world=new World();
  let station=0;const slime=new Slime(world.stations[0].spawn),keys=new Set<string>();
  const complete=new Set<number>();let paused=false,accumulator=0,last=performance.now(),physicsMs=0,uiAt=0;
  let noticeUntil=0,noticeText='';let completedNow=false;
  const labels=['Free movement','Compression','Adhesion','Squeeze','Momentum'];
  const stationNav=element('stations');
  for(let i=0;i<world.stations.length;i++){
    const button=document.createElement('button');button.type='button';button.title=`${i+1} — ${world.stations[i].name}`;
    button.innerHTML=`<span class="number">0${i+1}</span><span class="station-name">${labels[i]}</span><span class="checkmark"></span>`;
    button.addEventListener('click',()=>{selectStation(i);canvas.focus({preventScroll:true});});stationNav.append(button);
  }
  function showNotice(text:string,seconds=4):void{noticeText=text;noticeUntil=performance.now()+seconds*1000;element('notice').textContent=text;}
  function clearInput():void{keys.clear();slime.cancelInput();for(const b of document.querySelectorAll('.touch-controls button'))b.classList.remove('down');}
  function selectStation(index:number):void{
    station=Number.isFinite(index)?clamp(Math.trunc(index),0,world.stations.length-1):0;clearInput();world.reset();slime.reset(world.stations[station].spawn);renderer.resetCamera(slime.center);accumulator=0;completedNow=false;
    const s=world.stations[station];element('station-title').textContent=s.name;element('station-subtitle').textContent=s.subtitle;element('station-hint').textContent=s.hint;
    Array.from(stationNav.children).forEach((button,i)=>{button.classList.toggle('active',i===station);button.setAttribute('aria-current',i===station?'step':'false');});
    noticeText='';noticeUntil=0;element('notice').textContent='';updateUI();
  }
  function setPause(value:boolean):void{paused=value;accumulator=0;last=performance.now();clearInput();element('pause').textContent=paused?'Resume':'Pause';element('pause').setAttribute('aria-pressed',String(paused));}
  const controlCodes=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Space','ShiftLeft','ShiftRight','KeyQ']);
  window.addEventListener('keydown',e=>{
    const target=e.target as HTMLElement;
    if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target instanceof HTMLSelectElement||target.isContentEditable||e.metaKey||e.ctrlKey||e.altKey)return;
    if(target instanceof HTMLButtonElement&&(e.code==='Space'||e.code==='Enter'))return;
    if(controlCodes.has(e.code)){e.preventDefault();keys.add(e.code);}
    if(e.repeat)return;
    if(/^Digit[1-5]$/.test(e.code))selectStation(Number(e.code.slice(-1))-1);
    if(e.code==='KeyR')selectStation(station);
    if(e.code==='KeyP')setPause(!paused);
    if(e.code==='KeyC')renderer.resetCamera(slime.center);
    if(e.code==='KeyF'){renderer.debug=!renderer.debug;element<HTMLInputElement>('debug').checked=renderer.debug;}
  });
  window.addEventListener('keyup',e=>{keys.delete(e.code);if(controlCodes.has(e.code)&&!(e.target instanceof HTMLInputElement))e.preventDefault();});
  window.addEventListener('blur',clearInput);
  document.addEventListener('visibilitychange',()=>{clearInput();accumulator=0;last=performance.now();});
  for(const button of document.querySelectorAll<HTMLButtonElement>('[data-key]')){
    const code=button.dataset.key!;
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(code);button.classList.add('down');});
    const release=():void=>{keys.delete(code);button.classList.remove('down');};
    button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
  }
  element('reset').addEventListener('click',()=>{selectStation(station);canvas.focus({preventScroll:true});});element('pause').addEventListener('click',()=>{setPause(!paused);canvas.focus({preventScroll:true});});
  element<HTMLInputElement>('debug').addEventListener('change',e=>{renderer.debug=(e.target as HTMLInputElement).checked;});
  function updateSettings():void{
    for(const name of ['stiffness','traction'] as const){const value=slime.settings[name];element<HTMLInputElement>(name).value=String(value);element(`${name}-value`).textContent=`${value.toFixed(2)}×`;}
  }
  for(const name of ['stiffness','traction'] as const)element<HTMLInputElement>(name).addEventListener('input',e=>{
    slime.settings[name]=Number((e.target as HTMLInputElement).value);updateSettings();for(const button of document.querySelectorAll('[data-preset]'))button.classList.remove('selected');
  });
  for(const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]'))button.addEventListener('click',()=>{
    const preset=button.dataset.preset;
    slime.settings.stiffness=preset==='goo'?0.45:preset==='spring'?1.8:1;slime.settings.traction=preset==='goo'?0.6:preset==='spring'?1.2:1;updateSettings();
    for(const b of document.querySelectorAll('[data-preset]'))b.classList.toggle('selected',b===button);
  });
  function readInput():Input{
    const x=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    const f=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
    const length=Math.max(1,Math.hypot(x,f)),c=Math.cos(renderer.yaw),s=Math.sin(renderer.yaw);
    return {x:(x*c-f*s)/length,z:(-x*s-f*c)/length,strafe:x,climb:f,jump:keys.has('Space'),grip:keys.has('ShiftLeft')||keys.has('ShiftRight'),relax:keys.has('KeyQ')};
  }
  function updateUI():void{
    element('state').textContent=paused?'PAUSED':slime.state;
    element('speed').innerHTML=`${slime.velocity.length().toFixed(1)} <span>m/s</span>`;
    element('volume').innerHTML=`${(slime.volume()/slime.restVolume*100).toFixed(1)} <span>%</span>`;
    element('contacts').textContent=String(slime.contacts.length);element('anchors').textContent=String(slime.anchors.length);
    element('timing').innerHTML=`${physicsMs.toFixed(1)} <span>ms</span>`;
    element('charge-fill').style.width=`${slime.charge*100}%`;element('charge-label').textContent=slime.charge>0?`${Math.round(slime.charge*100)}% · RELEASE`:'HOLD SPACE';
    if(performance.now()>noticeUntil&&noticeText){noticeText='';element('notice').textContent='';}
  }
  function checkGoal():void{
    if(completedNow)return;
    if(slime.center.distance(world.stations[station].goal)<world.stations[station].goalRadius){
      completedNow=true;complete.add(station);
      stationNav.children[station].querySelector('.checkmark')!.textContent='✓';
      showNotice(complete.size===5?'All five stations explored. Now mix the moves.':`Station explored. Try ${station===4?'1':station+2} for the next experiment.`,6);
    }
  }
  function frame(now:number):void{
    try{
      const elapsed=Math.min((now-last)/1000,0.1);last=now;
      if(!paused&&!document.hidden){
        accumulator+=elapsed;let steps=0;const start=performance.now();
        while(accumulator>=FIXED_DT&&steps<6){slime.step(world,readInput());accumulator-=FIXED_DT;steps++;checkGoal();}
        if(steps>0)physicsMs=physicsMs*0.9+(performance.now()-start)/steps*0.1;
      }
      renderer.render(world,slime,world.stations[station],paused?1:accumulator/FIXED_DT,elapsed,complete.has(station));
      if(now-uiAt>65){updateUI();uiAt=now;}
      requestAnimationFrame(frame);
    }catch(error){fatal.hidden=false;fatal.textContent=`Simulation stopped: ${error instanceof Error?error.message:String(error)}. Reload to retry.`;console.error(error);}
  }
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();setPause(true);fatal.hidden=false;fatal.textContent='The graphics context was lost. Reload this page to restart the laboratory.';});
  selectStation(Number(new URLSearchParams(location.search).get('station')||1)-1);
  requestAnimationFrame(frame);
  // Explicit opt-in deterministic browser harness; absent from normal sessions.
  if(new URLSearchParams(location.search).has('test')){
    const api={
      reset(index=0):void{setPause(true);selectStation(index);},
      advance(frames:number,input:Partial<Input>={}):Record<string,unknown>{
        if(!paused)setPause(true);for(let i=0;i<clamp(Math.trunc(frames),0,3600);i++)slime.step(world,{...idleInput(),...input});
        renderer.render(world,slime,world.stations[station],1,FIXED_DT,complete.has(station));updateUI();return slime.snapshot();
      },
      snapshot:():Record<string,unknown>=>slime.snapshot(),
      resume:():void=>setPause(false),
    };
    (window as unknown as {__slimeLab:typeof api}).__slimeLab=api;
  }
}
