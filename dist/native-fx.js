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
 for(const e of s.events||[])if((e.id??e.t)>heard&&e.t<=s.time&&e.type!=='attack')beep(e.type==='strike'?'attack':e.type==='chain'||e.type==='aftershock'?'impact':e.type==='heal'?'skill':e.type,muted,volume);
 heard=s.eventId??s.time;
}
export function recent(events,t,type,span=.22){return (events||[]).filter(e=>e.type===type&&t-e.t>=0&&t-e.t<=span);}
// Visual categories describe existing attacks; rendering never applies damage.
export function attackVisual(p){
 if(p.enemy)return p.ranged?'enemy-shot':'enemy-melee';
 if(p.returns)return 'return';
 if(p.branch==='funnel')return 'drone';
 if(p.branch==='mystic')return 'stored';
 if(p.branch==='reaperrange')return 'scatter';
 if(p.style==='all')return p.ranged?'area':'sweep';
 if(p.ranged)return ['splash','aftershock','fortress'].includes(p.style)?'artillery':p.type==='arts'||p.damageType==='arts'?'arts':'bullet';
 if(['fighter','crusher','hammer'].includes(p.branch))return 'punch';
 if(['instructor','charger','duelist','agent'].includes(p.branch))return 'thrust';
 return p.style==='block-count'?'sweep':'slash';
}
function line(c,a,b){c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}
function cross(c,p,r=6){line(c,{x:p.x-r,y:p.y},{x:p.x+r,y:p.y});line(c,{x:p.x,y:p.y-r},{x:p.x,y:p.y+r});}
function ring(c,p,rx,ry){c.beginPath();c.ellipse(p.x,p.y,rx,ry,0,0,Math.PI*2);c.stroke();}
function drawCombatFx(c,point,z,battle,reduce){
 const s=battle.s,t=s.time;
 c.save();c.lineCap='round';
 for(const u of s.units){
  if(!u.deployed||u.hp<=0)continue;
  const behavior=battle.behavior(u),p=point(u.x,u.y),pulse=reduce?0:Math.sin(t*3)*2;
  if(behavior.kind==='regeneration'){
   c.strokeStyle='#8fe8b54d';c.lineWidth=1;
   for(const cell of battle.range(u,battle.skillActive(u))){const a=point(cell.x,cell.y);c.strokeRect(a.x-z.tw*.47,a.y-z.th*.47,z.tw*.94,z.th*.94);}
   c.strokeStyle='#8fe8b5';ring(c,p,18+pulse,8);cross(c,{x:p.x,y:p.y-27},4);
  }
  if(behavior.drone){
   const a=reduce?0:t*1.7,q={x:p.x+Math.cos(a)*22,y:p.y-27+Math.sin(a)*6};
   c.strokeStyle='#bdadff';c.lineWidth=2;ring(c,q,5,3);line(c,{x:q.x-8,y:q.y-3},{x:q.x+8,y:q.y-3});
  }
  if(behavior.storage){c.fillStyle='#cda8ff';for(let i=0;i<(u.energy||0);i++){c.beginPath();c.arc(p.x-10+i*10,p.y-30,3,0,Math.PI*2);c.fill();}}
  if(behavior.magazine){c.fillStyle='#ffe6a4';for(let i=0;i<Math.min(12,u.magazine||0);i++)c.fillRect(p.x-18+i*4,p.y+17,2,5);if(u.action?.kind==='reload'){c.strokeStyle='#ffe6a4';ring(c,p,22,10);}}
 }
 for(const p of s.projectiles||[]){
  const visual=attackVisual(p),owner=s.units.find(u=>u.uid===p.owner),target=p.returning?owner:s.enemies.find(e=>e.uid===p.target);
  const ground=point(p.x,p.y),dest=target?point(target.x,target.y):ground,pos={...ground};
  const angle=Math.atan2(dest.y-ground.y,dest.x-ground.x),arts=p.type==='arts';
  if(visual==='artillery'&&!reduce&&target){const ox=p.startX??owner?.x??p.x,oy=p.startY??owner?.y??p.y,total=Math.hypot(target.x-ox,target.y-oy)||1,progress=Math.max(0,Math.min(1,1-Math.hypot(target.x-p.x,target.y-p.y)/total));pos.y-=Math.sin(progress*Math.PI)*Math.min(45,z.th*.8);c.fillStyle='#0005';c.beginPath();c.ellipse(ground.x,ground.y,5,2,0,0,Math.PI*2);c.fill();}
  c.save();c.translate(pos.x,pos.y);c.rotate(angle);c.strokeStyle=arts?'#cda8ff':'#ffe6a4';c.fillStyle=c.strokeStyle;c.lineWidth=2;
  if(visual==='return'){c.rotate(reduce?0:t*15);c.beginPath();c.arc(0,0,8,.3,Math.PI*1.8);c.stroke();line(c,{x:-6,y:0},{x:6,y:0});}
  else if(visual==='artillery'){c.beginPath();c.arc(0,0,5,0,Math.PI*2);c.fill();if(!reduce)line(c,{x:-15,y:0},{x:-7,y:0});}
  else if(arts){c.beginPath();c.moveTo(7,0);c.lineTo(0,-4);c.lineTo(-7,0);c.lineTo(0,4);c.closePath();c.fill();if(visual==='stored')ring(c,{x:0,y:0},10,6);if(visual==='drone')line(c,{x:-16,y:0},{x:-7,y:0});}
  else{line(c,{x:-7,y:0},{x:6,y:0});if(!reduce){c.globalAlpha=.35;line(c,{x:-19,y:0},{x:-9,y:0});}}
  c.restore();
 }
 for(const e of recent(s.events,t,'strike',.24)){
  if(e.targetX==null)continue;const a=point(e.x,e.y),b=point(e.targetX,e.targetY),visual=attackVisual(e),age=(t-e.t)/.24;
  c.save();c.globalAlpha=1-age;c.strokeStyle=e.enemy?'#ff927d':e.damageType==='arts'?'#cda8ff':'#fff0b1';c.lineWidth=2;
  const angle=Math.atan2(b.y-a.y,b.x-a.x);
  if(['slash','sweep','enemy-melee'].includes(visual)){c.beginPath();c.arc(b.x,b.y,reduce?12:12+age*14,angle-1.2,angle+1.2);c.stroke();if(!reduce){c.lineWidth=1;c.beginPath();c.arc(b.x,b.y,19+age*14,angle-.9,angle+.9);c.stroke();}}
  else if(visual==='punch'){ring(c,b,8+age*12,8+age*12);for(let i=0;i<4;i++){const r=i*Math.PI/2;line(c,{x:b.x+Math.cos(r)*12,y:b.y+Math.sin(r)*12},{x:b.x+Math.cos(r)*20,y:b.y+Math.sin(r)*20});}}
  else if(visual==='thrust'){line(c,a,b);c.beginPath();c.moveTo(b.x-Math.cos(angle-.5)*10,b.y-Math.sin(angle-.5)*10);c.lineTo(b.x,b.y);c.lineTo(b.x-Math.cos(angle+.5)*10,b.y-Math.sin(angle+.5)*10);c.stroke();}
  else if(visual==='scatter'){line(c,a,b);if(!reduce)for(const d of [-.12,.12]){const len=Math.hypot(b.x-a.x,b.y-a.y);line(c,a,{x:a.x+Math.cos(angle+d)*len,y:a.y+Math.sin(angle+d)*len});}}
  else if(visual==='area'){ring(c,b,10+age*12,6+age*7);}
  else if(visual==='enemy-shot'){line(c,a,b);cross(c,b,3);}
  else{c.translate(a.x,a.y);c.rotate(angle);line(c,{x:4,y:-3},{x:10,y:0});line(c,{x:10,y:0},{x:4,y:3});}
  c.restore();
 }
 for(const e of (s.events||[]).filter(e=>['heal','chain'].includes(e.type)&&t-e.t>=0&&t-e.t<.4)){
  const a=point(e.x,e.y),b=point(e.targetX,e.targetY),heal=e.type==='heal',age=(t-e.t)/.4;
  c.save();c.globalAlpha=1-age;c.strokeStyle=heal?'#8fe8b5':'#bb9dff';c.lineWidth=heal?2:2.5;
  if(heal){c.beginPath();c.moveTo(a.x,a.y);c.quadraticCurveTo((a.x+b.x)/2,Math.min(a.y,b.y)-18,b.x,b.y);c.stroke();cross(c,b,5);ring(c,b,10,6);}
  else{const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;c.beginPath();c.moveTo(a.x,a.y);for(let i=1;i<=6;i++){const k=i/6,off=reduce||i===6?0:(i%2?5:-5);c.lineTo(a.x+dx*k-dy/len*off,a.y+dy*k+dx/len*off);}c.stroke();}
  c.restore();
 }
 for(const e of (s.events||[]).filter(e=>['impact','aftershock'].includes(e.type)&&e.radius&&t-e.t>=0&&t-e.t<.38)){
  const p=point(e.x,e.y),age=(t-e.t)/.38,after=e.type==='aftershock';c.save();c.globalAlpha=1-age;c.strokeStyle=after?'#f3bc75':e.damageType==='arts'?'#cda8ff':'#ffe6a4';c.lineWidth=after?3:2;
  const scale=reduce?1:.55+age*.45;ring(c,p,e.radius*z.tw*scale,e.radius*z.th*scale);
  if(!reduce){ring(c,p,e.radius*z.tw*.55*scale,e.radius*z.th*.55*scale);for(let i=0;i<6;i++){const a=i*Math.PI/3,r=e.radius*z.tw*.7*age;line(c,{x:p.x+Math.cos(a)*r,y:p.y+Math.sin(a)*r*z.th/z.tw},{x:p.x+Math.cos(a)*(r+7),y:p.y+Math.sin(a)*(r+7)*z.th/z.tw});}}
  c.restore();
 }
 c.restore();
}
function mark(c,x,y,kind){
 c.save();c.translate(x,y);c.strokeStyle='#f4f0e4';c.fillStyle='#1a2420';c.lineWidth=1.4;
 if(kind==='stun'){c.beginPath();c.moveTo(-5,-6);c.lineTo(0,6);c.lineTo(5,-6);c.closePath();c.fill();c.stroke();}
 else if(kind==='sleep'){c.font='9px sans-serif';c.fillStyle='#f4f0e4';c.fillText('Z',0,3);}
 else if(kind==='silence'){c.beginPath();c.arc(0,0,5,0,Math.PI*2);c.moveTo(-3,-3);c.lineTo(3,3);c.stroke();}
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
// Full-screen Kjerag storm, played for ICE_WIND_SECONDS after each 'ice-wind' settlement event.
// Pure presentation: it reads events and logic-effect timing only, and writes nothing to battle state.
const ICE_WIND_SECONDS=1;
export function drawIceWind(c,z,battle,{reduceFx=false}={}){
 const s=battle?.s;if(!s)return false;
 const [ev]=recent(s.events,s.time,'ice-wind',ICE_WIND_SECONDS);
 if(!ev)return false;
 const age=Math.max(0,Math.min(1,(s.time-ev.t)/ICE_WIND_SECONDS));
 const peak=reduceFx?.06:.11,                   // 主雾峰值透明度
  alpha=Math.round(peak*Math.sin(Math.PI*age)*1.15*1e4)/1e4, // 中段最亮，首尾归零；取整避免科学计数法
  W=z.r.width,H=z.r.height;
 c.save();
 c.globalCompositeOperation='lighter';          // 只提亮、不压暗界面
 const g=c.createLinearGradient(0,0,W*.65,H);
 g.addColorStop(0,`rgba(238,250,255,${alpha})`);
 g.addColorStop(.55,`rgba(212,240,252,${alpha*.85})`);
 g.addColorStop(1,`rgba(198,232,250,${alpha*.6})`);
 c.fillStyle=g;c.fillRect(0,0,W,H);
 const sweep=(1-age)*W*.45-W*.12;               // 风痕整体横扫
 c.lineCap='round';
 const streaks=reduceFx?3:8;
 for(let i=0;i<streaks;i++){
  const y=H*((i+.5)/streaks);
  const x=(i%2?-sweep:sweep)+W*.5+(i%3-1)*W*.12;
  const a=alpha*(i%2?.9:1.25);
  c.strokeStyle=`rgba(255,255,255,${Math.min(.5,a)})`;c.lineWidth=i%2?1.5:2.6;
  c.beginPath();c.moveTo(x,y+H*.05);c.lineTo(x+W*.3,y-H*.05);c.stroke();
 }
 c.restore();
 return true;
}
export function drawFx(c,point,z,battle,opts={}){
 const s=battle.s,t=s.time,reduce=!!opts.reduceFx;
 drawCombatFx(c,point,z,battle,reduce);
 drawIceWind(c,z,battle,{reduceFx:reduce});
 for(const e of s.effects||[]){
  if(e.type!=='healing'&&e.type!=='evade'&&e.type!=='block')continue;
  const p=point(e.x,e.y);c.fillStyle=e.type==='healing'?'#8fe8b5':'#f6e7c8';c.font='12px sans-serif';c.textAlign='center';c.fillText(opts.formatText?opts.formatText(e.text):e.text,p.x,p.y-24-(.6-e.life)*30);
 }
 for(const e of recent(s.events,t,'deploy',.4)){const p=point(e.x,e.y);c.strokeStyle='#8fe8b5';c.lineWidth=2;c.beginPath();c.ellipse(p.x,p.y+8,reduce?12:12+18*(t-e.t),5,0,0,Math.PI*2);c.stroke();}
 for(const e of recent(s.events,t,'skill-end',.3)){const p=point(e.x,e.y);c.strokeStyle='#f4d38b';c.strokeRect(p.x-12,p.y-12,24,24);}
 for(const e of recent(s.events,t,'skill-start',.45)){
  const p=point(e.x,e.y),k=1-(t-e.t)/.45;c.strokeStyle=`rgba(244,211,139,${.8*k})`;c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,14+8*(1-k),0,Math.PI*2);c.stroke();c.fillStyle=`rgba(244,211,139,${.9*k})`;c.font='11px sans-serif';c.textAlign='center';c.fillText(e.name||'技能',p.x,p.y-22);
 }
 for(const e of recent(s.events,t,'leak',1.2)){
  const p=point(e.x,e.y);c.fillStyle='#ffb48c';c.font='bold 14px sans-serif';c.textAlign='center';c.fillText('漏怪',p.x,p.y-18);
 }
 if(s.banner){c.fillStyle='#081511cc';c.fillRect(z.r.width/2-90,12,180,28);c.fillStyle='#e9fff7';c.font='bold 14px sans-serif';c.textAlign='center';c.fillText(opts.formatText?opts.formatText(s.banner.text):s.banner.text,z.r.width/2,32);}
 if(!reduce)for(const e of recent(s.events,t,'hit',.16)){const p=point(e.x,e.y);c.fillStyle='#fff8';c.beginPath();c.arc(p.x,p.y,11,0,Math.PI*2);c.fill();}
}
export function drawStatuses(c,x,y,unit,size){
 // cold and frozen are shown by drawFrostOverlay on the actor itself, so they get no head icon here.
 const kinds=[];
 for(const s of unit.statuses||[])if(['stun','sleep','silence','fear','terror','tremble','root'].includes(s.kind)&&!kinds.includes(s.kind))kinds.push(s.kind);
 if((unit.shield||0)>0||(unit.shieldLayers||[]).some(l=>l.remaining>0))kinds.push('shield');
 if((unit.barriers||[]).some(b=>b.charges>0))kinds.push('barrier');
 kinds.slice(0,3).forEach((k,i)=>mark(c,x-size/2+6+i*13,y-size*.82,k));
}
const ELEMENT_RING_COLORS={neural:'#67c9ff',burn:'#ff875c',necrosis:'#c19aff',corrosion:'#b7d875',elemental:'#f3d27f'};
export function drawElementRing(c,x,y,unit,size){
 const raw=unit?.elemental,max=Number(unit?.elementalMax||unit?.maxHp)||0;
 if(!raw||typeof raw!=='object'||max<=0)return;
 const entries=Object.entries(raw).filter(([,value])=>Number(value)>0).map(([type,value])=>[type,Number(value)]).sort((a,b)=>b[1]-a[1]),[type,value]=entries[0]||[];
 if(!type)return;
 const progress=Math.min(1,value/max),radius=size*.56;
 c.save();c.lineWidth=Math.max(2,size*.045);c.lineCap='butt';c.strokeStyle='#0b1718cc';c.beginPath();c.arc(x,y-size*.2,radius,-Math.PI/2,Math.PI*1.5);c.stroke();c.strokeStyle=ELEMENT_RING_COLORS[unit.elementalType||type]||ELEMENT_RING_COLORS.elemental;c.beginPath();c.arc(x,y-size*.2,radius,-Math.PI/2,-Math.PI/2+Math.PI*2*progress);c.stroke();
 c.restore();
}
// Ice tint for cold/frozen actors. Pure presentation: it only reads actor.statuses, never writes state.
// cold and frozen use two depths of the same ice blue; frozen wins if a target somehow carries both.
const FROST_STYLE={
 cold:{fill:'rgba(140,205,235,0.28)',stroke:null},
 frozen:{fill:'rgba(70,150,205,0.55)',stroke:'rgba(200,235,255,0.45)'},
};
export function frostKindOf(actor){
 const list=actor?.statuses||[];
 for(const kind of ['frozen','cold'])if(list.some(s=>s.kind===kind))return kind;
 return null;
}
// box is the actor's own drawn rectangle, supplied by the caller so this layer stays unaware of
// tile lift, flying offsets and tile geometry. Summons pass through untouched.
export function drawFrostOverlay(c,actor,box,opts={}){
 if(!actor||actor.kind==='summon'||!box||!(box.w>0)||!(box.h>0))return false;
 const kind=frostKindOf(actor);if(!kind)return false;
 const style=FROST_STYLE[kind];
 c.save();c.fillStyle=style.fill;c.fillRect(box.x,box.y,box.w,box.h);
 if(style.stroke&&!opts.reduceFx){c.strokeStyle=style.stroke;c.lineWidth=1;c.strokeRect(box.x+.5,box.y+.5,box.w-1,box.h-1);}
 if(opts.decorate)opts.decorate(c,box,kind);   // extension point: frost crystals / patterns
 c.restore();
 return true;
}
export function drawDownRing(c,p,u,size,opts={}){
 const max=u.downMax||u.down||1,ratio=Math.max(0,Math.min(1,1-(u.down||0)/max));
 c.strokeStyle='#8eb4a7';c.lineWidth=2;c.beginPath();c.arc(p.x,p.y-size*.1,size*.42,-Math.PI/2, -Math.PI/2+ratio*Math.PI*2);c.stroke();
 const n=Math.ceil(u.down||0);
 c.fillStyle='#e9fff7';c.font='11px sans-serif';c.textAlign='center';c.fillText((opts.formatNumber?opts.formatNumber(n):n)+'s',p.x,p.y+4);
}
