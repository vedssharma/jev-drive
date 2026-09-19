// World coordinates: east and north in meters; headings clockwise from north.
export const BLOCK = 160;
export const DIRECTIONS = ['Northbound', 'Eastbound', 'Southbound', 'Westbound'];
export const INITIAL_FRAME = Object.freeze({east: 0, north: 0, heading: 0, offset: 100});
export const mod = (x, n) => ((x % n) + n) % n;
export function basis(heading) {
  const h = heading * Math.PI / 2;
  return {fe: Math.round(Math.sin(h)), fn: Math.round(Math.cos(h)), re: Math.round(Math.cos(h)), rn: -Math.round(Math.sin(h))};
}
export function worldPoint(frame, x, s) {
  const b = basis(frame.heading);
  return {east: frame.east + b.fe * s + b.re * x, north: frame.north + b.fn * s + b.rn * x};
}
export function localPoint(frame, point) {
  const b = basis(frame.heading), de = point.east - frame.east, dn = point.north - frame.north;
  return {x: de * b.re + dn * b.rn, s: de * b.fe + dn * b.fn};
}
export function junctionKey(point) { return `${Math.round(point.east / BLOCK)},${Math.round((point.north - 100) / BLOCK)}`; }
export function streetName(frame) {
  const avenues = ['Linden Avenue', 'Cedar Avenue', 'Willow Avenue', 'Ash Avenue', 'Birch Avenue'];
  const streets = ['Market Street', 'Harbor Street', 'Garden Street', 'Station Street', 'Park Street'];
  return frame.heading % 2 === 0 ? avenues[mod(Math.round(frame.east / BLOCK), avenues.length)]
    : streets[mod(Math.round((frame.north - 100) / BLOCK), streets.length)];
}
export function nextCenter(s, offset = 100) { return offset + Math.ceil((s - offset - 16) / BLOCK) * BLOCK; }
export function junctionSignal(point, heading, time, forced = null) {
  const i = Math.round(point.east / BLOCK), j = Math.round((point.north - 100) / BLOCK);
  const phase = mod(time + i * 5 + j * 7, 36);
  if (forced && forced.key === junctionKey(point) && time < forced.until) {
    return {color: 'red', remaining: forced.until - time};
  }
  if (heading % 2 === 0) return phase < 19 ? {color: 'green', remaining: 19 - phase}
    : phase < 22 ? {color: 'amber', remaining: 22 - phase} : {color: 'red', remaining: 36 - phase};
  return phase < 24 ? {color: 'red', remaining: 24 - phase}
    : phase < 32 ? {color: 'green', remaining: 32 - phase}
    : phase < 34 ? {color: 'amber', remaining: 34 - phase} : {color: 'red', remaining: 60 - phase};
}
export function outgoingFrame(frame, center, direction) {
  const p = worldPoint(frame, 0, center);
  return {...p, heading: mod(frame.heading + (direction === 'left' ? -1 : direction === 'right' ? 1 : 0), 4), offset: 0};
}
export function turnGeometry(frame, center, direction) {
  const radius = direction === 'right' ? 8 : 16;
  return {frame: {...frame}, center, direction, radius, length: radius * Math.PI / 2, progress: 0,
    exitFrame: outgoingFrame(frame, center, direction), lane: direction === 'right' ? 1 : 0};
}
export function turnPose(turn, progress = turn.progress) {
  const angle = Math.min(Math.PI / 2, Math.max(0, progress / turn.radius));
  const right = turn.direction === 'right';
  const x = right ? 14 - turn.radius * Math.cos(angle) : -14 + turn.radius * Math.cos(angle);
  const s = turn.center - 14 + turn.radius * Math.sin(angle);
  return {...worldPoint(turn.frame, x, s), heading: turn.frame.heading * Math.PI / 2 + (right ? angle : -angle)};
}
