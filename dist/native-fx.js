// Lightweight battle presentation. Animations follow simulation time; they never write combat state.
const GAP={deploy:.16,attack:.05,hit:.04,skill:.14,ammo:.08,'skill-start':.14,'skill-end':.12,control:.12,down:.2,leak:.28,impact:.06};
const TONE={deploy:430,attack:560,hit:190,skill:680,'skill-start':680,'skill-end':320,ammo:740,control:300,down:130,leak:90,impact:240};
let ctx=null,heard=-1,last={};

export function resetFxClock(){heard=-1;last={};}
export function unlockAudio(){try{ctx??=new AudioContext();if(ctx.state==='suspended')ctx.resume();}catch{}}
function beep(type,muted,volume){
 if(muted||volume<=0)return;
 try{ctx??=new AudioContext();if(ctx.state==='suspended')return;}catch{return;}
 const now=ctx.currentTime,gap=GAP[type]??.1;if(now-(last[type]||0)<gap)return;last[type]=now;
 const o=ctx.createOscillator(),g=ctx.createGain();
 o.type=type==='leak'||type==='down'?'triangle':'square';
 o.frequency.value=TONE[type]||400;
 g.gain.value=Math.min(.06,volume*.06);g.gain.exponentialRampToValueAtTime(.0001,now+.09);
 o.connect(g).connect(ctx.destination);o.onended=()=>{o.disconnect();g.disconnect();};o.start(now);o.stop(now+.1);
}
export function playBattleEvents(s,muted,volume=1){
 if(!s)return;
 for(const e of s.events||[])if((e.id??e.t)>heard&&e.t<=s.time)beep(e.type,muted,volume);
 heard=s.eventId??s.time;
}
export function recent(events,t,type,span=.22){return (events||[]).filter(e=>e.type===type&&t-e.t>=0&&t-e.t<=span);}
function mark(c,x,y,kind){
 c.save();c.translate(x,y);c.strokeStyle='#f4f0e4';c.fillStyle='#1a2420';c.lineWidth=1.4;
 if(kind==='stun'){c.beginPath();c.moveTo(-5,-6);c.lineTo(0,6);c.lineTo(5,-6);c.closePath();c.fill();c.stroke();}
 else if(kind==='frozen'){c.beginPath();c.moveTo(0,-7);c.lineTo(4,0);c.lineTo(0,7);c.lineTo(-4,0);c.closePath();c.fill();c.stroke();}
 else if(kind==='sleep'){c.font='9px sans-serif';c.fillStyle='#f4f0e4';c.fillText('Z',0,3);}
 else if(kind==='silence'){c.beginPath();c.arc(0,0,5,0,Math.PI*2);c.moveTo(-3,-3);c.lineTo(3,3);c.stroke();}
 else if(kind==='cold'){c.beginPath();c.moveTo(0,-6);c.lineTo(0,6);c.moveTo(-4,-3);c.lineTo(4,3);c.stroke();}
 else if(kind==='shield'){c.beginPath();c.moveTo(0,-6);c.lineTo(5,-2);c.lineTo(4,5);c.lineTo(0,7);c.lineTo(-4,5);c.lineTo(-5,-2);c.closePath();c.fill();c.stroke();}
 else if(kind==='barrier'){c.strokeRect(-5,-5,10,10);c.beginPath();c.moveTo(-5,0);c.lineTo(5,0);c.stroke();}
 else{c.fillRect(-4,-4,8,8);}
 c.restore();
}
export function actorOffset(u,battle){
 if(!u?.action||!u.lockId||u.action.kind==='reload'||u.action.kind==='charge')return {x:0,y:0};
 const t=(battle?.s.enemies.find(e=>e.uid===u.lockId)||battle?.s.units.find(v=>v.uid===u.lockId));
 if(!t)return {x:0,y:0};
 const d=Math.hypot(t.x-u.x,t.y-u.y)||1;return {x:(t.x-u.x)/d*.12,y:(t.y-u.y)/d*.12};
}
export function drawFx(c,point,z,battle,opts={}){
 const s=battle.s,t=s.time,reduce=!!opts.reduceFx;
 for(const p of s.projectiles||[]){
  const pos=point(p.x,p.y),arts=p.type==='arts',heal=p.type==='healing';
  c.save();c.translate(pos.x,pos.y);
  if(heal){c.strokeStyle='#8fe8b5';c.lineWidth=2;c.beginPath();c.moveTo(-6,0);c.lineTo(6,0);c.moveTo(0,-6);c.lineTo(0,6);c.stroke();}
  else if(arts){c.fillStyle='#cda8ff';c.beginPath();c.moveTo(0,-5);c.lineTo(4,0);c.lineTo(0,5);c.lineTo(-4,0);c.closePath();c.fill();}
  else{c.fillStyle='#fff0b1';c.beginPath();c.ellipse(0,0,6,2.4,Math.atan2(((s.enemies.find(e=>e.uid===p.target)||{}).y??p.y)-p.y,((s.enemies.find(e=>e.uid===p.target)||{}).x??p.x)-p.x)||0,0,Math.PI*2);c.fill();}
  c.restore();
 }
 for(const e of recent(s.events,t,'impact',.28)){
  if(!e.radius)continue;const p=point(e.x,e.y),r=e.radius*z.tw,fade=1-(t-e.t)/.28;
  c.strokeStyle=e.damageType==='arts'?`rgba(180,140,255,${.55*fade})`:`rgba(255,230,150,${.5*fade})`;c.lineWidth=2;c.beginPath();c.ellipse(p.x,p.y,r,e.radius*z.th,0,0,Math.PI*2);c.stroke();
 }
 for(const e of recent(s.events,t,'attack',.2)){
  if(e.kind!=='heal'){if(!reduce&&e.targetX!=null){const a=point(e.x,e.y),b=point(e.targetX,e.targetY);c.strokeStyle=e.damageType==='arts'?'#cda8ff':'#ffe6b1';c.lineWidth=2;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}continue;}const p=point(e.x,e.y);c.strokeStyle='#8fe8b5aa';c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,10+(t-e.t)*20,0,Math.PI*2);c.stroke();
 }
 for(const e of s.effects||[]){
  if(e.type!=='healing'&&e.type!=='evade'&&e.type!=='block')continue;
  const p=point(e.x,e.y);c.fillStyle=e.type==='healing'?'#8fe8b5':'#f6e7c8';c.font='12px sans-serif';c.textAlign='center';c.fillText(e.text,p.x,p.y-24-(.6-e.life)*30);
 }
 for(const e of recent(s.events,t,'deploy',.4)){const p=point(e.x,e.y);c.strokeStyle='#8fe8b5';c.lineWidth=2;c.beginPath();c.ellipse(p.x,p.y+8,reduce?12:12+18*(t-e.t),5,0,0,Math.PI*2);c.stroke();}
 for(const e of recent(s.events,t,'skill-end',.3)){const p=point(e.x,e.y);c.strokeStyle='#f4d38b';c.strokeRect(p.x-12,p.y-12,24,24);}
 for(const e of recent(s.events,t,'skill-start',.45)){
  const p=point(e.x,e.y),k=1-(t-e.t)/.45;c.strokeStyle=`rgba(244,211,139,${.8*k})`;c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,14+8*(1-k),0,Math.PI*2);c.stroke();c.fillStyle=`rgba(244,211,139,${.9*k})`;c.font='11px sans-serif';c.textAlign='center';c.fillText(e.name||'技能',p.x,p.y-22);
 }
 for(const e of recent(s.events,t,'leak',1.2)){
  const p=point(e.x,e.y);c.fillStyle='#ffb48c';c.font='bold 14px sans-serif';c.textAlign='center';c.fillText('漏怪',p.x,p.y-18);
 }
 if(s.banner){c.fillStyle='#081511cc';c.fillRect(z.r.width/2-90,12,180,28);c.fillStyle='#e9fff7';c.font='bold 14px sans-serif';c.textAlign='center';c.fillText(s.banner.text,z.r.width/2,32);}
 if(!reduce)for(const e of recent(s.events,t,'hit',.16)){const p=point(e.x,e.y);c.fillStyle='#fff8';c.beginPath();c.arc(p.x,p.y,11,0,Math.PI*2);c.fill();}
}
export function drawStatuses(c,x,y,unit,size){
 const kinds=[];
 for(const s of unit.statuses||[])if(['stun','frozen','sleep','silence','cold'].includes(s.kind)&&!kinds.includes(s.kind))kinds.push(s.kind);
 if((unit.shield||0)>0)kinds.push('shield');
 if((unit.barriers||[]).some(b=>b.charges>0))kinds.push('barrier');
 kinds.slice(0,3).forEach((k,i)=>mark(c,x-size/2+6+i*13,y-size*.82,k));
}
export function drawDownRing(c,p,u,size){
 const max=u.downMax||u.down||1,ratio=Math.max(0,Math.min(1,1-(u.down||0)/max));
 c.strokeStyle='#8eb4a7';c.lineWidth=2;c.beginPath();c.arc(p.x,p.y-size*.1,size*.42,-Math.PI/2, -Math.PI/2+ratio*Math.PI*2);c.stroke();
 c.fillStyle='#e9fff7';c.font='11px sans-serif';c.textAlign='center';c.fillText(Math.ceil(u.down||0)+'s',p.x,p.y+4);
}
