export class TechniqueState {
  constructor(){this.reset();}
  reset(){this.id='';this.rank=1;this.charge=0;this.marks=[];}
  select(id){if(!['reprisal','echo','thread'].includes(id))return false;this.reset();this.id=id;return true;}
  empower(){this.rank=Math.min(3,this.rank+1);}
  parry(){if(this.id==='reprisal')this.charge=Math.min(3,this.charge+1);}
  discharge(){if(this.id!=='reprisal')return 0;const count=this.charge;this.charge=0;return count;}
  mark(enemy){
    if(this.id!=='thread'||enemy.dead)return;
    const old=this.marks.find(m=>m.enemy===enemy);
    if(old){old.time=12;return;}
    if(this.marks.length===3)this.marks.shift();
    this.marks.push({enemy,time:12});
  }
  tick(dt){this.marks=this.marks.filter(m=>{m.time-=dt;return m.time>0&&!m.enemy.dead;});}
  takeMarks(exclude=new Set()){
    const targets=this.marks.map(m=>m.enemy).filter(e=>!e.dead&&!exclude.has(e));
    this.marks=[];return targets;
  }
}
