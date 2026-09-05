// Shared world-space limits for the authored courtyard. Keep gameplay clear of
// the architecture; all elevations in the fighting area remain at ground zero.
export const COURT = Object.freeze({ halfX: 18, halfZ: 16, cameraX: 5, cameraZ: 4 });
export const COURT_LANTERNS = [[-16.3,-11.4],[16.3,-11.4],[-16,13.4],[16,13.4]];
export const COURT_SUPPLIES = [[-16,-14],[15,-14],[-16,14],[16,11]];
// Rectangles include plinths and crate corners, not just their visual centres.
export const COURT_OBSTACLES = [
  ...COURT_LANTERNS.map(([x,z])=>({x,z,hx:.75,hz:.75})),
  ...COURT_SUPPLIES.map(([x,z])=>({x,z:z+.4,hx:1.02,hz:1.21})),
];

export function constrainToCourt(position, radius = .65) {
  position.x = Math.max(-COURT.halfX + radius, Math.min(COURT.halfX - radius, position.x));
  position.z = Math.max(-COURT.halfZ + radius, Math.min(COURT.halfZ - radius, position.z));
  const overlaps=(p,o)=>Math.abs(p.x-o.x)<o.hx+radius-1e-8&&Math.abs(p.z-o.z)<o.hz+radius-1e-8;
  if(!COURT_OBSTACLES.some(o=>overlaps(position,o)))return position;
  // Find a face outside the whole cluster, so adjacent plinths cannot bounce
  // a character between two overlapping collision boundaries.
  let nearest=null,distance=Infinity;
  for(const o of COURT_OBSTACLES){
    const hx=o.hx+radius,hz=o.hz+radius;
    const faces=[{x:o.x-hx,z:position.z},{x:o.x+hx,z:position.z},{x:position.x,z:o.z-hz},{x:position.x,z:o.z+hz}];
    for(const p of faces){
      if(Math.abs(p.x)>COURT.halfX-radius||Math.abs(p.z)>COURT.halfZ-radius)continue;
      if(COURT_OBSTACLES.some(other=>overlaps(p,other)))continue;
      const d=Math.abs(p.x-position.x)+Math.abs(p.z-position.z);
      if(d<distance){nearest=p;distance=d}
    }
  }
  if(nearest){position.x=nearest.x;position.z=nearest.z}
  return position;
}

export function courtSpawn(center, radius, angle) {
  let best = null, distance = -1;
  // At an edge, find an entry direction with space rather than materialising
  // the enemy directly on the player after a clamp.
  for (let i = 0; i < 8; i++) {
    const a = angle + i * Math.PI / 4;
    const p = constrainToCourt({x:center.x+Math.cos(a)*radius,z:center.z+Math.sin(a)*radius},1.25);
    const d = Math.hypot(p.x-center.x,p.z-center.z);
    if (d > distance) { best=p; distance=d; }
    if (d >= Math.min(radius*.85,10)) return p;
  }
  return best;
}
