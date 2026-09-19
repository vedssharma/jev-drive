import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation, signalAt, nextIntersection, signalApproach} from '../static/simulation.js';

const decision=(pace='cruise',lane='hold')=>({pace:{choice:pace},lane:{choice:lane}});
function emptyWorld(){const s=new Simulation();s.vehicles=[];s.density=-1;return s;}

test('ego never drives without a real decision and stale decisions brake',()=>{
  const s=emptyWorld();for(let i=0;i<120;i++)s.step(1/60);
  assert.equal(s.s,0);s.applyDecision(decision());
  for(let i=0;i<420;i++)s.step(1/60);
  assert(s.distance>0);assert.equal(s.speed,0);assert.match(s.intervention,/fresh Jev/);
});
test('snow lengthens stopping distance and reduces acceleration',()=>{
  const dry=emptyWorld(),snow=emptyWorld();dry.speed=10;snow.speed=10;snow.weather='snow';
  assert(snow.stoppingDistance>dry.stoppingDistance*1.5);
  dry.speed=0;snow.speed=0;dry.applyDecision(decision());snow.applyDecision(decision());
  dry.step(.1);snow.step(.1);assert(snow.speed<dry.speed);
});
test('brake assist stops before a red light even when model chooses cruise',()=>{
  const s=emptyWorld();s.s=45;s.speed=10;s.override={center:100,until:100};
  for(let i=0;i<600;i++){s.applyDecision(decision());s.step(1/60);}
  assert(s.s<83.7);assert.equal(s.redLights,0);assert.equal(s.speed,0);assert(s.interventions>0);
});
test('unsafe lane change is rejected, safe left choice moves the car',()=>{
  const s=emptyWorld();s.vehicles=[{id:999,s:3,x:2,lane:0,speed:0}];
  s.applyDecision(decision('slow','left'));assert.equal(s.targetLane,1);
  s.vehicles=[];s.applyDecision(decision('slow','left'));assert.equal(s.targetLane,0);
  for(let i=0;i<300;i++){s.applyDecision(decision('slow'));s.step(1/60);}
  assert.equal(s.lane,0);
});
test('steering cannot slide a stationary vehicle sideways',()=>{
  const s=emptyWorld();s.applyDecision(decision('stop','left'));
  for(let i=0;i<120;i++)s.step(1/60);
  assert.equal(s.x,6);
});
test('observations respect weather visibility and include injected hazards',()=>{
  const s=emptyWorld();s.weather='fog';s.addVehicle(100,1);s.inject('barrier');s.inject('pedestrian');
  const state=s.observe();assert.equal(state.environment.visibility_m,55);
  assert(!state.road_users.some(v=>v.kind==='car'));assert(state.road_users.some(v=>v.kind==='pedestrian')===false);
  for(let i=0;i<60;i++)s.step(1/60);
  assert(s.observe().road_users.some(v=>v.kind==='pedestrian'));
});
test('barrier collisions end the run when brake assist is disabled',()=>{
  const s=emptyWorld();s.shield=false;s.speed=10;s.obstacles=[{id:999,s:9,x:6,lane:1,until:100}];
  for(let i=0;i<100;i++){s.applyDecision(decision());s.step(1/60);}
  assert.equal(s.collisions,1);assert.equal(s.halted,true);assert.equal(s.speed,0);
});
test('signals rotate and intersection clears before next one is selected',()=>{
  assert.equal(signalAt(100,1).color,'green');assert.equal(signalAt(100,20).color,'amber');
  assert.equal(signalAt(100,25).color,'red');assert.equal(nextIntersection(95),100);assert.equal(nextIntersection(115),260);
});
test('signal approach permits cruising far away and scales braking with grip',()=>{
  assert.equal(signalApproach(50/3.6,80,'red',1).approach_speed_kmh,50);
  const dry=signalApproach(50/3.6,40,'red',1),snow=signalApproach(50/3.6,40,'red',.32);
  assert.equal(dry.approach_phase,'braking');
  assert(dry.approach_speed_kmh>30);
  assert(snow.approach_speed_kmh<dry.approach_speed_kmh);
  assert(snow.comfortable_stopping_distance_m>dry.comfortable_stopping_distance_m);
  assert.equal(signalApproach(0,1.5,'red',1).approach_speed_kmh,0);
  assert.equal(signalApproach(10,10,'green',1).approach_speed_kmh,50);
  assert.equal(signalApproach(10,-5,'red',1).approach_phase,'clear');
});
test('Jev-selected approach rolls to the line without hard braking or brake assist',()=>{
  for(const weather of ['clear','rain','snow']){
    const s=emptyWorld();s.weather=weather;s.shield=false;s.s=-36.3;s.speed=(weather==='snow'?35:50)/3.6;
    s.override={center:100,until:50};
    let maxDeceleration=0, speedAt80=null;
    for(let i=0;i<2400;i++){
      s.applyDecision(decision('approach'));
      const before=s.speed;s.step(1/60);
      maxDeceleration=Math.max(maxDeceleration,(before-s.speed)*60);
      if(speedAt80===null&&s.signal.distance<80)speedAt80=s.speed;
    }
    assert(s.signal.distance>=1.49&&s.signal.distance<2,`${weather}: stopped ${s.signal.distance}m away`);
    assert(s.speed<.01);assert.equal(s.redLights,0);assert.equal(s.interventions,0);
    assert(maxDeceleration<=2.5*s.environment.grip+.001);
    if(weather==='clear')assert(speedAt80>13.8,'Keep cruising 80m before a dry-road stop');
  }
});
test('green releases the approach while stale decisions still brake',()=>{
  const s=emptyWorld();s.s=80;s.override={center:100,until:20};s.applyDecision(decision('approach'));
  s.override=null;s.step(.1);assert.equal(s.targetSpeed,50/3.6);assert(s.speed>0);
  for(let i=0;i<360;i++)s.step(1/60);
  assert.equal(s.speed,0);assert.match(s.intervention,/fresh Jev/);
});

// Real world-space arcs must join both roads without snapping at either end.
import {worldPoint, turnGeometry, turnPose, junctionSignal} from '../static/network.js';
test('left and right turns join connected lanes from every heading',()=>{
  for(let heading=0;heading<4;heading++)for(const direction of ['left','right']){
    const frame={east:160,north:100,heading,offset:0},t=turnGeometry(frame,160,direction);
    const entry=worldPoint(frame,direction==='left'?2:6,146),exit=worldPoint(t.exitFrame,direction==='left'?2:6,14);
    const a=turnPose(t,0),b=turnPose(t,t.length);
    assert(Math.hypot(a.east-entry.east,a.north-entry.north)<1e-8);
    assert(Math.hypot(b.east-exit.east,b.north-exit.north)<1e-8);
  }
});
test('turns finish on the outgoing road without teleporting other actors',()=>{
  for(const direction of ['left','right']){
    const s=emptyWorld();s.s=65;s.x=direction==='left'?2:6;s.targetLane=direction==='left'?0:1;s.speed=5;
    s.plan={direction,key:s.signal.key,center:100};
    const v=s.addVehicle(-100,1);v.speed=0;v.cruise=0;const before=s.actorPose(v);
    let prior=s.pose;
    for(let i=0;i<900&&s.turns===0;i++){
      s.applyDecision(decision('slow'));s.step(1/60);const p=s.pose;
      assert(Math.hypot(p.east-prior.east,p.north-prior.north)<.3);prior=p;
    }
    assert.equal(s.turns,1);assert.equal(s.frame.heading,direction==='right'?1:3);
    assert.equal(s.collisions,0);assert.deepEqual(s.actorPose(v),before);
  }
});
test('fast rear traffic prevents a merge even with a generous current gap',()=>{
  const s=emptyWorld();s.speed=5;const v=s.addVehicle(-30,0);v.speed=20;
  assert(s.laneGaps(0).gap_behind_m>20);assert.equal(s.laneGaps(0).safe_to_enter,false);
  s.applyDecision(decision('cruise','left'));assert.equal(s.targetLane,1);
});
test('passing holds the left lane until the overtaken car is safely behind',()=>{
  const s=emptyWorld();s.speed=10;const lead=s.addVehicle(40,1);lead.speed=5;
  s.applyDecision(decision('cruise','left'));assert.equal(s.passing.id,lead.id);
  s.x=2;s.time=3;s.applyDecision(decision('cruise','right'));assert.equal(s.targetLane,0);
  lead.s=-30;s.applyDecision(decision('cruise','right'));assert.equal(s.targetLane,1);assert.equal(s.passes,1);
});
test('a red-light queue does not trigger proactive overtaking',()=>{
  const s=emptyWorld();s.s=30;s.override={center:100,until:100};const lead=s.addVehicle(75,1);lead.speed=0;
  assert.equal(s.overtaking.beneficial,false);
});
test('turn conflict check catches a blocked outgoing lane',()=>{
  const s=emptyWorld(),t=turnGeometry(s.frame,100,'right');
  s.obstacles=[{id:999,frame:t.exitFrame,x:6,s:14,lane:1,until:100}];
  assert.equal(s.turnConflict(t),'Turn exit blocked');
});
test('perpendicular signal phases never permit conflicting green movements',()=>{
  for(let time=0;time<72;time+=.5){const p={east:160,north:260};
    assert(!(junctionSignal(p,0,time).color==='green'&&junctionSignal(p,1,time).color==='green'));
  }
});
test('a late route request is retained for the next available junction',()=>{
  const s=emptyWorld();s.setRouteRequest('right');s.applyDecision({...decision(),route:{choice:'right'}});
  s.s=75;s.setRouteRequest('left');s.finishJunction('straight',s.signal.key);
  assert.equal(s.routeRequest,'left');
});
test('crossing a straight junction does not unnecessarily invalidate the current pace',()=>{
  const s=emptyWorld();s.applyDecision({...decision(),route:{choice:'straight'}});
  const applied=s.lastDecisionAt;s.finishJunction('straight',s.signal.key);
  assert.equal(s.lastDecisionAt,applied);
});

function midTurn(direction='left'){
  const s=emptyWorld();s.s=86;s.x=direction==='left'?2:6;s.targetLane=direction==='left'?0:1;
  s.plan={direction,key:s.signal.key,center:100};s.turn=turnGeometry(s.frame,100,direction);s.turn.progress=s.turn.length*.6;s.speed=5;
  return s;
}
test('turn observations exclude a pedestrian on the old road behind the arc',()=>{
  const s=midTurn();s.pedestrians=[{id:999,frame:{...s.frame},x:6,s:90,dir:1,speed:1.7}];
  const state=s.observe();assert.equal(state.navigation.turn_clear,true);assert.deepEqual(state.road_users,[]);
});
test('a car in the adjacent exit lane does not interrupt a turn',()=>{
  const s=midTurn();s.addVehicle(17,1);
  const v=s.vehicles.at(-1);v.frame={...s.turn.exitFrame};v.x=6;v.s=17;v.speed=0;
  assert.equal(s.observe().navigation.turn_clear,true);
});
test('turn observations retain barriers and pedestrians on the actual path',()=>{
  for(const kind of ['barrier','pedestrian']){
    const s=midTurn(),p=turnPose(s.turn,s.turn.progress+6);
    const actor={id:999,frame:{east:p.east,north:p.north,heading:0,offset:0},x:0,s:0,speed:0,dir:1,until:100};
    if(kind==='barrier')s.obstacles=[actor];else s.pedestrians=[actor];
    const state=s.observe();assert.equal(state.navigation.turn_clear,false);assert(state.navigation.turn_conflict_distance_m<=6);
    assert(state.road_users.some(u=>u.kind===kind));
    for(let i=0;i<180;i++){s.applyDecision(decision('slow'));s.step(1/60);}
    assert.equal(s.collisions,0);assert(s.speed<.1);
  }
});
test('a clear turn and exit maintain motion even after the entrance signal turns red',()=>{
  for(const direction of ['left','right']){
    const s=midTurn(direction);s.override={center:100,until:100};let minimum=Infinity;
    for(let i=0;i<180;i++){
      if(i%30===0)s.applyDecision(decision('slow'));
      s.step(1/60);minimum=Math.min(minimum,s.speed);
    }
    assert.equal(s.turns,1);assert(minimum>4.5);assert.equal(s.collisions,0);
  }
});
test('clear turns still brake when Jev decisions go stale',()=>{
  const s=midTurn();s.speed=0;s.applyDecision(decision('slow'));
  for(let i=0;i<360;i++)s.step(1/60);
  assert.equal(s.speed,0);assert.match(s.intervention,/fresh Jev/);
});
