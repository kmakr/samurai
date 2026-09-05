export const GARDEN_PLANTERS = Object.freeze([-10,10].map(x=>({x,z:0,hx:1.5,hz:6.5})));

export function segmentBlocked(a,b,rectangles,radius=.8) {
  for(const o of rectangles){
    let lo=0,hi=1;
    for(const axis of ['x','z']){
      const half=(axis==='x'?o.hx:o.hz)+radius-.001;
      const min=o[axis]-half,max=o[axis]+half,d=b[axis]-a[axis];
      if(Math.abs(d)<1e-8){if(a[axis]<=min||a[axis]>=max){lo=2;break;}}
      else {const t1=(min-a[axis])/d,t2=(max-a[axis])/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));}
    }
    if(lo<hi&&lo<1&&hi>0)return true;
  }
  return false;
}

// A tiny visibility graph around the two planted islands. Real path corners
// avoid the permanent straight-line stall that clamping alone would cause.
export function courtWaypoint(start,goal,rectangles,radius=.8) {
  // A smaller opponent may stand closer to a planter than this actor can.
  // Approach the nearest reachable edge, rather than pathfinding to a point
  // inside our own clearance rectangle and falling back to a blocked line.
  for(const o of rectangles){
    const hx=o.hx+radius+.02,hz=o.hz+radius+.02,dx=goal.x-o.x,dz=goal.z-o.z;
    if(Math.abs(dx)<hx&&Math.abs(dz)<hz){
      goal=hx-Math.abs(dx)<hz-Math.abs(dz)?{x:o.x+Math.sign(dx||1)*hx,z:goal.z}:{x:goal.x,z:o.z+Math.sign(dz||1)*hz};
    }
  }
  if(!rectangles.length||!segmentBlocked(start,goal,rectangles,radius))return goal;
  const nodes=[start,goal];
  for(const o of rectangles)for(const x of [-1,1])for(const z of [-1,1])nodes.push({x:o.x+x*(o.hx+radius+.08),z:o.z+z*(o.hz+radius+.08)});
  const distance=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),visited=new Set();distance[0]=0;
  for(let pass=0;pass<nodes.length;pass++){
    let index=-1;for(let i=0;i<nodes.length;i++)if(!visited.has(i)&&(index<0||distance[i]<distance[index]))index=i;
    if(index<0||!Number.isFinite(distance[index])||index===1)break;visited.add(index);
    for(let next=1;next<nodes.length;next++){
      if(visited.has(next)||next===index||segmentBlocked(nodes[index],nodes[next],rectangles,radius))continue;
      const cost=distance[index]+Math.hypot(nodes[next].x-nodes[index].x,nodes[next].z-nodes[index].z);
      if(cost<distance[next]){distance[next]=cost;previous[next]=index;}
    }
  }
  let index=1;if(previous[index]<0)return goal;
  while(previous[index]>0)index=previous[index];return nodes[index];
}
