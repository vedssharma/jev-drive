import {Simulation, PACES, WEATHER} from './simulation.js';
import {CityRenderer} from './renderer.js';
import {DIRECTIONS, streetName, outgoingFrame} from './network.js';

const $ = id => document.getElementById(id);
const sim = new Simulation();
let renderer;
try {renderer = new CityRenderer($('scene'),sim); $('loading').hidden=true;}
catch(error) {$('loading').textContent='This simulator needs WebGL. Enable hardware acceleration and reload.'; console.error(error);}
let running=false,configured=false,pending=false,generation=0,sequence=0,decisions=0,tokens=0,nextRequest=0,requestController=null;
let lastFrame=performance.now(),lastUi=0,frames=0,fpsSince=performance.now(),lastLogId=-1,lastChoice='',errorNotice='';
const clock=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const labels={stop:'Stop',approach:'Approach',crawl:'Crawl',slow:'Slow',steady:'Steady',cruise:'Cruise'};
const attention={open_road:'Open road ahead',signal:'Watching the next signal',pedestrian:'Pedestrian crossing ahead',traffic:'Monitoring surrounding traffic',weather:'Adapting to road conditions',obstruction:'Watching the blocked lane',emergency:'Approaching emergency vehicle'};
for(const [key,label] of Object.entries(labels)){
  const row=document.createElement('div');row.className='prob-row';row.id=`prob-${key}`;
  row.innerHTML=`<span>${label}</span><div class="prob-track"><div class="prob-fill"></div></div><span>—</span>`;$('probabilities').appendChild(row);
}
function invalidate(){generation++;requestController?.abort();sim.lastDecisionAt=-100;nextRequest=0;}
function setRunning(value){
  if(value&&(!configured||!renderer||sim.halted))return;
  running=value;invalidate();errorNotice='';
  $('start').innerHTML=value?'Ⅱ Pause driving <kbd>SPACE</kbd>':'▶ Start driving <kbd>SPACE</kbd>';
  $('car-state').textContent=value?'AUTONOMOUS':'PAUSED';
  $('inference-status').textContent=value?'CONNECTING':'PAUSED';
  if(value)sim.event('Jev driving engaged','jev');
}
async function infer(){
  if(!running||pending||performance.now()<nextRequest)return;
  pending=true;const gen=generation,epoch=sim.routeEpoch,observedAt=sim.time,state=sim.observe();
  const seq=++sequence;requestController=new AbortController();
  const timer=setTimeout(()=>requestController?.abort(),8000);
  $('inference-status').textContent='THINKING';
  try{
    const response=await fetch('/api/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sequence:seq,state}),signal:requestController.signal});
    const result=await response.json();
    if(gen!==generation||!running)return;
    if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'The driving observation was rejected.');
    if(result.sequence!==seq)throw new Error('Mismatched decision response.');
    tokens+=result.input_tokens;decisions++;
    $('latency').textContent=`${result.latency_ms} ms`;$('decisions').textContent=`${decisions} decisions`;$('tokens').textContent=`${tokens.toLocaleString()} tokens`;
    $('raw').textContent=JSON.stringify({observation:state,response:result},null,2);
    if(sim.time-observedAt>2||sim.routeEpoch!==epoch){
      sim.event('Discarded an outdated Jev decision','shield');
      $('inference-status').textContent='STALE';nextRequest=performance.now()+100;return;
    }
    sim.applyDecision(result.answers);
    const {pace,lane,attention:focus}=result.answers;
    $('decision').textContent=`${labels[pace.choice]}${lane.choice==='hold'?' · hold lane':` · move ${lane.choice}`}`;
    $('attention').textContent=attention[focus.choice]||focus.choice;
    $('decision-icon').textContent=pace.choice==='stop'?'Ⅱ':lane.choice==='left'?'↖':lane.choice==='right'?'↗':'↑';
    for(const key of Object.keys(PACES)){
      const row=$(`prob-${key}`),prob=pace.probabilities[key]||0;
      row.classList.toggle('selected',key===pace.choice);row.querySelector('.prob-fill').style.width=`${prob*100}%`;
      row.lastElementChild.textContent=`${Math.round(prob*100)}%`;
    }
    const choice=`${pace.choice}/${lane.choice}/${focus.choice}`;
    if(choice!==lastChoice){sim.event(`${labels[pace.choice]} · ${lane.choice==='hold'?'hold lane':`move ${lane.choice}`} · ${attention[focus.choice]}`,'jev');lastChoice=choice;}
    $('inference-status').textContent='LIVE';nextRequest=performance.now()+550;
  }catch(error){
    if(gen!==generation)return;
    setRunning(false);errorNotice=error.name==='AbortError'?'Jev request timed out. Drive paused; press Start to retry.':error.message;
    sim.event(errorNotice,'danger');$('inference-status').textContent='OFFLINE';
  }finally{clearTimeout(timer);pending=false;requestController=null;}
}
function reset(){
  setRunning(false);sim.reset();lastChoice='';decisions=0;tokens=0;lastLogId=-1;
  $('start').disabled=!configured;$('decision').textContent='Ready when you are';$('attention').textContent='Start a drive to see real model decisions.';
  $('decisions').textContent='0 decisions';$('tokens').textContent='0 tokens';$('latency').textContent='— ms';$('raw').textContent='No decisions yet.';
  for(const key of Object.keys(PACES)){const r=$(`prob-${key}`);r.classList.remove('selected');r.querySelector('.prob-fill').style.width='0%';r.lastElementChild.textContent='—';}
  $('night').checked=false;$('density').value=5;$('density-label').textContent='Moderate';$('shield').checked=true;
  $('route-preference').value='auto';
  setWeather('clear');$('inference-status').textContent='STANDBY';
}
function setWeather(value){sim.weather=value;invalidate();document.querySelectorAll('[data-weather]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.weather===value)));if(sim.time>0)sim.event(`Weather changed to ${WEATHER[value].label.toLowerCase()}`);}
$('start').onclick=()=>setRunning(!running);$('reset').onclick=reset;
$('camera').onclick=()=>{renderer.view=(renderer.view+1)%3;$('camera').querySelector('span').textContent=['Orbit view','Map view','Driver view'][renderer.view];};
document.querySelectorAll('[data-weather]').forEach(b=>b.onclick=()=>setWeather(b.dataset.weather));
document.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>{sim.inject(b.dataset.event);invalidate();});
$('night').onchange=e=>{sim.night=e.target.checked;invalidate();sim.event(sim.night?'Night driving enabled':'Daylight restored');};
$('shield').onchange=e=>{sim.shield=e.target.checked;sim.event(`Emergency brake assist ${sim.shield?'enabled':'disabled'}`);};
$('route-preference').onchange=e=>{sim.setRouteRequest(e.target.value);invalidate();};
$('density').oninput=e=>{sim.density=Number(e.target.value);$('density-label').textContent=sim.density<4?'Light':sim.density>6?'Heavy':'Moderate';
  const ordinary=sim.vehicles.filter(v=>sim.localActor(v).direction===0&&v.kind==='car');
  const excess=ordinary.length-(sim.density*2+1);
  if(excess>0){const remove=new Set(ordinary.sort((a,b)=>sim.localActor(b).s-sim.localActor(a).s).filter(v=>sim.localActor(v).s-sim.s>60).slice(0,excess).map(v=>v.id));sim.vehicles=sim.vehicles.filter(v=>!remove.has(v.id));}
  invalidate();};
$('info-button').onclick=()=>{$('about').showModal();if(running)setRunning(false);};$('close-about').onclick=()=>$('about').close();
document.addEventListener('keydown',e=>{
  if(['INPUT','BUTTON','SUMMARY','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||$('about').open)return;
  if(e.code==='Space'){e.preventDefault();setRunning(!running);}
  if(e.code==='KeyC')$('camera').click();if(e.code==='KeyR')reset();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)setRunning(false);});
function ui(){
  if(renderer){const position=renderer.egoScreenPosition();const label=document.querySelector('.road-label');label.style.left=`${position.x}px`;label.style.top=`${position.y}px`;label.style.display=renderer.view===2?'none':'flex';}
  $('speed').textContent=Math.round(sim.speed*3.6);$('target').textContent=Math.round(sim.targetSpeed*3.6);
  $('speed-bar').style.width=`${Math.min(100,sim.speed*3.6/50*100)}%`;
  $('distance').innerHTML=sim.distance<1000?`${Math.round(sim.distance)} <small>m</small>`:`${(sim.distance/1000).toFixed(2)} <small>km</small>`;
  $('grip').innerHTML=`${Math.round(sim.environment.grip*100)}<small>%</small>`;
  const sig=sim.signal;$('signal-dot').className=`signal-dot ${sig.color}`;$('signal-distance').textContent=sig.distance<0?'Crossing':`${Math.round(sig.distance)} m`;
  $('place').textContent=`${DIRECTIONS[sim.frame.heading]} on ${streetName(sim.frame)}`;
  const route=sim.plan?.direction;
  $('route-action').textContent=sim.turn?`Turning ${sim.turn.direction}`:route?`${{left:'↰ Turn left',right:'↱ Turn right',straight:'↑ Continue straight'}[route]} · ${Math.max(0,Math.round(sig.distance))} m`:'Jev is choosing the next street';
  $('route-street').textContent=route?streetName(outgoingFrame(sim.frame,sig.center,route)):streetName(sim.frame);
  $('route-preference').value=sim.routeRequest;
  $('turn-count').textContent=`${sim.turns} TURNS`;
  $('passing-status').textContent=sim.passing?'Passing · waiting for safe clearance to return':`${sim.passes} passes completed · ${sim.lane===0?'left lane':'right lane'}`;
  drawMap();
  $('weather-pill').textContent=`${{clear:'☀',rain:'☂',fog:'≋',snow:'❄'}[sim.weather]} ${WEATHER[sim.weather].label}${sim.night?' · Night':''} · 50 km/h limit`;
  document.body.classList.toggle('night',sim.night);
  $('interventions').textContent=sim.interventions;$('violations').textContent=sim.redLights;$('collisions').textContent=sim.collisions;$('elapsed').textContent=clock(sim.time);
  const notice=errorNotice||(sim.halted?'Collision detected. Reset to drive again.':running?sim.intervention:'');
  $('notice').hidden=!notice;$('notice').textContent=notice;$('notice').classList.toggle('error',!!errorNotice||sim.halted);
  if(sim.halted&&running){setRunning(false);$('start').disabled=true;$('car-state').textContent='STOPPED';}
  if(sim.events[0]?.id!==lastLogId){
    lastLogId=sim.events[0]?.id;
    $('log').replaceChildren();
    if(!sim.events.length){const p=document.createElement('p');p.className='empty';p.textContent='Your drive starts here.';$('log').appendChild(p);}
    for(const e of sim.events.slice(0,7)){const row=document.createElement('div');row.className=`log-row ${e.type}`;const t=document.createElement('time');t.textContent=clock(e.time);const text=document.createElement('span');text.textContent=e.text;row.append(t,text);$('log').appendChild(row);}
  }
}
function drawMap(){
  const canvas=$('route-map'),ctx=canvas.getContext('2d'),ego=sim.pose,scale=.7;
  const px=e=>180+(e-ego.east)*scale,py=n=>120-(n-ego.north)*scale;
  ctx.clearRect(0,0,360,240);ctx.fillStyle='#e8eee2';ctx.fillRect(0,0,360,240);
  ctx.strokeStyle='#b6c9b8';ctx.lineWidth=12;
  for(let i=-3;i<=3;i++){
    const x=px((Math.round(ego.east/160)+i)*160),y=py(100+(Math.round((ego.north-100)/160)+i)*160);
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,240);ctx.moveTo(0,y);ctx.lineTo(360,y);ctx.stroke();
  }
  ctx.strokeStyle='#2c9161';ctx.lineWidth=4;ctx.beginPath();
  sim.trail.forEach((p,i)=>i?ctx.lineTo(px(p.east),py(p.north)):ctx.moveTo(px(p.east),py(p.north)));ctx.stroke();
  ctx.save();ctx.translate(180,120);ctx.rotate(ego.heading);ctx.fillStyle='#184d37';ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(7,8);ctx.lineTo(0,5);ctx.lineTo(-7,8);ctx.closePath();ctx.fill();ctx.restore();
  ctx.fillStyle='#5b7765';ctx.font='18px sans-serif';ctx.fillText('N ↑',16,26);
  $('map-caption').textContent=`${streetName(sim.frame)} · ${sim.turns} turns`;
}
function frame(now){
  const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;
  if(running){for(let left=dt;left>0;left-=1/60)sim.step(Math.min(left,1/60));infer();}
  renderer?.render(dt);
  if(now-lastUi>100){ui();lastUi=now;}
  frames++;if(now-fpsSince>1000){$('fps').textContent=`${Math.round(frames*1000/(now-fpsSince))} FPS`;fpsSince=now;frames=0;}
  requestAnimationFrame(frame);
}
async function connect(){
  try{const response=await fetch('/api/status');if(!response.ok)throw new Error('Server unavailable');const status=await response.json();configured=status.configured;
    $('connection').textContent=configured?'Jev connected':'API key needed';$('connection-dot').classList.toggle('ready',configured);$('start').disabled=!configured||!renderer;
    if(!configured){errorNotice='Add TYPESAFE_API_KEY to .env and restart to enable Jev driving.';}
  }catch{errorNotice='Cannot reach the simulator server. Restart it and reload.';$('connection').textContent='Disconnected';}
}
connect();requestAnimationFrame(frame);
