import {INITIAL_FRAME, DIRECTIONS, basis, worldPoint, localPoint, junctionKey, streetName, nextCenter, junctionSignal, outgoingFrame, turnGeometry, turnPose, mod} from './network.js';

export const LANES = [2, 6];
export const WEATHER = {
  clear: {grip: 1, visibility: 220, label: 'Clear skies'},
  rain: {grip: .62, visibility: 120, label: 'Rain'},
  fog: {grip: .85, visibility: 55, label: 'Dense fog'},
  snow: {grip: .32, visibility: 85, label: 'Snow'},
};
export const PACES = {stop: 0, approach: null, crawl: 10, slow: 22, steady: 35, cruise: 50};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Solve d = v * reactionTime + v² / (2a), preserving a small stop-line buffer.
// This is a motion primitive selected by Jev, not an independent driving policy.
export function signalApproach(speed, distance, color, grip) {
  const deceleration = 2.5 * grip, reactionTime = .8, buffer = 1.5;
  const brakingDistance = speed * reactionTime + speed ** 2 / (2 * deceleration) + buffer;
  const cap = Math.max(0, Math.sqrt((deceleration * reactionTime) ** 2 +
    2 * deceleration * Math.max(0, distance - buffer)) - deceleration * reactionTime);
  const required = color !== 'green' && distance >= 0;
  return {
    approach_phase: !required ? 'clear' : distance <= 2 ? 'at_line' : cap >= 50 / 3.6 ? 'cruise' : 'braking',
    approach_speed_kmh: required ? Math.min(50, cap * 3.6) : 50,
    comfortable_stopping_distance_m: brakingDistance,
  };
}
export function signalAt(center, time, override = null) {
  if (override && override.center === center && time < override.until)
    return {color: 'red', remaining: override.until - time};
  const phase = ((time + Math.round((center - 100) / 160) * 7) % 36 + 36) % 36;
  return phase < 19 ? {color: 'green', remaining: 19 - phase}
    : phase < 22 ? {color: 'amber', remaining: 22 - phase}
    : {color: 'red', remaining: 36 - phase};
}
export function nextIntersection(s) { return 100 + Math.ceil((s - 114) / 160) * 160; }

export class Simulation {
  constructor(seed = 17) { this.seed = seed; this.reset(); }
  random() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  reset() {
    this.seed = 17; this.time = 0; this.s = 0; this.x = 6; this.speed = 0;
    this.frame = {...INITIAL_FRAME}; this.turn = null; this.plan = null; this.routeRequest = 'auto';
    this.routeEpoch = 0; this.turns = 0; this.passes = 0; this.junctions = 0; this.passing = null;
    this.visits = new Map(); this.trail = []; this.lastTrailDistance = -2; this.laneChangedAt = -100;
    this.targetLane = 1; this.targetSpeed = 0; this.pace = 'stop'; this.weather = 'clear'; this.night = false;
    this.density = 5; this.shield = true; this.intervention = ''; this.interventions = 0;
    this.collisions = 0; this.redLights = 0; this.distance = 0; this.halted = false;
    this.vehicles = []; this.pedestrians = []; this.obstacles = []; this.crossTraffic = [];
    this.override = null; this.nextId = 1; this.lastPedCycle = new Map(); this.lastViolation = null;
    this.lastIntervention = ''; this.events = []; this.lastDecisionAt = -100;
    this.populatedRoads = new Set(); this.populate(); this.ensureNeighborhood();
  }
  get lane() { return Math.abs(this.x - 2) < Math.abs(this.x - 6) ? 0 : 1; }
  get environment() { return WEATHER[this.weather]; }
  get braking() { return 7.5 * this.environment.grip; }
  get stoppingDistance() { return this.speed * .8 + this.speed ** 2 / (2 * this.braking); }
  get pose() { return this.turn ? turnPose(this.turn) : {...worldPoint(this.frame, this.x, this.s), heading: this.frame.heading * Math.PI / 2}; }
  get signalApproach() { const sig = this.signal; return signalApproach(this.speed, sig.distance, sig.color, this.environment.grip); }
  signalFor(frame, s) {
    const center = nextCenter(s, frame.offset), point = worldPoint(frame, 0, center);
    // Legacy local override is accepted for physics fixtures; live overrides use world junction IDs.
    const forced = this.override && !this.override.key ? {...this.override, key: junctionKey(worldPoint(this.frame, 0, this.override.center))} : this.override;
    return {center, point, key: junctionKey(point), ...junctionSignal(point, frame.heading, this.time, forced), distance: center - 16.3 - s};
  }
  get signal() { return this.signalFor(this.frame, this.s); }
  event(text, type = 'world') { this.events.unshift({id: this.nextId++, time: this.time, text, type}); this.events.length = Math.min(this.events.length, 40); }
  actorPose(actor) {
    const frame = actor.frame || this.frame;
    return {...worldPoint(frame, actor.x, actor.s), heading: (frame.heading + (actor.opposite ? 2 : 0)) * Math.PI / 2};
  }
  localActor(actor, frame = this.frame) {
    const pose = this.actorPose(actor), point = localPoint(frame, pose);
    const direction = mod(Math.round(pose.heading / (Math.PI / 2)) - frame.heading, 4);
    return {...point, direction, lane: Math.abs(point.x - 2) < 1 ? 0 : Math.abs(point.x - 6) < 1 ? 1 : -1};
  }
  populate() {
    for (let i = 0; i < 9; i++) this.addVehicle(50 + i * 34, i % 2);
    for (let i = 0; i < 5; i++) this.addVehicle(25 + i * 65, -1, true);
    this.populatedRoads.add('N:0');
  }
  addVehicle(s, lane = 1, opposite = false, kind = 'car', frame = this.frame) {
    const v = {id: this.nextId++, frame: {...frame}, s, lane,
      x: opposite ? (this.random() > .5 ? -6 : -2) : LANES[lane],
      speed: opposite ? 9 : 5 + this.random() * 5, cruise: kind === 'ambulance' ? 18 : 7 + this.random() * 5,
      opposite, kind, color: Math.floor(this.random() * 5)};
    this.vehicles.push(v); return v;
  }
  ensureNeighborhood() {
    if (this.density < 0) return;
    const p = this.pose, ix = Math.round(p.east / 160), iy = Math.round((p.north - 100) / 160);
    for (let d = -1; d <= 1; d++) for (const axis of ['N', 'E']) {
      const index = (axis === 'N' ? ix : iy) + d, key = `${axis}:${index}`;
      const frame = axis === 'N' ? {east: index * 160, north: 0, heading: 0, offset: 100}
        : {east: 0, north: 100 + index * 160, heading: 1, offset: 0};
      const along = localPoint(frame, p).s;
      const near = this.vehicles.filter(v => v.roadKey === key || (key === 'N:0' && !v.roadKey)).length;
      if (!this.populatedRoads.has(key) || near < Math.max(2, this.density)) {
        const count = this.populatedRoads.has(key) ? 1 : Math.max(4, this.density + 1);
        for (let i = 0; i < count; i++) {
          const pos = along + (count === 1 ? 260 : -190 + i * 68 + this.random() * 22);
          const v = this.addVehicle(pos, i % 2, count === 1 ? this.random() > .5 : i % 3 === 0, 'car', frame);
          v.roadKey = key;
          // Never spawn into the ego or another actor on an already visible road.
          const vp = this.actorPose(v);
          if (Math.hypot(vp.east - p.east, vp.north - p.north) < 35 || this.vehicles.some(o => o !== v && Math.hypot(this.actorPose(o).east - vp.east, this.actorPose(o).north - vp.north) < 8)) this.vehicles.pop();
        }
        this.populatedRoads.add(key);
      }
    }
    for (const key of this.populatedRoads) {
      const [axis, n] = key.split(':');
      if (Math.abs(Number(n) - (axis === 'N' ? ix : iy)) > 3) this.populatedRoads.delete(key);
    }
  }
  inject(kind) {
    if (this.turn && kind !== 'red') { this.event('Finish the turn before adding a road event'); return; }
    if (kind === 'pedestrian') {
      this.pedestrians.push({id: this.nextId++, frame: {...this.frame}, s: this.s + Math.max(32, this.stoppingDistance + 16), x: 10, dir: -1, speed: 1.35});
      this.event('Pedestrian entering the road ahead');
    } else if (kind === 'barrier') {
      this.obstacles.push({id: this.nextId++, frame: {...this.frame}, s: this.s + Math.max(55, this.stoppingDistance + 25), lane: this.lane, x: LANES[this.lane], until: this.time + 70});
      this.event('Roadworks blocking your lane');
    } else if (kind === 'slow_car') {
      const v = this.addVehicle(this.s + 43, this.lane); v.speed = 5; v.cruise = 5;
      this.event('Slow vehicle ahead · 18 km/h');
    } else if (kind === 'ambulance') {
      this.addVehicle(this.s - 48, 0, false, 'ambulance'); this.event('Ambulance approaching from behind');
    } else if (kind === 'red') {
      this.override = {key: this.signal.key, until: this.time + 16}; this.event('Next signal held red for 16 seconds');
    }
    this.lastDecisionAt = -100;
  }
  setRouteRequest(request) {
    this.routeRequest = request;
    this.routeRequestVersion = (this.routeRequestVersion || 0) + 1;
    if (!this.turn && this.signal.distance > 35) {this.plan = null; this.routeEpoch++;}
    this.event(request === 'auto' ? 'Jev will explore different streets' : `Requested next available ${request} route`);
  }
  laneGaps(lane) {
    const visible = this.environment.visibility * (this.night ? .7 : 1);
    let ahead = visible, behind = visible, frontSpeed = 50 / 3.6, rearSpeed = 0, frontId = null;
    for (const item of [...this.vehicles, ...this.obstacles]) {
      const local = this.localActor(item);
      if (local.direction !== 0 || local.lane !== lane) continue;
      const d = local.s - this.s;
      if (Math.abs(d) > visible) continue;
      if (d >= 0 && d - 5 < ahead) {ahead = Math.max(0, d - 5); frontSpeed = item.speed || 0; frontId = item.id;}
      if (d < 0 && -d - 5 < behind) {behind = Math.max(0, -d - 5); rearSpeed = item.speed || 0;}
    }
    const duration = 4 / (1.6 * this.environment.grip * Math.max(.3, Math.min(1, this.speed / 4)));
    const predictedAhead = ahead - Math.max(0, this.speed - frontSpeed) * duration;
    const predictedBehind = behind - Math.max(0, rearSpeed - this.speed) * duration;
    return {lane, gap_ahead_m: ahead, gap_behind_m: behind, lead_speed_kmh: frontSpeed * 3.6,
      rear_speed_kmh: rearSpeed * 3.6, safe_to_enter: ahead > 12 && behind > 15 && predictedAhead > 10 && predictedBehind > 12,
      frontId};
  }
  get laneChangeAllowed() {
    return !this.turn && !this.signalInside && this.signal.distance > Math.max(12, this.speed * 2) && this.time - this.laneChangedAt > 2;
  }
  get signalInside() { return this.signal.distance < 0; }
  get overtaking() {
    const own = this.laneGaps(this.lane), right = this.laneGaps(1);
    const free = this.weather === 'clear' && !this.night ? 50 : this.weather === 'rain' ? 35 : 22;
    const lead = this.vehicles.find(v => v.id === own.frontId);
    const leadLocal = lead && this.localActor(lead);
    const queuing = leadLocal && this.signal.color !== 'green' && this.signal.center - leadLocal.s < 36;
    const nearTurn = this.plan && this.plan.direction !== 'straight' && this.signal.distance < 65;
    const passed = this.passing && this.vehicles.find(v => v.id === this.passing.id);
    const passedLocal = passed && this.localActor(passed);
    const passedClear = !!this.passing && (!passedLocal || passedLocal.direction !== 0 || passedLocal.s < this.s - 24);
    return {active: !!this.passing, passed_clear: passedClear,
      lead_gap_m: own.gap_ahead_m, lead_speed_kmh: own.lead_speed_kmh,
      beneficial: !!lead && own.gap_ahead_m < 72 && own.lead_speed_kmh < free - 7 && !queuing && !nearTurn,
      right_lane_clear: right.safe_to_enter && right.gap_ahead_m > 45,
      lane_change_allowed: this.laneChangeAllowed};
  }
  turnSpeed(turn) { return Math.min(22 / 3.6, Math.sqrt(2.8 * turn.radius * this.environment.grip)); }
  navigation() {
    const sig = this.signal;
    const options = ['straight', 'left', 'right'].map(direction => {
      const frame = outgoingFrame(this.frame, sig.center, direction);
      const outgoing = this.vehicles.map(v => ({v, local: this.localActor(v, frame)}))
        .filter(({local}) => local.direction === 0 && local.lane >= 0 && local.s > 14 && local.s < 135);
      return {direction, street: streetName(frame), vehicles_ahead: outgoing.length,
        visits: this.visits.get(`${sig.key}:${frame.heading}`) || 0};
    });
    const preferred = ['right', 'left', 'straight'][this.junctions % 3];
    const ranked = [...options].sort((a,b) => a.visits - b.visits || a.vehicles_ahead - b.vehicles_ahead || (a.direction === preferred ? -1 : b.direction === preferred ? 1 : 0));
    const maneuver = this.turn || (this.plan && this.plan.direction !== 'straight' ? turnGeometry(this.frame, sig.center, this.plan.direction) : null);
    const conflicts = maneuver ? this.turnHazards(maneuver) : [];
    const turnClear = conflicts.length === 0;
    return {current_street: streetName(this.frame), heading: DIRECTIONS[this.frame.heading],
      planned_direction: this.plan?.direction || 'undecided', requested_direction: this.routeRequest,
      preferred_direction: this.routeRequest === 'auto' ? ranked[0].direction : this.routeRequest,
      required_lane: this.plan?.direction === 'left' ? 0 : this.plan?.direction === 'right' ? 1 : -1,
      turning: !!this.turn, turn_clear: turnClear, turn_conflict_distance_m: conflicts[0]?.distance_m ?? null, options};
  }
  observe() {
    const sig = this.signal, visibility = this.environment.visibility * (this.night ? .7 : 1), users = [];
    for (const v of this.vehicles) {
      const local = this.localActor(v);
      if (Math.hypot(local.s - this.s, local.x - this.x) > visibility) continue;
      const crossing = local.direction % 2 === 1;
      if (!crossing && (local.direction !== 0 || local.lane < 0)) continue;
      if (crossing && (Math.abs(local.x) > 28 || Math.abs(local.s - sig.center) > 18)) continue;
      users.push({kind: crossing ? 'cross_traffic' : v.kind, distance_m: local.s - this.s - (local.s > this.s ? 4.8 : -4.8),
        lane: crossing ? -1 : local.lane, speed_kmh: v.speed * 3.6, crossing});
    }
    for (const p of this.pedestrians) {
      const local = this.localActor(p);
      if (local.s < this.s - 3 || local.s - this.s > visibility || Math.abs(local.x) > 9) continue;
      users.push({kind: 'pedestrian', distance_m: local.s - this.s - 2.8, lane: local.x > 4 ? 1 : local.x > 0 ? 0 : -1, speed_kmh: p.speed * 3.6, crossing: true});
    }
    for (const o of this.obstacles) {
      const local = this.localActor(o);
      if (local.direction !== 0 || local.lane < 0 || local.s < this.s - 3 || local.s - this.s > visibility) continue;
      users.push({kind: 'barrier', distance_m: local.s - this.s - 3, lane: local.lane, speed_kmh: 0, crossing: false});
    }
    return {ego: {speed_kmh: this.speed * 3.6, lane: this.lane,
      changing_lane: Math.abs(this.x - LANES[this.targetLane]) > .25, stopping_distance_m: this.stoppingDistance},
      environment: {weather: this.weather, time_of_day: this.night ? 'night' : 'day', visibility_m: visibility, grip: this.environment.grip, speed_limit_kmh: 50},
      signal: {color: sig.color, stop_line_distance_m: sig.distance, changes_in_s: sig.remaining, in_intersection: sig.distance < 0 || !!this.turn, ...this.signalApproach},
      road_users: (this.turn ? this.turnHazards(this.turn).map(({kind,distance_m,speed_kmh,crossing}) => ({kind,distance_m,speed_kmh,crossing,lane:this.lane})) : users).sort((a,b) => Math.abs(a.distance_m) - Math.abs(b.distance_m)).slice(0,40),
      lanes: [0,1].map(i => {const {frontId, ...lane} = this.laneGaps(i); return lane;}),
      navigation: this.navigation(), overtaking: this.overtaking};
  }
  applyDecision(answers) {
    const route = answers.route?.choice;
    if (!this.plan && !this.turn && ['straight','left','right'].includes(route) && this.signal.distance > 25) {
      const sig = this.signal, frame = outgoingFrame(this.frame, sig.center, route);
      this.plan = {direction: route, key: sig.key, center: sig.center, requestVersion: this.routeRequestVersion || 0};
      this.event(`Jev route: ${route} onto ${streetName(frame)}`, 'jev');
    }
    this.pace = answers.pace.choice;
    this.targetSpeed = (this.pace === 'approach' ? this.signalApproach.approach_speed_kmh : PACES[this.pace]) / 3.6;
    const lane = answers.lane.choice === 'left' ? 0 : answers.lane.choice === 'right' ? 1 : this.targetLane;
    const overtaking = this.overtaking;
    if (lane !== this.targetLane && Math.abs(this.x - LANES[this.targetLane]) < .25) {
      const cutBack = lane === 1 && this.passing && !overtaking.passed_clear && this.plan?.direction !== 'right';
      if (this.laneGaps(lane).safe_to_enter && this.laneChangeAllowed && !cutBack) {
        if (lane === 0 && overtaking.beneficial && this.plan?.direction !== 'left') {
          this.passing = {id: this.laneGaps(1).frontId}; this.event('Passing slower traffic on the left', 'jev');
        }
        if (lane === 1 && this.passing && overtaking.passed_clear) {this.passes++; this.passing = null; this.event('Pass complete · returning to the travel lane', 'jev');}
        this.targetLane = lane; this.laneChangedAt = this.time;
      } else this.event('Lane change held: gap, closing traffic, or junction clearance', 'shield');
    }
    this.lastDecisionAt = this.time;
  }
  turnFootprintsOverlap(path, actor, kind) {
    const width = kind === 'pedestrian' ? .3 : kind === 'barrier' ? 1.3 : .9;
    const length = kind === 'pedestrian' ? .3 : kind === 'barrier' ? .25 : 2.1;
    const forward=h=>({e:Math.sin(h),n:Math.cos(h)}),right=h=>({e:Math.cos(h),n:-Math.sin(h)});
    const pf=forward(path.heading),pr=right(path.heading),af=forward(actor.heading),ar=right(actor.heading);
    for(const axis of [pf,pr,af,ar]){
      const dot=v=>Math.abs(v.e*axis.e+v.n*axis.n);
      // Small clearance around the ego footprint, without treating the adjacent lane as occupied.
      if(Math.abs((actor.east-path.east)*axis.e+(actor.north-path.north)*axis.n) >
        2.6*dot(pf)+1.25*dot(pr)+length*dot(af)+width*dot(ar))return false;
    }
    return true;
  }
  turnHazards(turn) {
    // Measure conflicts along the remaining arc and its exit, never the old approach road.
    const remaining = turn.length - turn.progress, speed = Math.max(this.speed, this.turnSpeed(turn) * .7);
    const hazards = [];
    const actors = [...this.vehicles.map(actor => ({actor, kind:actor.kind || 'car'})),
      ...this.pedestrians.map(actor => ({actor, kind:'pedestrian'})),
      ...this.obstacles.map(actor => ({actor, kind:'barrier'}))];
    for (const {actor,kind} of actors) {
      const current = this.actorPose(actor), b = basis(Math.round(current.heading / (Math.PI / 2)));
      for (let travel = 0; travel <= remaining + 15; travel += 1) {
        const path = travel <= remaining ? turnPose(turn, turn.progress + travel)
          : {...worldPoint(turn.exitFrame, LANES[turn.lane], 14 + travel - remaining), heading:turn.exitFrame.heading * Math.PI / 2};
        const seconds = travel / speed;
        const future = kind === 'pedestrian'
          ? worldPoint(actor.frame || this.frame, actor.x + actor.dir * actor.speed * seconds, actor.s)
          : {east:current.east + b.fe * (actor.speed || 0) * seconds, north:current.north + b.fn * (actor.speed || 0) * seconds};
        if (this.turnFootprintsOverlap(path,current,kind) ||
          this.turnFootprintsOverlap(path,{...future,heading:current.heading},kind)) {
          hazards.push({kind, distance_m:travel, speed_kmh:(actor.speed || 0)*3.6, crossing:kind==='pedestrian' || (Math.round(current.heading / (Math.PI / 2)) - turn.exitFrame.heading) % 2 !== 0});
          break;
        }
      }
    }
    return hazards.sort((a,b)=>a.distance_m-b.distance_m);
  }
  turnConflict(turn) {
    const first = this.turnHazards(turn)[0];
    return !first ? '' : first.kind === 'barrier' ? 'Turn exit blocked'
      : first.kind === 'pedestrian' ? 'Yielding before turn: pedestrian crossing' : 'Yielding before turn: vehicle conflict';
  }
  danger() {
    let nearest = Infinity, reason = '';
    const consider = (distance, text) => {if (distance >= -1 && distance < nearest) {nearest = distance; reason = text;}};
    const sig = this.signal;
    if (!this.turn && sig.color !== 'green' && sig.distance >= -1) consider(sig.distance, 'Signal protection');
    for (const v of this.vehicles) {
      const local = this.localActor(v);
      if (local.direction === 0 && Math.abs(local.x - this.x) < 2.1) consider(local.s - this.s - 5, 'Following distance');
      if (local.direction % 2 && Math.abs(local.x - this.x) < 7) consider(local.s - this.s - 5, 'Cross-traffic protection');
    }
    for (const o of this.obstacles) {const l=this.localActor(o);if(Math.abs(l.x-this.x)<2.2)consider(l.s-this.s-3.5,'Roadwork protection');}
    for (const p of this.pedestrians) {const l=this.localActor(p);if(Math.abs(l.x)<8.8)consider(l.s-this.s-3.5,'Pedestrian protection');}
    return {distance: nearest, reason};
  }
  stepTraffic(dt) {
    this.ensureNeighborhood();
    const ego = this.pose;
    for (const v of this.vehicles) {
      const frame = v.frame || this.frame;
      const motion = v.opposite ? {...frame, heading: mod(frame.heading + 2,4), offset: -frame.offset} : frame;
      const vs = v.opposite ? -v.s : v.s, vx = v.opposite ? -v.x : v.x;
      let target = v.cruise ?? v.speed;
      const sig = this.signalFor(motion, vs);
      if (sig.color !== 'green' && sig.distance >= -1) target = Math.min(target, Math.sqrt(2 * this.braking * Math.max(0, sig.distance - 1)));
      for (const o of [...this.vehicles, ...this.obstacles]) {
        if (o === v) continue;
        const l = localPoint(motion, this.actorPose(o)), gap = l.s - vs;
        if (Math.abs(l.x - vx) < 2.2 && gap > 0 && gap < 45) target = Math.min(target, Math.max(0,(gap-7)*.5));
      }
      const ep = localPoint(motion,ego), gap = ep.s-vs;
      if(Math.abs(ep.x-vx)<2.2&&gap>0&&gap<45)target=Math.min(target,Math.max(0,(gap-7)*.5));
      for(const p of this.pedestrians){const l=localPoint(motion,this.actorPose(p));if(Math.abs(l.x)<9&&l.s>vs&&l.s-vs<30)target=Math.min(target,Math.sqrt(2*this.braking*Math.max(0,l.s-vs-5)));}
      v.speed = Math.max(0,v.speed+clamp(target-v.speed,-this.braking*dt,2.2*dt));
      v.s += v.speed * dt * (v.opposite ? -1 : 1);
    }
    this.vehicles = this.vehicles.filter(v=>{const p=this.actorPose(v);return Math.hypot(p.east-ego.east,p.north-ego.north)<490;});
    const ix=Math.round(ego.east/160),iy=Math.round((ego.north-100)/160);
    for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){
      const point={east:(ix+i)*160,north:100+(iy+j)*160};
      const phase=mod(this.time+(ix+i)*5+(iy+j)*7,36),cycle=Math.floor((this.time+(ix+i)*5+(iy+j)*7)/36);
      const key=junctionKey(point);
      if(phase>23&&phase<24&&this.lastPedCycle.get(key)!==cycle){
        this.lastPedCycle.set(key,cycle);
        this.pedestrians.push({id:this.nextId++,frame:{...point,heading:0,offset:0},s:-10,x:-10,dir:1,speed:1.7});
      }
    }
    for(const p of this.pedestrians)p.x+=p.dir*p.speed*dt;
    this.pedestrians=this.pedestrians.filter(p=>Math.abs(p.x)<11);
    this.obstacles=this.obstacles.filter(o=>o.until>this.time);
    for(const key of this.lastPedCycle.keys()){const [i,j]=key.split(',').map(Number);if(Math.abs(i-ix)>2||Math.abs(j-iy)>2)this.lastPedCycle.delete(key);}
  }
  finishJunction(direction, key, newFrame=null) {
    const heading=newFrame?.heading??this.frame.heading;
    const visitKey=`${key}:${heading}`;this.visits.set(visitKey,(this.visits.get(visitKey)||0)+1);
    if(this.visits.size>200)this.visits.delete(this.visits.keys().next().value);
    this.junctions++;
    if(newFrame){
      this.frame=newFrame;this.s=14;this.x=LANES[this.turn.lane];this.targetLane=this.turn.lane;
      this.turn=null;this.turns++;this.passing=null;
      this.event(`Turned ${direction} · ${DIRECTIONS[this.frame.heading]} on ${streetName(this.frame)}`,'jev');
    }
    if(this.routeRequest!=='auto' && this.plan?.requestVersion === (this.routeRequestVersion || 0))this.routeRequest='auto';
    this.plan=null;this.routeEpoch++;
    // Keep the recent pace through the exit; the normal freshness watchdog still applies.
  }
  step(dt) {
    if(this.halted)return;
    this.time+=dt;this.stepTraffic(dt);
    const sig=this.signal;
    if(this.plan&&this.plan.key!==sig.key&&!this.turn)this.finishJunction('straight',this.plan.key);
    if(this.passing){const v=this.vehicles.find(v=>v.id===this.passing.id);if(v&&this.localActor(v).direction!==0)this.passing=null;}
    if(this.pace==='approach')this.targetSpeed=this.signalApproach.approach_speed_kmh/3.6;
    else this.targetSpeed=PACES[this.pace]/3.6;
    let target=this.targetSpeed;this.intervention='';
    if(this.time-this.lastDecisionAt>2.5){target=0;this.intervention='Waiting for fresh Jev decision';}
    const plannedTurn=this.plan&&this.plan.direction!=='straight';
    if(plannedTurn||this.turn){
      const maneuver=this.turn || turnGeometry(this.frame,sig.center,this.plan.direction);
      const turnSpeed=this.turnSpeed(maneuver),entryDistance=Math.max(0,sig.center-14-this.s-this.speed*.8);
      target=Math.min(target,this.turn?turnSpeed:Math.sqrt(turnSpeed**2+5*this.environment.grip*entryDistance));
      this.targetSpeed=Math.min(this.targetSpeed,target);
      if(!this.turn&&sig.distance<16){
        const lane=this.plan.direction==='left'?0:1;
        if(Math.abs(this.x-LANES[lane])>.3){
          // No last-second cuts across lanes: carry on and ask Jev again next block.
          this.event('Turn skipped: required lane not reached in time','shield');this.plan.direction='straight';
        }else{
          const conflict=this.turnConflict(turnGeometry(this.frame,sig.center,this.plan.direction));
          if(conflict){target=Math.min(target,Math.sqrt(2*this.braking*Math.max(0,sig.distance-1.5)));this.intervention=conflict;}
        }
      }
    }
    const hazard=this.danger();
    if(!this.turn&&this.shield&&hazard.distance<this.speed**2/(2*this.braking)+this.speed*.35+3){
      target=Math.min(target,Math.sqrt(2*this.braking*Math.max(0,hazard.distance-1.5)));
      if(target<this.targetSpeed-.1)this.intervention=hazard.reason;
    }
    if(this.turn){
      const conflict=this.turnHazards(this.turn)[0];
      if(conflict){
        const cap=Math.sqrt(2*this.braking*Math.max(0,conflict.distance_m-.5));
        if(cap<target){target=cap;this.intervention='Turn conflict protection';}
      }
    }
    if(this.intervention&&this.intervention!==this.lastIntervention&&!this.intervention.startsWith('Waiting')){this.interventions++;this.event(this.intervention,'shield');}
    this.lastIntervention=this.intervention;
    const deceleration=this.pace==='stop'||this.intervention?this.braking:2.5*this.environment.grip;
    this.speed=Math.max(0,this.speed+clamp(target-this.speed,-deceleration*dt,2.4*this.environment.grip*dt));
    const travel=this.speed*dt,previous=this.s;
    this.distance+=travel;
    if(this.turn){
      this.turn.progress=Math.min(this.turn.length,this.turn.progress+travel);
      if(this.turn.progress>=this.turn.length){const t=this.turn;this.finishJunction(t.direction,junctionKey(worldPoint(t.frame,0,t.center)),t.exitFrame);}
    }else{
      this.s+=travel;
      const lateral=1.6*this.environment.grip*Math.min(1,this.speed/4)*dt;
      this.x+=clamp(LANES[this.targetLane]-this.x,-lateral,lateral);
      if(previous<sig.center-16.3&&this.s>=sig.center-16.3&&sig.color==='red'&&this.lastViolation!==sig.key){this.redLights++;this.lastViolation=sig.key;this.event('Red-light violation recorded','danger');}
      if(this.plan&&this.plan.direction!=='straight'&&this.s>=sig.center-14&&previous<sig.center-14){
        const lane=this.plan.direction==='left'?0:1;
        if(Math.abs(this.x-LANES[lane])<.3){this.turn=turnGeometry(this.frame,sig.center,this.plan.direction);this.turn.progress=this.s-(sig.center-14);this.s=sig.center-14;this.routeEpoch++;}
      }
    }
    if(this.distance-this.lastTrailDistance>2){this.trail.push({...this.pose});if(this.trail.length>500)this.trail.shift();this.lastTrailDistance=this.distance;}
    this.checkCollisions();
  }
  checkCollisions(){
    const ego=this.pose;
    const overlap=(p,width,length)=>{
      // Separating-axis test for oriented rectangles in the road plane.
      const axes=[ego.heading,p.heading];
      const ef={e:Math.sin(ego.heading),n:Math.cos(ego.heading)},er={e:Math.cos(ego.heading),n:-Math.sin(ego.heading)};
      const pf={e:Math.sin(p.heading),n:Math.cos(p.heading)},pr={e:Math.cos(p.heading),n:-Math.sin(p.heading)};
      for(const h of axes)for(const axis of [{e:Math.sin(h),n:Math.cos(h)},{e:Math.cos(h),n:-Math.sin(h)}]){
        const dot=v=>v.e*axis.e+v.n*axis.n;
        if(Math.abs((p.east-ego.east)*axis.e+(p.north-ego.north)*axis.n)>=2.1*Math.abs(dot(ef))+.9*Math.abs(dot(er))+length*Math.abs(dot(pf))+width*Math.abs(dot(pr)))return false;
      }
      return true;
    };
    if(this.vehicles.some(v=>overlap(this.actorPose(v),.9,2.1))||this.pedestrians.some(p=>overlap(this.actorPose(p),.3,.3))||this.obstacles.some(o=>overlap(this.actorPose(o),1.3,.25))){
      this.collisions++;this.speed=0;this.halted=true;this.event('Collision detected. Reset to start a new drive.','danger');
    }
  }
}
