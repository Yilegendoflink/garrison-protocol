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
// 技能表现色：默认是暖金／暖白；水月这类水属性干员的技能在游戏里是蓝色的，按干员覆盖一层色调。
// 只影响绘制，不参与任何命中或数值判定。
const SKILL_FX_TINT={char_437_mizuki:{main:[122,198,255],soft:[190,230,255]}};
const FX_MAIN=[255,246,214],FX_SOFT=[255,240,200],FX_RING=[244,211,139],FX_GLOW=[255,236,190];
const rgba=(rgb,a)=>`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
function fxTint(battle,uid){const u=(battle?.s?.units||[]).find(x=>x.uid===uid);return u?SKILL_FX_TINT[u.id]||null:null;}
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
 // 炎佑（炎盟约 6 人的召唤物）：普攻弹道 + 「祛恶之焰」持续期表现。只读召唤物状态与 yan-bolt 事件。
 const YAN_BOLT=.3,YAN_SCALE=reduce?.62:1;
 for(const s2 of s.summons||[]){
  if(s2.type!=='yan-guardian'||!s2.deployed)continue;
  const p=point(s2.x,s2.y),r=(z.tw*.42)*YAN_SCALE;
  // 弹体：从炎佑飞向目标，命中瞬间炸开一圈灼燃
  for(const e of recent(s.events,t,'yan-bolt',YAN_BOLT)){
   if(e.uid!==s2.uid||e.targetX==null)continue;
   const a=point(e.x,e.y),b=point(e.targetX,e.targetY),k=Math.max(0,Math.min(1,(t-e.t)/YAN_BOLT));
   const x=a.x+(b.x-a.x)*k,y=a.y+(b.y-a.y)*k- Math.sin(k*Math.PI)*(reduce?0:z.th*.18);
   c.save();c.globalCompositeOperation='lighter';
   const g=c.createRadialGradient(x,y,0,x,y,r*.9);
   g.addColorStop(0,`rgba(255,244,214,${.85*YAN_SCALE})`);g.addColorStop(.45,`rgba(255,146,74,${.6*YAN_SCALE})`);g.addColorStop(1,'rgba(255,90,40,0)');
   c.fillStyle=g;c.beginPath();c.arc(x,y,r*.9,0,Math.PI*2);c.fill();
   const tail={x:x-Math.cos(Math.atan2(b.y-a.y,b.x-a.x))*r*1.5,y:y-Math.sin(Math.atan2(b.y-a.y,b.x-a.x))*r*1.5};
   c.strokeStyle=`rgba(255,170,104,${.5*YAN_SCALE})`;c.lineWidth=2.4;c.lineCap='round';
   c.beginPath();c.moveTo(tail.x,tail.y);c.lineTo(x,y);c.stroke();
   if(k>.72){const hit=(k-.72)/.28;c.strokeStyle=`rgba(255,206,150,${(.7*(1-hit)*YAN_SCALE).toFixed(3)})`;c.lineWidth=2;
    c.beginPath();c.ellipse(b.x,b.y,r*(.5+hit*1.1),r*(.34+hit*.7),0,0,Math.PI*2);c.stroke();
    c.fillStyle=`rgba(207,190,240,${(.5*(1-hit)*YAN_SCALE).toFixed(3)})`;
    c.beginPath();c.arc(b.x,b.y,r*(.2+hit*.5),0,Math.PI*2);c.fill();}
   c.restore();
  }
  // 「祛恶之焰」持续 20 秒：身上一圈旋转火轮 + 上浮火星
  if(s2.yanSkillActive){
   c.save();c.globalCompositeOperation='lighter';
   const spin=reduce?0:t*2.8,left=Math.max(0,Math.min(1,(s2.yanSkillLeft??0)/20));
   c.strokeStyle=`rgba(255,138,72,${.62*YAN_SCALE})`;c.lineWidth=2.4;c.lineCap='round';
   for(let i=0;i<3;i++){const a0=spin+i*Math.PI*2/3;c.beginPath();c.ellipse(p.x,p.y,r*.72,r*.3,a0,.2,Math.PI*.96);c.stroke();}
   c.strokeStyle=`rgba(255,214,150,${.4*YAN_SCALE})`;c.lineWidth=1.2;ring(c,p,r*.5,r*.2);
   const sparks=reduce?2:5;
   for(let i=0;i<sparks;i++){const a=spin*.8+i*Math.PI*2/sparks,rise=((t*1.6+i*.37)%1);
    c.fillStyle=`rgba(255,196,128,${((1-rise)*.6*YAN_SCALE*left+.15).toFixed(3)})`;
    c.beginPath();c.arc(p.x+Math.cos(a)*r*.52,p.y+Math.sin(a)*r*.24-rise*r*1.1,1.5,0,Math.PI*2);c.fill();}
   c.restore();
   if(s2.yanSkillTargetUid!=null){
    const tg=(s.enemies||[]).find(e=>e.uid===s2.yanSkillTargetUid);
    if(tg){
     // 技能持续期间，炎佑与锁定目标之间**一直**有一条火光连线（不只是命中的那一瞬）：
     // 外层宽而淡、内层亮线，沿线跑动几点火星；reduceFx 下不打火星、线照旧。
     const q=point(tg.x,tg.y),flow=reduce?0:((t*1.4)%1);
     c.save();c.globalCompositeOperation='lighter';c.lineCap='round';
     c.strokeStyle=`rgba(255,132,66,${.3*YAN_SCALE})`;c.lineWidth=4.4;
     c.beginPath();c.moveTo(p.x,p.y);c.lineTo(q.x,q.y);c.stroke();
     c.strokeStyle=`rgba(255,208,142,${.62*YAN_SCALE})`;c.lineWidth=1.6;
     c.beginPath();c.moveTo(p.x,p.y);c.lineTo(q.x,q.y);c.stroke();
     const sparks=reduce?0:4;
     for(let i=0;i<sparks;i++){
      const k=(flow+i/sparks)%1;
      c.fillStyle=`rgba(255,234,196,${.55*YAN_SCALE})`;
      c.beginPath();c.arc(p.x+(q.x-p.x)*k,p.y+(q.y-p.y)*k-2.4,1.6,0,Math.PI*2);c.fill();
     }
     c.strokeStyle=`rgba(255,150,90,${.4*YAN_SCALE})`;c.lineWidth=1.6;ring(c,q,z.tw*.7,z.tw*.45);
     c.restore();
    }
   }
  }
 }
 for(const e of (s.events||[]).filter(e=>['heal','chain'].includes(e.type)&&t-e.t>=0&&t-e.t<.4)){  const a=point(e.x,e.y),b=point(e.targetX,e.targetY),heal=e.type==='heal',age=(t-e.t)/.4;
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
 else if(kind==='exposed'){c.strokeStyle='#ff956e';c.beginPath();c.arc(0,0,4,0,Math.PI*2);c.moveTo(-7,0);c.lineTo(7,0);c.moveTo(0,-7);c.lineTo(0,7);c.stroke();}
 else if(kind==='shield'){c.beginPath();c.moveTo(0,-6);c.lineTo(5,-2);c.lineTo(4,5);c.lineTo(0,7);c.lineTo(-4,5);c.lineTo(-5,-2);c.closePath();c.fill();c.stroke();}
 else if(kind==='barrier'){c.strokeRect(-5,-5,10,10);c.beginPath();c.moveTo(-5,0);c.lineTo(5,0);c.stroke();}
 else if(kind==='invisible'||kind==='camouflage'){c.setLineDash([2,2]);c.strokeRect(-5,-5,10,10);c.setLineDash([]);c.beginPath();c.moveTo(-5,5);c.lineTo(5,-5);c.stroke();if(kind==='camouflage'){c.beginPath();c.moveTo(-5,-5);c.lineTo(5,5);c.stroke();}}
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
// 荒芜拉普兰德「终幕·浩劫」的浮游单元：逻辑上是自由飞行的独立单位（battle.s.whitwEyes），
// 这里只给它一个占屏幕不大的浪头素材，让飞行过程肉眼可见。画法不参与任何结算。
export function drawWhitwEyes(c,point,z,battle,{reduceFx=false}={}){
 const eyes=battle?.s?.whitwEyes;
 if(!eyes?.length)return false;
 const K=reduceFx?.5:1,W=z.tw*.86,H=z.tw*.5;
 for(const eye of eyes){
  const p=point(eye.x,eye.y);
  const dir=Math.atan2(eye.vy||0,eye.vx||1);
  const bob=Math.sin((eye.x+eye.y)*2.1)*K;
  c.save();
  c.translate(p.x,p.y+bob*.8);
  c.rotate(dir);
  // 尾迹：朝来向淡出，表示正在飞
  const g=c.createLinearGradient(-W*.95,0,W*.32,0);
  g.addColorStop(0,'rgba(120,205,238,0)');
  g.addColorStop(.55,`rgba(168,226,246,${.2*K})`);
  g.addColorStop(1,`rgba(238,252,255,${.42*K})`);
  c.fillStyle=g;
  c.beginPath();c.moveTo(-W*.95,0);c.quadraticCurveTo(-W*.3,-H*.5,W*.1,-H*.22);c.lineTo(W*.1,H*.22);c.quadraticCurveTo(-W*.3,H*.5,-W*.95,0);c.closePath();c.fill();
  // 浪头：一弯白色卷浪加几道浪花
  c.fillStyle=`rgba(240,252,255,${.82*K})`;
  c.beginPath();
  c.moveTo(-W*.16,H*.34);
  c.quadraticCurveTo(W*.3,-H*.5,W*.34,-H*.02);
  c.quadraticCurveTo(W*.3,H*.3,W*.06,H*.3);
  c.quadraticCurveTo(-W*.02,H*.12,-W*.16,H*.34);
  c.closePath();c.fill();
  c.strokeStyle=`rgba(140,214,242,${.75*K})`;c.lineWidth=1.6;
  c.beginPath();
  c.moveTo(-W*.34,H*.12);c.quadraticCurveTo(W*.06,-H*.26,W*.36,-H*.04);
  c.stroke();
  c.fillStyle=`rgba(255,255,255,${.7*K})`;
  for(const [dx,dy,r] of [[W*.34,-H*.3,1.5],[W*.42,-H*.12,1.1],[W*.22,-H*.38,.9]]){c.beginPath();c.arc(dx,dy,r,0,Math.PI*2);c.fill();}
  c.restore();
  // 攻击瞬间的一圈涟漪
  if(eye.nextAttackAt>battle.s.time){
   const age=Math.max(0,Math.min(1,1-(eye.nextAttackAt-battle.s.time)/.4));
   if(age<1){c.save();c.strokeStyle=`rgba(214,242,255,${(.5*(1-age)*K).toFixed(3)})`;c.lineWidth=1.4;c.beginPath();c.ellipse(p.x,p.y,z.tw*(.2+age*.4),z.tw*(.12+age*.26),0,0,Math.PI*2);c.stroke();c.restore();}
  }
 }
 return true;
}
// ── 「范围扩大」技能特效 ──────────────────────────────────────────────
// 数据来源：技能的 rangeId 与干员常态 rangeId 不同即为范围扩大（skillWidensRange）。
// 形状一律取自 data.ranges[rangeId].grids，不靠像素半径估算。
// 三种画法：wideSlash（持续强化型，逐次攻击扫弧）、selfBurst（瞬时自身 AoE）、auraRing（持续领域描边）。

function rangeCells(point,z,battle,uid){
 const unit=battle?.s?.units?.find(u=>u.uid===uid);
 if(!unit||!battle.rangeGeometry)return null;
 const geo=battle.rangeGeometry(unit);
 if(!geo)return null;
 const cells=[];
 for(let row=-geo.reachY;row<=geo.reachY;row++)for(let col=-geo.reachX;col<=geo.reachX;col++){
  const mine=geo.cells.some(g=>g.row===row&&g.col===col);
  if(!mine)continue;
  let x=col,y=-row;
  for(let i=0;i<(unit.dir||0);i++)[x,y]=[-y,x];
  const cell={gx:unit.x+x,gy:unit.y+y};
  cell.p=point(cell.gx,cell.gy);
  cells.push(cell);
 }
 return {geo,unit,cells};
}
// 逐格描出技能范围轮廓（只描边不填充，避免糊住棋盘）
function strokeRange(c,z,cells,{stroke,width=1.5,dash=null}={}){
 if(!cells?.length)return;
 c.save();if(stroke)c.strokeStyle=stroke;c.lineWidth=width;if(dash)c.setLineDash(dash);
 for(const cell of cells)c.strokeRect(cell.p.x-z.tw/2+1,cell.p.y-z.th/2+1,z.tw-2,z.th-2);
 c.restore();
}
// 持续范围强化：开启时大弧线扫过整个技能范围，之后每次攻击沿范围扫出弧
export function drawWideSweep(c,point,z,battle,{reduceFx=false}={}){
 const s=battle?.s;if(!s)return false;
 let drew=false;
 for(const e of recent(s.events,s.time,'skill-start',.6)){
  if(e.wideKind!=='sweep')continue;
  const info=rangeCells(point,z,battle,e.uid);
  const k=Math.max(0,Math.min(1,(s.time-e.t)/.6)),u=info.unit;
  const r=info.geo.cells.reduce((m,g)=>Math.max(m,Math.hypot(g.col,g.row)),1)*z.tw*.72;
  const facing=-(u.dir||0)*Math.PI/2;
  c.save();c.globalCompositeOperation='lighter';
  const origin=point(u.x,u.y);
  c.translate(origin.x,origin.y);
  c.rotate(facing);
  for(let i=0;i<2;i++){
   const a0=-.95+k*1.9*(i?1:1)-(i?.22:0),a1=a0+(i?.5:.72);
   const tint=fxTint(battle,e.uid);
   c.strokeStyle=rgba(tint?.soft||[228,244,255],(1-k)*(i?.5:.85)*(reduceFx?.6:1));
   c.lineWidth=i?2:4;c.lineCap='round';
   c.beginPath();c.arc(0,0,r,a0,a1);c.stroke();
  }
  c.restore();drew=true;
 }
 // 攻击瞬间：从施法者朝范围扫出的弧（每次 strike 一条，按 wide 过滤）
 for(const e of recent(s.events,s.time,'strike',.3)){
  if(!e.wide)continue;
  const info=rangeCells(point,z,battle,e.uid);
  if(!info)continue;
  const k=Math.max(0,Math.min(1,(s.time-e.t)/.3)),u=info.unit;
  const a=point(u.x,u.y),b=point(e.targetX,e.targetY);
  const ang=Math.atan2(b.y-a.y,b.x-a.x);
  const r=info.geo.reachX*z.tw*.7+z.tw*.3;
  c.save();c.globalCompositeOperation='lighter';
  c.translate(a.x,a.y);c.rotate(ang);
  c.strokeStyle=rgba(fxTint(battle,e.uid)?.main||[232,246,255],(1-k)*(reduceFx?.5:.85));
  c.lineWidth=3;c.lineCap='round';
  c.beginPath();c.arc(0,0,r,-.5+k*.25,.5+k*.25);c.stroke();
  c.restore();drew=true;
 }
 return drew;
}
// 瞬时自身 AoE（含入场自动释放的被动）：以自身为中心的扩散震波，半径按技能范围跨度
export function drawSelfBurst(c,point,z,battle,{reduceFx=false}={}){
 const s=battle?.s;if(!s)return false;
 let drew=false;
 for(const e of recent(s.events,s.time,'skill-start',.55)){
  // 只看「瞬时自身 AoE」与「入场自动释放」的被动大范围技能：前者是主动爆发，后者按你的定义就是入场自动放技能
  if(e.wideKind!=='burst'&&e.wideKind!=='passive')continue;
  const info=rangeCells(point,z,battle,e.uid);
  if(!info)continue;
  const geo=info.geo,round=geo.spanX<=2&&geo.spanY<=2&&geo.count<=9;   // 近身范围画圆环，否则按格描边
  const k=Math.max(0,Math.min(1,(s.time-e.t)/.55)),fade=(1-k)*(reduceFx?.55:1);
  const p=point(info.unit.x,info.unit.y),tint=fxTint(battle,e.uid);
  c.save();c.globalCompositeOperation='lighter';
  if(round){
   const r=(geo.reachX||1)*z.tw*(.5+k*.75);
   c.strokeStyle=rgba(tint?.main||FX_MAIN,.85*fade);c.lineWidth=3;
   c.beginPath();c.ellipse(p.x,p.y,r,r*.62,0,0,Math.PI*2);c.stroke();
   c.strokeStyle=`rgba(255,255,255,${(.5*fade).toFixed(3)})`;c.lineWidth=1.4;
   c.beginPath();c.ellipse(p.x,p.y,r*.62,r*.4,0,0,Math.PI*2);c.stroke();
  }else{
   strokeRange(c,z,info.cells,{stroke:rgba(tint?.soft||FX_SOFT,.8*fade),width:2});
  }
  c.restore();drew=true;
 }
 return drew;
}
// 持续领域（光环／停攻结界）：技能持续期内描出范围边界，低频流光脉动
export function drawAuraField(c,point,z,battle,{reduceFx=false}={}){
 const s=battle?.s;if(!s)return false;
 let drew=false;
 for(const u of s.units||[]){
  if(!u.deployed||u.hp<=0||!(u.skillLeft>0))continue;
  const info=rangeCells(point,z,battle,u.uid);
  if(!info||info.geo.count<6)continue;
  const pulse=reduceFx?0:(.5+.5*Math.sin(s.time*2.2)),tint=fxTint(battle,u.uid);
  strokeRange(c,z,info.cells,{stroke:rgba(tint?.main||FX_RING,.16+.14*pulse),width:1.5});
  const p=point(u.x,u.y),r=(info.geo.reachX||1)*z.tw;
  c.save();c.globalCompositeOperation='lighter';
  c.strokeStyle=rgba(tint?.soft||FX_GLOW,.1+.08*pulse);c.lineWidth=2;
  c.beginPath();c.ellipse(p.x,p.y,r*.55,r*.34,0,0,Math.PI*2);c.stroke();
  c.restore();drew=true;
 }
 return drew;
}
// ── 区域／领域类效果统一绘制 ─────────────────────────────────────────
// 逻辑层的 s.logicEffects（kind:'zone'）本来就带 x/y/radius/trackArea/values，
// 之前完全没画；这里按 zoneVisual 的色调与形状统一渲染，雷暴、领域、光环一次覆盖。
const ZONE_TONE={thunder:['#bcd8ff','#7fb2ff'],blade:['#ffe9c2','#ffb877'],gold:['#ffe6a4','#f0c774'],
 holy:['#fff4d6','#f7cf8f'],water:['#bfe8ff','#79c4ee'],sand:['#f0dcae','#c9a86a'],
 burn:['#ffc79a','#ff8f57'],frost:['#d8f1ff','#8fd0ee'],shadow:['#d9c7ff','#9d84d8'],
 arts:['#dcc9ff','#a98ce0'],heal:['#c8f6dc','#7fd8a8'],time:['#e6e0ff','#a9a2e8']};
// 敌方持续伤害区域的配色：原作的污染是发暗的紫绿，不是亮粉。压暗后按 source-over 叠在地块上，
// 不再像此前用加成混合那样把整片地照成粉色。
const FIELD_TINT={fill:'#4a4160',edge:'#8f86b8'};
// `rangeUid` 圈（= 某名干员的攻击范围）在绘制时按它的当前范围格走；这里取持有者。
function getZoneRangeOwner(s,fx){return (s.units||[]).find(u=>u.uid===fx.rangeUid)||null;}
function drawInesShadow(c,point,z,battle,reduceFx){
 const s=battle?.s;if(!s)return false;
 const regions=new Map();
 for(const sentry of s.revealSentries||[])regions.set(sentry.fromUid??`sentry:${sentry.x},${sentry.y}`,sentry);
 for(const fx of s.logicEffects||[])if(fx.talentOrSkillId==='ines-shadow'&&(fx.endsAt==null||fx.endsAt>s.time)&&!regions.has(fx.sourceUid))regions.set(fx.sourceUid,fx);
 for(const region of regions.values()){
  if(region.endsAt!=null&&region.endsAt<=s.time)continue;
  const p=point(region.x??0,region.y??0),radius=Math.max(.5,Number(region.radius)||2),rx=radius*z.tw,ry=radius*z.th,pulse=reduceFx?0:.5+.5*Math.sin(s.time*2.2);
  c.save();c.globalCompositeOperation='source-over';
  const gradient=c.createRadialGradient(p.x,p.y,0,p.x,p.y,Math.max(rx,ry));
  gradient.addColorStop(0,'rgba(4,6,10,.5)');gradient.addColorStop(.58,'rgba(7,9,15,.32)');gradient.addColorStop(1,'rgba(9,11,18,0)');
  c.fillStyle=gradient;c.beginPath();c.ellipse(p.x,p.y,rx,ry,0,0,Math.PI*2);c.fill();
  c.strokeStyle=`rgba(87,94,109,${.26+.1*pulse})`;c.lineWidth=1.5;c.beginPath();c.ellipse(p.x,p.y,rx,ry,0,0,Math.PI*2);c.stroke();
  if(!reduceFx){c.setLineDash([5,9]);c.lineDashOffset=-s.time*7;c.strokeStyle='rgba(137,148,169,.25)';c.beginPath();c.ellipse(p.x,p.y,rx*.76,ry*.76,0,0,Math.PI*2);c.stroke();c.setLineDash([]);}
  c.restore();
 }
 return regions.size>0;
}
export function drawZones(c,point,z,battle,{reduceFx=false}={}){
 const s=battle?.s;if(!s)return false;
 // 敌方留下的持续伤害区域（kind:'field'：污染秽蚀、燃烧区域、毒雾）和我方技能区域共用这套绘制。
 // 例外：6 人谢拉格的寒风区域（bond-kjerag-storm）是全场常驻判定，但**不留常驻底色**——
 // 表现只有每 25 秒起风时的全屏冰风（'ice-wind' → drawIceWind）。
 const dominion=drawDominion(c,point,z,battle),inesShadow=drawInesShadow(c,point,z,battle,reduceFx);
 const list=(s.logicEffects||[]).filter(fx=>fx.talentOrSkillId!=='bond-kjerag-storm'&&fx.talentOrSkillId!=='ines-shadow'&&(fx.kind==='zone'||(fx.kind==='field'&&(Number(fx.values?.damage)>0||Number(fx.values?.atkScale)>0||Number(fx.values?.elementScale)>0)))&&(fx.endsAt==null||fx.endsAt>s.time));
 if(!list.length)return dominion||inesShadow;
 for(const fx of list){
  const visual=fx.values?.mouseSand?{shape:'square',tone:'gold'}:fx.values?.enemyWineBuff?{shape:'circle',tone:'gold'}:battle.zoneVisual?battle.zoneVisual(fx.talentOrSkillId,fx.values||{}):{shape:'circle',tone:'arts'};
  const [light,deep]=ZONE_TONE[visual.tone]||ZONE_TONE.arts;
  const radius=Number.isFinite(fx.radius)?fx.radius:1;
  // 剩余时间不足 1.5 秒时开始闪烁提示即将结束
  const remain=fx.endsAt==null?null:fx.endsAt-s.time;
  const blink=remain==null?1:(remain<1.5?(Math.sin(s.time*14)>0?1:.35):1);
  const pulse=reduceFx?0:(.5+.5*Math.sin(s.time*2.4));
  const alpha=(.1+.07*pulse)*blink*(reduceFx?.6:1);
  const cells=[];
  // 「这个圈就是某名干员的攻击范围」（rangeUid）：直接画它当前的技能范围格，别用半径近似。
  const rangeOwner=fx.rangeUid?battle.range?.(getZoneRangeOwner(s,fx),true):null;
  const circle=fx.shape==='circle'||fx.values?.shape==='circle';
  if(rangeOwner?.length){for(const cell of rangeOwner)cells.push({x:cell.x,y:cell.y});}
  else if(visual.shape==='self'){
   for(const u of s.units||[])if(u.uid===fx.sourceUid&&u.deployed)cells.push({x:u.x,y:u.y});
  }else if(!circle){
   for(let dy=-Math.ceil(radius);dy<=Math.ceil(radius);dy++)for(let dx=-Math.ceil(radius);dx<=Math.ceil(radius);dx++){
    if(visual.shape==='line'){
     // 斜线扫过的形状：沿对角线方向铺开，宽度 1 格
     if(Math.abs(dx)!==Math.abs(dy))continue;
     if(Math.abs(dx)>radius)continue;
    // 作用格数按向上取整：半径 2.2 覆盖 3 圈（7x7），与此前的散怪范围写法一致
    }else if(Math.max(Math.abs(dx),Math.abs(dy))>Math.ceil(radius))continue;
    cells.push({x:(fx.x??0)+dx,y:(fx.y??0)+dy});
   }
  }
  const isField=fx.kind==='field'||fx.values?.enemyWineBuff;
  // 敌方留下来的持续伤害区域只画「一圈」：铺格 + 逐格描边会变成一堆小方块，加成混合下看着像许多圈拼在一起。
  if(isField){
   const cx=point(fx.x??0,fx.y??0),rx=radius*z.tw,ry=radius*z.th;
   c.save();c.globalCompositeOperation='source-over';
   c.fillStyle=`${FIELD_TINT.fill}${Math.round(Math.min(.5,alpha*1.6)*255).toString(16).padStart(2,'0')}`;
   c.beginPath();c.ellipse(cx.x,cx.y,rx,ry,0,0,Math.PI*2);c.fill();
   c.strokeStyle=`${FIELD_TINT.edge}${Math.round(Math.min(.75,.34+.3*pulse)*blink*255).toString(16).padStart(2,'0')}`;
   c.lineWidth=1.8;c.beginPath();c.ellipse(cx.x,cx.y,rx,ry,0,0,Math.PI*2);c.stroke();
   // 周期结算的瞬间让整圈脉动一次，说明「这里每秒会结算」
   const fieldInterval=Number(fx.interval)||0;
   if(fieldInterval>0&&!reduceFx&&fx.nextAt!=null&&fx.nextAt-s.time<=.25){
    const k=1-Math.max(0,fx.nextAt-s.time)/.25;
    c.strokeStyle=`${FIELD_TINT.edge}${Math.round(.4*(1-k)*255).toString(16).padStart(2,'0')}`;c.lineWidth=2.4;
    c.beginPath();c.ellipse(cx.x,cx.y,rx*(1+k*.14),ry*(1+k*.14),0,0,Math.PI*2);c.stroke();
   }
   c.restore();
   continue;
  }
  // 余 S3「灶里乾坤」的火墙：一条横贯战场的线（垂直于余的部署朝向）。
  if(fx.values?.firewall){
   const w=fx.values.firewall,x0=z.ox+(w.axis==='x'?w.at:0)*z.tw,y0=z.oy+(w.axis==='y'?w.at:0)*z.th;
   c.strokeStyle=`${deep}${Math.round(Math.min(.8,.4+.3*pulse)*blink*255).toString(16).padStart(2,'0')}`;c.lineWidth=Math.max(3,.3*z.tw);
   c.beginPath();if(w.axis==='x'){c.moveTo(x0,z.oy);c.lineTo(x0,z.oy+z.r.height);}else{c.moveTo(z.ox,y0);c.lineTo(z.ox+z.r.width,y0);}c.stroke();
   c.restore();continue;
  }
  c.save();c.globalCompositeOperation='lighter';
  // 引星棘刺 S3「我的海疆」：判定区域是几个炼金单元落点围成的多边形（连成直线／只有一个点时也算），直接画路径。
  const areaPts=fx.values?.thorn2Area?.points;
  if(Array.isArray(areaPts)&&areaPts.length>=2){
   const pts=areaPts.map(p=>point(p.x,p.y));
   c.fillStyle=`${light}${Math.round(alpha*255).toString(16).padStart(2,'0')}`;
   c.strokeStyle=`${deep}${Math.round(Math.min(1,alpha*2.4)*255).toString(16).padStart(2,'0')}`;
   if(pts.length===2){c.lineWidth=Math.max(3,.65*z.tw);c.beginPath();c.moveTo(pts[0].x,pts[0].y);c.lineTo(pts[1].x,pts[1].y);c.stroke();}
   else{c.lineWidth=1.6;c.beginPath();c.moveTo(pts[0].x,pts[0].y);for(const p of pts.slice(1))c.lineTo(p.x,p.y);c.closePath();c.fill();c.stroke();}
   c.fillStyle=`${deep}${Math.round(Math.min(1,alpha*3)*255).toString(16).padStart(2,'0')}`;
   for(const p of pts){c.beginPath();c.arc(p.x,p.y,Math.max(2,z.tw*.12),0,Math.PI*2);c.fill();}
   c.restore();continue;
  }
  // 圆形领域（原作给的是半径，如烛煌 S1 的 `range_radius`、魔王的 `outside_radius`）：画圆盘＋圆环，
  // 不铺方格——否则就会出现「原作是圆、这里是方块」。
  if(circle){
   const cx=point(fx.x??0,fx.y??0),rx=radius*z.tw,ry=radius*z.th;
   c.fillStyle=`${light}${Math.round(alpha*255).toString(16).padStart(2,'0')}`;
   c.beginPath();c.ellipse(cx.x,cx.y,rx,ry,0,0,Math.PI*2);c.fill();
   c.strokeStyle=`${deep}${Math.round(Math.min(1,alpha*2.4)*255).toString(16).padStart(2,'0')}`;
   c.lineWidth=1.6;c.beginPath();c.ellipse(cx.x,cx.y,rx,ry,0,0,Math.PI*2);c.stroke();
   const circleInterval=Number(fx.interval)||0;
   if(circleInterval>0&&!reduceFx&&fx.nextAt!=null&&fx.nextAt-s.time<=.25){const k=1-Math.max(0,fx.nextAt-s.time)/.25;
    c.strokeStyle=`${deep}${Math.round(.5*(1-k)*255).toString(16).padStart(2,'0')}`;c.lineWidth=2.2;
    c.beginPath();c.ellipse(cx.x,cx.y,rx*(1+k*.12),ry*(1+k*.12),0,0,Math.PI*2);c.stroke();}
   c.restore();continue;
  }
  for(const cell of cells){
   const p=point(cell.x,cell.y);
   c.fillStyle=`${light}${Math.round(alpha*255).toString(16).padStart(2,'0')}`;
   c.fillRect(p.x-z.tw/2,p.y-z.th/2,z.tw,z.th);
   c.strokeStyle=`${deep}${Math.round(Math.min(1,alpha*2.4)*255).toString(16).padStart(2,'0')}`;
   c.lineWidth=1.2;c.strokeRect(p.x-z.tw/2+.5,p.y-z.th/2+.5,z.tw-1,z.th-1);
  }
  // 周期结算的瞬间补一圈脉冲，让"每 N 秒结算一次"看得见
  const interval=Number(fx.interval)||0;
  if(interval>0&&!reduceFx&&fx.nextAt!=null){
   const since=Math.max(0,Math.min(1,(interval-(fx.nextAt-s.time))/Math.max(.001,interval)));
   if(fx.nextAt-s.time<=.25){const k=1-Math.max(0,(fx.nextAt-s.time))/.25;
    for(const cell of cells){const p=point(cell.x,cell.y);c.strokeStyle=`${deep}${Math.round(.55*(1-k)*255).toString(16).padStart(2,'0')}`;c.lineWidth=2;c.beginPath();c.ellipse(p.x,p.y,z.tw*.5*(1+k*.4),z.th*.5*(1+k*.4),0,0,Math.PI*2);c.stroke();}}
  }
  // 投掷物（锡人「炼金单元」）：画一只飞行中的单元本体，飞行途中再淡描出落点圈，
  // 让「缓慢飞过去、停在目标位置」这件事在画面上看得出来。纯表现，不参与判定。
  if(fx.carrier){
   const c0=point(fx.x??0,fx.y??0);
   if(!fx.carrier.arrived&&!reduceFx){
    const tp=point(Number(fx.carrier.toX)||0,Number(fx.carrier.toY)||0);
    c.save();c.setLineDash([4,4]);c.strokeStyle=`${deep}${Math.round(.5*blink*255).toString(16).padStart(2,'0')}`;c.lineWidth=1.2;
    c.beginPath();c.ellipse(tp.x,tp.y,radius*z.tw,radius*z.th,0,0,Math.PI*2);c.stroke();c.setLineDash([]);
    c.strokeStyle=`${light}${Math.round(.4*255).toString(16).padStart(2,'0')}`;c.lineWidth=1;c.beginPath();
    c.moveTo(c0.x,c0.y);c.lineTo(tp.x,tp.y);c.stroke();c.restore();
   }
   c.fillStyle=`${light}f0`;c.beginPath();c.ellipse(c0.x,c0.y,z.tw*.28,z.th*.28,0,0,Math.PI*2);c.fill();
   c.strokeStyle=`${deep}`;c.lineWidth=1.4;c.beginPath();c.ellipse(c0.x,c0.y,z.tw*.28,z.th*.28,0,0,Math.PI*2);c.stroke();
  }
  c.restore();
 }
 return true;
}
// 瞬时多目标（辉煌裂片、御敌的锋锐等）：技能瞬间打中多个目标，走的是 dealDamage 而不是挥砍，
// 没有 strike 事件可画。这里用「开技后短时间内落在技能范围内的 hit 事件」连成扇面。
export function drawSkillFan(c,point,z,battle,{reduceFx=false}={}){
 const s=battle?.s;if(!s)return false;
 let drew=false;
 for(const start of recent(s.events,s.time,'skill-start',.3)){
  const info=rangeCells(point,z,battle,start.uid);
  if(!info)continue;
  const hits=recent(s.events,s.time,'hit',.3).filter(e=>e.t>=start.t&&e.uid!==start.uid&&e.x!=null&&e.y!=null);
  if(hits.length<2)continue;
  const origin=point(info.unit.x,info.unit.y);
  const toward=Math.atan2((hits[0].y)-(start.y??hits[0].y),(hits[0].x)-(start.x??hits[0].x));
  const k=Math.max(0,Math.min(1,(s.time-start.t)/.3)),fade=(1-k)*(reduceFx?.5:.85),tint=fxTint(battle,start.uid);
  const reach=Math.max(info.geo.reachX,info.geo.reachY)*z.tw*.72+z.tw*.3;
  c.save();c.globalCompositeOperation='lighter';c.translate(origin.x,origin.y);
  c.strokeStyle=rgba(tint?.soft||[255,240,206],fade);c.lineWidth=2.4;c.lineCap='round';
  c.beginPath();c.arc(0,0,reach,toward-.55,toward+.55);c.stroke();
  c.strokeStyle='rgba(255,255,255,'+(fade*.6).toFixed(3)+')';c.lineWidth=1.4;
  for(const h of hits){const b=point(h.x,h.y);c.beginPath();c.moveTo(0,0);c.lineTo(b.x-origin.x,b.y-origin.y);c.stroke();}
  c.restore();drew=true;
 }
 return drew;
}
// 位移类效果：拖拽／推退／传送／换位。坐标由逻辑层的 move 事件给出（含起点 fromX/fromY），
// 特效只画起终点轨迹与落点环，不参与任何位置判定。
export function drawDisplace(c,point,z,battle,{reduceFx=false}={}){
 const s=battle?.s;if(!s)return false;
 let drew=false;
 for(const e of recent(s.events,s.time,'move',.45)){
  if(e.fromX==null||e.fromY==null)continue;
  const a=point(e.fromX,e.fromY),b=point(e.x,e.y);
  if(Math.abs(a.x-b.x)<1&&Math.abs(a.y-b.y)<1)continue;   // 原地换位不画
  const k=Math.max(0,Math.min(1,(s.time-e.t)/.45)),fade=(1-k)*(reduceFx?.55:.9);
  const pull=e.mode==='pull'||e.mode==='yu-pull';
  c.save();c.globalCompositeOperation='lighter';
  c.strokeStyle='rgba(206,232,255,'+fade.toFixed(3)+')';c.lineWidth=2.4;c.lineCap='round';
  c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
  // 沿轨迹的箭头，方向指实际移动方向
  const ang=Math.atan2(b.y-a.y,b.x-a.x),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  c.strokeStyle='rgba(255,255,255,'+(fade*.8).toFixed(3)+')';c.lineWidth=2;
  c.beginPath();c.moveTo(mid.x-Math.cos(ang-.5)*7,mid.y-Math.sin(ang-.5)*7);c.lineTo(mid.x,mid.y);c.lineTo(mid.x-Math.cos(ang+.5)*7,mid.y-Math.sin(ang+.5)*7);c.stroke();
  // 落点环：向外扩散，拖拽/传送用冷色，推退用暖色
  c.strokeStyle=(pull?'rgba(180,222,255,':'rgba(255,206,158,')+fade.toFixed(3)+')';c.lineWidth=2;
  c.beginPath();c.ellipse(b.x,b.y,z.tw*(.22+k*.34),z.th*(.22+k*.34),0,0,Math.PI*2);c.stroke();
  c.restore();drew=true;
 }
 // 换血（归溟幽灵鲨 S1）：两端各一圈脉动 + 连接线，表示生命上限比例互换
 for(const e of recent(s.events,s.time,'hp-swap',.6)){
  if(e.targetX==null)continue;
  const a=point(e.x,e.y),b=point(e.targetX,e.targetY);
  const k=Math.max(0,Math.min(1,(s.time-e.t)/.6)),fade=(1-k)*(reduceFx?.6:1);
  c.save();c.globalCompositeOperation='lighter';
  c.strokeStyle='rgba(198,246,220,'+(fade*.85).toFixed(3)+')';c.lineWidth=2;
  c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
  for(const p of [a,b]){c.strokeStyle='rgba(255,255,255,'+(fade*.6).toFixed(3)+')';c.beginPath();c.ellipse(p.x,p.y,z.tw*(.2+k*.3),z.th*(.2+k*.3),0,0,Math.PI*2);c.stroke();}
  c.restore();drew=true;
 }
 return drew;
}
// 【S.E.E.S.】核心盟约的「弱点追击」：在触发位置画一圈扩散的白金环 + 比例标签。
// 事件由 `native-battle.seesCoreStrike` 发射（`{x,y,layers,percent}`），**纯表现**、不参与结算；
// `reduceFx` 只留静止环与标签。
export const SEES_CORE_EFFECT_SECONDS=1;
export function drawSeesCore(c,point,z,battle,{reduceFx=false,formatText=null}={}){
 const s=battle?.s;if(!s)return false;
 const hits=recent(s.events,s.time,'sees-core',SEES_CORE_EFFECT_SECONDS);
 if(!hits.length)return false;
 for(const e of hits){
  const p=point(e.x,e.y),k=reduceFx?1:Math.min(1,Math.max(0,s.time-e.t)/SEES_CORE_EFFECT_SECONDS),alpha=reduceFx?.55:Math.max(0,.62*(1-k));
  c.save();
  c.strokeStyle=`rgba(255,244,206,${alpha})`;c.lineWidth=Math.max(1.5,z.tw*.06);
  ring(c,p,z.tw*(.5+.9*k),z.tw*(.34+.62*k));
  if(!reduceFx){c.strokeStyle=`rgba(150,214,255,${alpha*.85})`;ring(c,p,z.tw*(.34+.66*k),z.tw*(.22+.46*k));}
  c.fillStyle=`rgba(255,246,214,${reduceFx?.85:Math.max(0,1-k)})`;c.font='bold 12px sans-serif';c.textAlign='center';
  const text=`S.E.E.S. 弱点追击 ${(Number(e.percent||0)*100).toFixed(1)}%`;
  c.fillText(formatText?formatText(text):text,p.x,p.y-z.tw*.72);
  c.restore();
 }
 return true;
}
function seesPixelRandom(seed,index){
 let value=(Number(seed)||0)+Math.imul(index+1,0x9e3779b1);value|=0;
 value=Math.imul(value^(value>>>16),0x7feb352d);value=Math.imul(value^(value>>>15),0x846ca68b);value^=value>>>16;
 return (value>>>0)/4294967296;
}
function seesFramePoint(progress,width,height,inset){
 const w=Math.max(1,width-inset*2),h=Math.max(1,height-inset*2),length=2*(w+h),d=((progress%1)+1)%1*length;
 if(d<w)return{x:inset+d,y:inset,tx:1,ty:0,nx:0,ny:1};
 if(d<w+h)return{x:inset+w,y:inset+d-w,tx:0,ty:1,nx:-1,ny:0};
 if(d<2*w+h)return{x:inset+w-(d-w-h),y:inset+h,tx:-1,ty:0,nx:0,ny:-1};
 return{x:inset,y:inset+h-(d-2*w-h),tx:0,ty:-1,nx:1,ny:0};
}
function drawSeesPixelBlade(c,x,y,angle,alpha,scale=1){
 c.save();c.translate(Math.round(x),Math.round(y));c.rotate(angle);c.globalCompositeOperation='lighter';
 for(let i=-9;i<=9;i++){
  const taper=1-Math.abs(i)/12,px=Math.round(i*3*scale),h=Math.max(2,Math.round((2+taper*2)*scale));
  c.fillStyle=`rgba(255,244,206,${(alpha*taper).toFixed(3)})`;c.fillRect(px,Math.round(-h/2),Math.max(2,Math.round(3*scale)),h);
  if(i%3===0){c.fillStyle=`rgba(150,214,255,${(alpha*taper*.68).toFixed(3)})`;c.fillRect(px,Math.round(h/2),Math.max(2,Math.round(2*scale)),Math.max(1,Math.round(scale)));}
 }
 c.restore();
}
function drawSeesCoreCornerHit(c,x,y,angle,alpha){
 if(alpha<=0)return;
 c.save();c.translate(Math.round(x),Math.round(y));c.rotate(angle);c.globalCompositeOperation='lighter';
 for(let i=0;i<5;i++){
  const reach=7+i*5,size=i<2?4:3,a=alpha*(1-i*.13);
  c.fillStyle=`rgba(255,244,206,${a.toFixed(3)})`;c.fillRect(reach,0,size,size);
  c.fillStyle=`rgba(150,214,255,${(a*.65).toFixed(3)})`;c.fillRect(-reach,-size,size,size);
 }
 c.restore();
}
// Battlefield frame S.E.E.S. presentation. It reads the same simulation-timed event as the local ring;
// pixel positions come from the event id, so frames stay stable and never affect combat state.
export function drawSeesCoreScreenFx(c,battle,width,height,{reduceFx=false}={}){
 const s=battle?.s;if(!s||width<=0||height<=0)return false;
 const hits=(s.events||[]).filter(e=>e.type==='sees-core'&&s.time-e.t>=0&&s.time-e.t<SEES_CORE_EFFECT_SECONDS);
 if(!hits.length)return false;
 c.save();
 for(const e of hits){
  const age=s.time-e.t,k=Math.max(0,Math.min(1,age/SEES_CORE_EFFECT_SECONDS)),fadeIn=Math.min(1,age/.055),fadeOut=Math.min(1,(1-k)/.24),fade=fadeIn*fadeOut;
  const inset=Math.max(6,Math.min(width,height)*.012),seed=Number(e.id)||Math.round((Number(e.t)||0)*1000);
  if(reduceFx){
   const alpha=.28*(1-k),length=Math.max(18,Math.min(width,height)*.085);
   c.fillStyle=`rgba(255,244,206,${alpha.toFixed(3)})`;
   for(const corner of [{x:inset,y:inset,sx:1,sy:1},{x:width-inset,y:inset,sx:-1,sy:1},{x:width-inset,y:height-inset,sx:-1,sy:-1},{x:inset,y:height-inset,sx:1,sy:-1}]){
    c.fillRect(Math.round(corner.x),Math.round(corner.y),Math.round(length*corner.sx),2);
    c.fillRect(Math.round(corner.x),Math.round(corner.y),2,Math.round(length*corner.sy));
   }
   continue;
  }
  const impact=Math.max(0,1-age/.17);
  c.globalCompositeOperation='lighter';
  c.strokeStyle=`rgba(255,236,174,${(fade*(.42+impact*.38)).toFixed(3)})`;
  c.lineWidth=2+impact*2;
  c.shadowColor='rgba(255,230,154,.9)';c.shadowBlur=8*fade;
  c.strokeRect(inset,inset,Math.max(1,width-2*inset),Math.max(1,height-2*inset));
  c.shadowBlur=0;
  if(impact>0){
   const corners=[{x:inset,y:inset,a:Math.PI/4},{x:width-inset,y:inset,a:3*Math.PI/4},{x:width-inset,y:height-inset,a:-Math.PI/4},{x:inset,y:height-inset,a:-3*Math.PI/4}];
   for(const corner of corners)drawSeesCoreCornerHit(c,corner.x,corner.y,corner.a,impact);
  }
  const perimeter=2*(Math.max(1,width-2*inset)+Math.max(1,height-2*inset));
  for(let blade=0;blade<4;blade++){
   const start=blade*.055,span=.74,progress=(age-start)/span;
   if(progress<0||progress>1)continue;
   const orbit=(progress*.9+blade*.25)%1,p=seesFramePoint(orbit,width,height,inset),bladeFade=Math.min(1,progress/.08,(1-progress)/.16)*fade;
   drawSeesPixelBlade(c,p.x+p.nx*3,p.y+p.ny*3,p.tx===0?Math.atan2(p.ty,p.tx)+(blade%2?-.58:.58):Math.atan2(p.ty,p.tx)+(blade%2?.58:-.58),bladeFade);
   for(let trail=1;trail<=7;trail++){
    const q=seesFramePoint(orbit-trail*5/perimeter,width,height,inset),a=bladeFade*(1-trail/8)*.6;
    c.fillStyle=`rgba(150,214,255,${a.toFixed(3)})`;c.fillRect(Math.round(q.x),Math.round(q.y),3,3);
   }
  }
  // Smoke breaks into blocky pixels along the perimeter and drifts just inside the frame.
  for(let i=0;i<20;i++){
   const seedA=seesPixelRandom(seed,i*5),seedB=seesPixelRandom(seed,i*5+1),seedC=seesPixelRandom(seed,i*5+2),born=.13+seedA*.4,life=.34+seedB*.28,p=(age-born)/life;
   if(p<0||p>1)continue;
   const edge=seesFramePoint(seedC+p*(seedB-.5)*.035,width,height,inset),drift=5+p*(10+seedA*18),size=Math.round(2+seedB*3);
   const x=Math.round(edge.x+edge.nx*drift+edge.tx*(seedA-.5)*9),y=Math.round(edge.y+edge.ny*drift+edge.ty*(seedA-.5)*9),alpha=(1-p)*fade*(.22+seedC*.2);
   c.fillStyle=`rgba(22,47,45,${alpha.toFixed(3)})`;c.fillRect(x,y,size,size);
   if(i%4===0){c.fillStyle=`rgba(126,223,192,${(alpha*.62).toFixed(3)})`;c.fillRect(x+size,y-size,2,2);}
  }
  // Short impact sparks; fixed event seeds prevent per-frame flicker.
  for(let i=0;i<18;i++){
   const seedA=seesPixelRandom(seed,120+i*3),seedB=seesPixelRandom(seed,121+i*3),seedC=seesPixelRandom(seed,122+i*3),born=.025+seedA*.42,life=.12+seedB*.15,p=(age-born)/life;
   if(p<0||p>1)continue;
   const edge=seesFramePoint(seedC,width,height,inset),distance=p*(12+seedA*28),side=(seedB-.5)*16,x=Math.round(edge.x+edge.nx*distance+edge.tx*side),y=Math.round(edge.y+edge.ny*distance+edge.ty*side),size=seedC>.55?3:2,alpha=(1-p)*fade*.9;
   c.fillStyle=i%3===0?`rgba(150,214,255,${alpha.toFixed(3)})`:`rgba(255,244,206,${alpha.toFixed(3)})`;c.fillRect(x,y,size,size);
  }
 }
 c.restore();
 return true;
}
function drawEgirReviveRings(c,point,z,battle,reduce){
 const {s}=battle;
 for(const e of recent(s.events,s.time,'revive',1)){
  if(e.reason!=='egir-revive')continue;
  const age=s.time-e.t,fade=1-age,actor=s.units.find(u=>u.uid===e.uid),p=point(actor?.x??e.x,actor?.y??e.y),cx=p.x,cy=p.y-z.th*.28,scale=.82+.24*age;
  c.save();c.lineWidth=Math.max(1.5,z.tw*.025);c.strokeStyle=rgba([120,205,255],.4*fade);c.beginPath();c.ellipse(cx,cy,z.tw*.43*scale,z.th*.33*scale,0,0,Math.PI*2);c.stroke();
  if(reduce){c.strokeStyle=rgba([120,205,255],.8*fade);c.beginPath();c.ellipse(cx,cy,z.tw*.34*scale,z.th*.25*scale,0,0,Math.PI*2);c.stroke();}
  else for(let i=0;i<2;i++){const direction=i?-1:1,phase=direction*age*Math.PI*3+i*Math.PI;c.strokeStyle=rgba(i?[190,237,255]:[77,181,255],.9*fade);c.lineWidth=Math.max(2,z.tw*.035);c.beginPath();c.ellipse(cx,cy,z.tw*(i?.32:.4)*scale,z.th*(i?.24:.3)*scale,phase*.06,phase,phase+Math.PI*1.1);c.stroke();}
  c.restore();
 }
}
export function drawFx(c,point,z,battle,opts={}){ const s=battle.s,t=s.time,reduce=!!opts.reduceFx;
 drawCombatFx(c,point,z,battle,reduce);
 drawZones(c,point,z,battle,{reduceFx:reduce});
 drawAuraField(c,point,z,battle,{reduceFx:reduce});
 drawSelfBurst(c,point,z,battle,{reduceFx:reduce});
 drawWideSweep(c,point,z,battle,{reduceFx:reduce});
 drawSkillFan(c,point,z,battle,{reduceFx:reduce});
 drawDisplace(c,point,z,battle,{reduceFx:reduce});
 drawEnemyPhase(c,point,z,battle,{reduceFx:reduce,formatText:opts.formatText});
 drawEnemyProjectiles(c,point,z,battle,{reduceFx:reduce});
 drawIceWind(c,z,battle,{reduceFx:reduce});
 drawSeesCore(c,point,z,battle,{reduceFx:reduce,formatText:opts.formatText});
 drawEgirReviveRings(c,point,z,battle,reduce);
 for(const e of s.effects||[]){
  if(e.type!=='healing'&&e.type!=='evade'&&e.type!=='block')continue;
  const p=point(e.x,e.y);c.fillStyle=e.type==='healing'?'#8fe8b5':'#f6e7c8';c.font='12px sans-serif';c.textAlign='center';c.fillText(opts.formatText?opts.formatText(e.text):e.text,p.x,p.y-24-(.6-e.life)*30);
 }
 for(const e of recent(s.events,t,'deploy',.4)){const p=point(e.x,e.y);c.strokeStyle='#8fe8b5';c.lineWidth=2;c.beginPath();c.ellipse(p.x,p.y+8,reduce?12:12+18*(t-e.t),5,0,0,Math.PI*2);c.stroke();}
 for(const e of recent(s.events,t,'skill-end',.3)){const p=point(e.x,e.y);c.strokeStyle=rgba(fxTint(battle,e.uid)?.main||FX_RING,1);c.strokeRect(p.x-12,p.y-12,24,24);}
 for(const e of recent(s.events,t,'skill-start',.45)){
  const p=point(e.x,e.y),k=1-(t-e.t)/.45,tint=fxTint(battle,e.uid);
  c.strokeStyle=rgba(tint?.main||FX_RING,.8*k);c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,14+8*(1-k),0,Math.PI*2);c.stroke();
  c.fillStyle=rgba(tint?.main||FX_RING,.9*k);c.font='11px sans-serif';c.textAlign='center';c.fillText(e.name||'技能',p.x,p.y-22);
 }
 for(const e of recent(s.events,t,'leak',1.2)){
  const p=point(e.x,e.y);c.fillStyle='#ffb48c';c.font='bold 14px sans-serif';c.textAlign='center';c.fillText('漏怪',p.x,p.y-18);
 }
 if(s.banner){c.fillStyle='#081511cc';c.fillRect(z.r.width/2-90,12,180,28);c.fillStyle='#e9fff7';c.font='bold 14px sans-serif';c.textAlign='center';c.fillText(opts.formatText?opts.formatText(s.banner.text):s.banner.text,z.r.width/2,32);}
 if(!reduce)for(const e of recent(s.events,t,'hit',.16)){const p=point(e.x,e.y);c.fillStyle='#fff8';c.beginPath();c.arc(p.x,p.y,11,0,Math.PI*2);c.fill();}
}
export function drawStatuses(c,x,y,unit,size){
 // cold and frozen are shown by drawFrostOverlay on the actor itself, so they get no head icon here.
 // 隐匿／迷彩本身由 drawConcealOverlay 的马赛克画在身上，这里只补一个头顶图标，让玩家能分清
 // 「看不见」和「只是被挡在后面」。与马赛克同口径：被阻挡（unit.block!=null）视为脱离隐匿，
 // 图标也一并收掉，否则会出现「没有马赛克却还挂着隐匿标」的矛盾画面。
 const kinds=[];
 for(const s of unit.statuses||[])if(['stun','sleep','silence','fear','selfFear','terror','tremble','root','invisible','camouflage','exposed'].includes(s.kind)&&!kinds.includes(s.kind))kinds.push(s.kind);
 if(unit.block!=null&&!unit.concealWhileBlocked)for(const kind of ['invisible','camouflage']){const i=kinds.indexOf(kind);if(i>=0)kinds.splice(i,1);}
 if((unit.shield||0)>0||(unit.shieldLayers||[]).some(l=>l.remaining>0))kinds.push('shield');
 if((unit.barriers||[]).some(b=>b.charges>0))kinds.push('barrier');
 kinds.slice(0,3).forEach((k,i)=>mark(c,x-size/2+6+i*13,y-size*.82,k));
}
const ELEMENT_RING_COLORS={neural:'#67c9ff',burn:'#ff875c',necrosis:'#c19aff',corrosion:'#b7d875',elemental:'#f3d27f'};
export function drawElementRing(c,x,y,unit,size){
 const raw=unit?.elemental,max=Number(unit?.elementalMax||(unit?.enemyRank==='BOSS'||unit?.trainingDummy?2000:1000))||0;
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

// 隐匿（我方由盟约提供、敌方由自身能力提供）：暗灰色滤镜 + 马赛克。
// 与 drawFrostOverlay 同形参（调用方给 box 与可选 image），只读单位状态，不参与索敌判定——
// 能不能被选中由 native-battle 的 targets() 决定（被阻挡的隐匿单位视为脱离隐匿）。
// 强度统一收在这张表里调，别再往下面写魔数：玩家必须还能认出「是谁在隐匿」，
// 所以整体是「淡灰 + 细马赛克」，只做提示、不做遮挡。detail 越大越清楚、block 越小越细，
// wash／块α／band 越低越透。改完记得 `node scripts/build-browser.mjs` 重编 bundle。
const CONCEAL_STYLE={
 wash:'rgba(110,118,126,0.22)',        // 灰色滤镜（原 0.45，压得人影都糊了）
 detail:10,                            // 有头像时的马赛克分辨率 detail×detail（原 6）
 block:5,                              // 无头像（召唤物／装置）时的马赛克块边长 px（原 6）
 blockDark:'rgba(54,60,68,0.28)',      // 深色块（原 0.5）
 blockLight:'rgba(154,162,172,0.22)',  // 浅色块（原 0.4）
 band:0.10,                            // 流光带峰值透明度（原 0.16）
};
let concealRasterCanvas=null,concealRasterContext=null;
function concealRaster(size){
 if(typeof document==='undefined')return null;
 if(!concealRasterCanvas){concealRasterCanvas=document.createElement('canvas');concealRasterContext=concealRasterCanvas.getContext('2d');}
 if(!concealRasterContext)return null;
 if(concealRasterCanvas.width!==size||concealRasterCanvas.height!==size){concealRasterCanvas.width=size;concealRasterCanvas.height=size;}
 concealRasterContext.clearRect(0,0,size,size);
 return concealRasterCanvas;
}
// 隐匿表现口径与索敌口径一致：形态/状态给出 invisible，但**被阻挡时视为脱离隐匿**
// （native-battle 的 targets() 就是「e.block!=null 即对所有人可选」），所以马赛克也要同步消失。
export function concealActive(actor){return !!actor&&!actor.hidden&&actor.invisible===true&&(actor.block==null||actor.concealWhileBlocked===true);}
export function drawConcealOverlay(c,actor,box,opts={}){
 if(!actor||!box||!(box.w>0)||!(box.h>0)||!concealActive(actor))return false;
 const reduce=!!opts.reduceFx,time=Number(opts.time)||0,im=opts.image,st=CONCEAL_STYLE;
 c.save();
 c.fillStyle=st.wash;c.fillRect(box.x,box.y,box.w,box.h);      // 灰色滤镜
 // 有头像时做真正的马赛克：先缩到独立小画布再放大，避免在战场画布上自读导致偶发黑屏；成像保持半透明。
 let mosaicked=false;
 if(im&&im.complete&&im.naturalWidth&&!reduce){
  try{
   const n=st.detail,raster=concealRaster(n);
   if(raster){
    concealRasterContext.drawImage(im,0,0,n,n);
    c.save();
    try{c.globalCompositeOperation='source-over';c.globalAlpha=.5;c.imageSmoothingEnabled=false;c.drawImage(raster,box.x,box.y,box.w,box.h);}
    finally{c.restore();}
    mosaicked=true;
   }
  }catch{mosaicked=false;}
 }
 if(!mosaicked){
  // 没有头像、拿不到离屏画布或绘制失败时，退化成半透明马赛克块，按时间错开相位形成流动感。
  const tile=reduce?st.block*1.5:st.block,cols=Math.ceil(box.w/tile),rows=Math.ceil(box.h/tile),phase=reduce?0:Math.floor(time*6)%4;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
   const k=(row*2+col*3+phase)%4;
   c.fillStyle=k%2?st.blockDark:st.blockLight;
   const x=box.x+col*tile,y=box.y+row*tile;
   if(x<box.x+box.w&&y<box.y+box.h)c.fillRect(x,y,Math.min(tile,box.x+box.w-x),Math.min(tile,box.y+box.h-y));
  }
 }
 if(!reduce){   // 缓慢扫过的一条淡灰光带，让「打码」和「渲染坏了」能区分开
  const band=(time*.35)%1.6-.3,g=c.createLinearGradient(box.x,box.y+box.h*band,box.x+box.w,box.y+box.h*(band+.4));
  g.addColorStop(0,'rgba(170,180,192,0)');g.addColorStop(.5,`rgba(170,180,192,${st.band})`);g.addColorStop(1,'rgba(170,180,192,0)');
  c.fillStyle=g;c.fillRect(box.x,box.y,box.w,box.h);
 }
 c.restore();
 return true;
}
// ── 再生形态（Revive）的表现 ──────────────────────────────────────────────
// 形态没有独立立绘（原表只有 prop_max_hp/interval，`<敌人页>/spine` 与模型图集也只有本体一套），
// 原作是同一套模型换动作。所以这里做两件事：①把立绘压一层形态色调（灰烬／傀儡）；
// ②在 enemy-phase 事件上补一次「收缩环 + 形态名 + 剩余次数」，让玩家读得出形态换了。
// 色调只改绘制结果，不参与任何判定。
export const FORM_TINT_STYLE={
 ember:{fill:'rgba(88,40,20,0.45)'},
 puppet:{fill:'rgba(58,46,78,0.45)'}
};
// 傀儡师（归溟幽灵鲨等）进入替身状态时，给头像盖一层**动态紫色特效**：紫色罩色 + 两条反向旋转的
// 弧环 + 一条上下扫过的高光带，让「这是替身、不是本体」一眼看得出来。reduceFx 时只留静止的一圈紫罩。
// 判定只看 actor.dollForm（native-effects 的 tickDoll 维护），与其它 overlay 一样不参与任何规则结算。
// 结城理（char_4217_makoto）的傀儡师替身是**人格面具**，按 `actor.persona` 换配色（用户 2026-09-27 口径，
// 依据 docs/PERSONA3_COLLAB_OPERATORS.md §5.4.1）：塔纳托斯＝半透明黑罩 + 深蓝流动；俄耳甫斯＝半透明白罩
// + 金色流动；`null`／未设置（归溟幽灵鲨等其它傀儡师）保持原来的紫色通用罩色。
export const DOLL_PERSONA_STYLE={thanatos:{tint:'rgba(0,0,0,.45)',flow:'#1b3fd8'},orpheus:{tint:'rgba(255,255,255,.45)',flow:'#e8c46a'}};
// '#rrggbb' → 'rgba(r,g,b,a)'：流动色只有一条十六进制定义，透明度在绘制处算，避免再抄一份色值。
function tintAlpha(hex,alpha){
 const raw=String(hex||'').replace('#',''),full=raw.length===3?raw.split('').map(c=>c+c).join(''):raw;
 const n=parseInt(full,16);
 return Number.isFinite(n)?`rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`:String(hex||'');
}
export function drawDollOverlay(c,actor,box,opts={}){
 if(!actor||!actor.dollForm||!box||!(box.w>0)||!(box.h>0))return false;
 const reduce=!!opts.reduceFx,time=Number(opts.time)||0,cx=box.x+box.w/2,cy=box.y+box.h/2;
 const persona=DOLL_PERSONA_STYLE[actor.persona]||null;   // null／未知值 ⇒ 保持原来的紫色通用罩色
 // 有 persona（结城理的人格面具）：半透明黑／白罩色 + 深蓝／金色流动；reduceFx 下只留静止罩色。
 if(persona){
  c.save();
  c.fillStyle=persona.tint;
  c.fillRect(box.x,box.y,box.w,box.h);
  if(!reduce){
   c.save();
   c.globalCompositeOperation='lighter';
   const r=Math.max(box.w,box.h)*.44;
   for(const [dir,alpha] of [[1,.52],[-1,.34]]){
    c.strokeStyle=tintAlpha(persona.flow,alpha);
    c.lineWidth=Math.max(1.5,box.w*.07);
    c.beginPath();c.arc(cx,cy,r*(1+.04*Math.sin(time*3.4)),time*2.4*dir,time*2.4*dir+Math.PI*1.15);c.stroke();
   }
   // 上下扫过的一条流光带（规格给的流动色是单一十六进制，用实色 + 正弦起落做出流动感）。
   const sweep=Math.abs((time*.8)%1.35)-.15,y=box.y+box.h*(1-sweep);
   const band=Math.max(0,Math.sin(Math.max(0,sweep)*Math.PI));
   if(band>0){c.strokeStyle=tintAlpha(persona.flow,band*.5);c.lineWidth=Math.max(1,box.h*.14);c.beginPath();c.moveTo(box.x,y);c.lineTo(box.x+box.w,y);c.stroke();}
   c.restore();
  }
  c.restore();
  return true;
 }
 // 通用紫色（归溟幽灵鲨等）：原有画法一个字都没改，既有回归（native-summon-lifecycle）继续成立。
 c.save();
 const wash=c.createLinearGradient?c.createLinearGradient(box.x,box.y,box.x,box.y+box.h):null;
 if(wash){wash.addColorStop(0,'rgba(158,96,226,0.46)');wash.addColorStop(.55,'rgba(122,72,198,0.22)');wash.addColorStop(1,'rgba(92,52,172,0.5)');c.fillStyle=wash;}
 else c.fillStyle='rgba(132,84,206,0.36)';
 c.fillRect(box.x,box.y,box.w,box.h);
 c.save();
 c.globalCompositeOperation='lighter';
 const r=Math.max(box.w,box.h)*.44;
 for(const [dir,alpha] of [[1,.52],[-1,.34]]){
  c.strokeStyle='rgba(200,156,255,'+alpha+')';c.lineWidth=Math.max(1.5,box.w*.07);
  c.beginPath();
  if(reduce)c.arc(cx,cy,r,0,Math.PI*2);
  else c.arc(cx,cy,r*(1+.04*Math.sin(time*3.4)),time*2.4*dir,time*2.4*dir+Math.PI*1.15);
  c.stroke();
 }
 if(!reduce){
  // 上下扫过的一条紫色光带：与隐匿马赛克的灰带同一手法，但换成紫色且更亮。
  const sweep=(time*.8)%1.35-.15,y=box.y+box.h*(1-sweep),band=c.createLinearGradient?c.createLinearGradient(0,y-box.h*.12,0,y+box.h*.12):null;
  if(band){band.addColorStop(0,'rgba(196,148,255,0)');band.addColorStop(.5,'rgba(226,196,255,.55)');band.addColorStop(1,'rgba(196,148,255,0)');c.fillStyle=band;c.fillRect(box.x,y-box.h*.12,box.w,box.h*.24);}
 }
 c.restore();
 c.restore();
 return true;
}
const formTintCache=new Map();
// 返回的对象被刻意补上 complete/naturalWidth/naturalHeight，好让它顶替 Image 传给
// drawImage 与 drawConcealOverlay（隐匿马赛克因此取的是同一张图）。立绘没解码完时不缓存，下一帧重试。
export function formTintedImage(image,kind){
 const style=FORM_TINT_STYLE[kind];
 if(!style||!image||!image.complete||!image.naturalWidth||typeof document==='undefined')return image;
 const key=(image.src||'')+'|'+kind;
 const cached=formTintCache.get(key);
 if(cached)return cached;
 const w=image.naturalWidth,h=image.naturalHeight;
 const cv=document.createElement('canvas');cv.width=w;cv.height=h;
 const g=cv.getContext('2d');
 if(!g)return image;
 g.drawImage(image,0,0,w,h);
 g.globalCompositeOperation='source-atop';g.fillStyle=style.fill;g.fillRect(0,0,w,h);
 cv.src=key;cv.complete=true;cv.naturalWidth=w;cv.naturalHeight=h;
 formTintCache.set(key,cv);
 return cv;
}
const PHASE_FX={
 'enemy-form':{span:1.5,color:'rgba(190,205,255,'},
 liberation:{span:1.5,color:'rgba(255,155,95,'},
 rebirth:{span:1,color:'rgba(255,178,120,'},
 'revive-form':{span:2.4,color:'rgba(255,150,90,'},
 'revive-revert':{span:1.2,color:'rgba(200,205,215,'}
};
export function drawEnemyProjectiles(c,point,z,battle,{reduceFx=false}={}){
 let drew=false;
 for(const shot of battle.s.enemyProjectiles||[]){
  const t=Math.max(0,Math.min(1,(battle.s.time-shot.startedAt)/Math.max(.001,shot.impactAt-shot.startedAt))),from=point(shot.startX,shot.startY),to=point(shot.targetX,shot.targetY);
  c.save();c.strokeStyle='rgba(255,139,92,.8)';c.lineWidth=1.5;
  c.beginPath();c.ellipse(to.x,to.y,z.tw*shot.radius*.5,z.th*shot.radius*.5,0,0,Math.PI*2);c.stroke();
  if(!reduceFx){c.fillStyle='#ffbd7c';c.beginPath();c.arc(from.x+(to.x-from.x)*t,from.y+(to.y-from.y)*t-Math.sin(t*Math.PI)*z.th,3,0,Math.PI*2);c.fill();}
  c.restore();drew=true;
 }
 return drew;
}
export function drawEnemyPhase(c,point,z,battle,{reduceFx=false,formatText=null}={}){
 const s=battle?.s;
 if(!s?.events)return false;
 let drew=false;
 for(const e of s.enemies||[])if(e.hp>0&&!e.hidden&&e.enemyCast?.wildCalling){
  const p=point(e.x,e.y),text='狂暴怒嗥 '+Math.max(0,e.enemyCast.endsAt-s.time).toFixed(1);c.save();c.font='bold 11px sans-serif';c.textAlign='center';c.fillStyle='#e497a1';c.fillText(formatText?formatText(text):text,p.x,p.y-z.th*.95-15);c.restore();drew=true;
 }
 for(const e of s.enemies||[])if(e.hp>0&&!e.hidden&&e.id==='enemy_2010_csdcr'&&e.scarletHits>=Number(e.enemyTalent?.['AttackSpeedUp.warning_stack_cnt'])){
  const p=point(e.x,e.y),text='受击 '+e.scarletHits+'/'+e.enemyTalent['AttackSpeedUp.stack_cnt'];c.save();c.font='bold 11px sans-serif';c.textAlign='center';c.fillStyle='#ff657b';c.fillText(formatText?formatText(text):text,p.x,p.y-z.th*.95-15);c.restore();drew=true;
 }
 for(const e of s.enemies||[])if(e.hp>0&&!e.hidden&&e.xiMarkEnabled)for(const [uid,label,color]of [[e.xiNearestUid,'◆ 最近','#ff9d86'],[e.xiFarthestUid,'◇ 最远','#8acaff']]){
  const target=[...(s.units||[]),...(s.summons||[])].find(a=>a.uid===uid&&a.deployed&&a.hp>0);if(!target)continue;
  const p=point(target.x,target.y);c.save();c.font='bold 10px sans-serif';c.textAlign='center';c.fillStyle=color;c.fillText(formatText?formatText(label):label,p.x,p.y-z.th*.95-18);c.restore();drew=true;
 }
 for(const e of s.enemies||[])if(e.hp>0&&!e.hidden&&e.mouseMarkEnabled)for(const [uid,label,color]of [[e.mouseMaxUid,'⊕ 最高生命','#ff887d'],[e.mouseMinUid,'▼ 最低生命','#86baff']]){
  const target=[...(s.units||[]),...(s.summons||[])].find(a=>a.uid===uid&&a.deployed&&a.hp>0);if(!target)continue;
  const p=point(target.x,target.y);c.save();c.font='bold 10px sans-serif';c.textAlign='center';c.fillStyle=color;c.fillText(formatText?formatText(label):label,p.x,p.y-z.th*.95-(uid===e.mouseMaxUid?26:14));c.restore();drew=true;
 }

 for(const e of s.enemies||[])if(e.hp>0&&!e.hidden&&e.parrotHasPassenger){const p=point(e.x,e.y);c.save();c.font='bold 11px sans-serif';c.textAlign='center';c.fillStyle='#f4d38b';c.fillText(formatText?formatText('携带水手'):'携带水手',p.x,p.y-z.th*.95-15);c.restore();drew=true;}
 for(const e of s.enemies||[])for(const bomb of e.enemyCast?.c4Targets||[]){
  const target=[...(s.units||[]),...(s.summons||[])].find(a=>a.uid===bomb.uid&&a.deployGen===bomb.deployGen&&a.deployed&&a.hp>0);if(!target)continue;
  const p=point(target.x,target.y),text='C4 '+Math.max(0,e.enemyCast.endsAt-s.time).toFixed(1);c.save();c.font='bold 11px sans-serif';c.textAlign='center';c.fillStyle='#ff997c';c.fillText(text,p.x,p.y-z.th*.95-15);c.restore();drew=true;
 }
 for(const fx of s.logicEffects||[])if(fx.values?.knightBomb&&fx.nextAt!=null){
  const target=[...(s.units||[]),...(s.summons||[])].find(a=>a.uid===fx.targetUid&&a.deployGen===fx.targetDeployGen&&a.deployed&&a.hp>0);if(!target)continue;
  const p=point(target.x,target.y),text='爆炸箭 '+Math.max(0,fx.nextAt-s.time).toFixed(1);c.save();c.font='bold 11px sans-serif';c.textAlign='center';c.fillStyle='#d9a5ff';c.fillText(formatText?formatText(text):text,p.x,p.y-z.th*.95-15);c.restore();drew=true;
 }
 for(const e of s.enemies||[])if(e.hp>0&&!e.hidden&&e.facingX!=null){const p=point(e.x,e.y),text=e.facingX>0?'正面 →':'← 正面';c.save();c.font='bold 11px sans-serif';c.textAlign='center';c.fillStyle='#f4d38b';c.fillText(formatText?formatText(text):text,p.x,p.y-z.th*.95-15);c.restore();drew=true;}
 for(const e of s.enemies||[])if(e.hp>0&&!e.hidden&&(e.parasiteTargetUid!=null||e.palsyCharges>0)){
  const p=point(e.x,e.y),text=e.parasiteTargetUid!=null?'寄生中':'麻痹 '+e.palsyCharges;
  c.save();c.font='bold 11px sans-serif';c.textAlign='center';c.fillStyle='#dfb1ed';c.fillText(formatText?formatText(text):text,p.x,p.y-z.th*.95-15);c.restore();drew=true;
 }
 for(const e of s.enemies||[])if(e.hp>0&&!e.hidden&&e.transport?.passengers.length){
  const p=point(e.x,e.y);c.save();c.font='bold 11px sans-serif';c.textAlign='center';c.fillStyle='#f4d38b';
  const text='载客 '+e.transport.passengers.length+'/'+e.transport.max;c.fillText(formatText?formatText(text):text,p.x,p.y-z.th*.95);c.restore();drew=true;
 }
 for(const e of s.events){
  const cfg=PHASE_FX[e.type==='enemy-phase'?e.phase:null];
  if(!cfg)continue;
  const age=s.time-e.t;
  if(age<0||age>cfg.span)continue;
  const live=(s.enemies||[]).find(x=>x.uid===e.uid);
  const p=point(live?live.x:e.x,live?live.y:e.y),lift=live?.flying?15:0;
  const k=Math.max(0,Math.min(1,age/cfg.span)),fade=1-k;
  c.save();c.lineWidth=2;
  c.strokeStyle=cfg.color+(fade*.9).toFixed(3)+')';
  const radius=z.tw*(.18+(e.phase==='revive-form'?k*.34:.3*fade));
  c.beginPath();c.ellipse(p.x,p.y-lift,radius,z.th*(radius/z.tw),0,0,Math.PI*2);c.stroke();
  if(!reduceFx){   // 灰烬粒：往上飘两粒，减少动效时只留环与文字
   c.fillStyle=cfg.color+(fade*.7).toFixed(3)+')';
   for(const [dx,scale]of [[8,1.6],[-11,1.2]]){c.beginPath();c.arc(p.x+Math.sin(age*9+dx)*8+dx,p.y-lift-z.th*.2-age*10,scale,0,Math.PI*2);c.fill();}
  }
  const text=e.phase==='enemy-form'?(e.form||'形态变化'):e.phase==='liberation'?'解放':e.phase==='revive-form'?`${e.form||'重生形态'}${e.hitCount?` ×${e.hitCount}`:''}`:e.phase==='rebirth'?'重生':'复原';
  if(fade>.15){c.fillStyle=cfg.color+Math.min(1,fade*1.6).toFixed(3)+')';c.font='bold 12px sans-serif';c.textAlign='center';c.fillText(formatText?formatText(text):text,p.x,p.y-lift-z.th*.62);}
  c.restore();drew=true;
 }
 // 腐败/凋零骑士的技能前摇：本体紫色发光闪烁（战斗里没有 DOM 头像，所以画在单位身上）。
 // 纯表现层：只读 battle 状态里的 windupUntil，不写任何逻辑字段。
 for(const e of s.enemies||[])if(e.hp>0&&!e.hidden&&e.enemyCast?.windupUntil!=null&&e.enemyCast.windupUntil>s.time){
  const p=point(e.x,e.y),lift=e.flying?15:0,left=Math.max(0,e.enemyCast.windupUntil-s.time);
  const pulse=reduceFx?.62:.52+.48*Math.sin(s.time*22);
  const radius=z.tw*(.4+.16*pulse);
  c.save();
  const glow=c.createRadialGradient(p.x,p.y-lift,0,p.x,p.y-lift,radius*1.7);
  glow.addColorStop(0,`rgba(198,138,255,${(.34+.34*pulse).toFixed(3)})`);
  glow.addColorStop(.55,`rgba(158,92,236,${(.22+.2*pulse).toFixed(3)})`);
  glow.addColorStop(1,'rgba(110,52,190,0)');
  c.fillStyle=glow;c.beginPath();c.arc(p.x,p.y-lift,radius*1.7,0,Math.PI*2);c.fill();
  c.lineWidth=2.4;c.strokeStyle=`rgba(224,180,255,${(.45+.5*pulse).toFixed(3)})`;
  c.beginPath();c.ellipse(p.x,p.y-lift,radius,z.th*.46,0,0,Math.PI*2);c.stroke();
  c.font='bold 11px sans-serif';c.textAlign='center';c.fillStyle='#e6c8ff';
  const windupText='蓄力 '+left.toFixed(1);c.fillText(formatText?formatText(windupText):windupText,p.x,p.y-lift-z.th*.62);
  c.restore();drew=true;
 }
 return drew;
}

export function drawDominion(c,point,z,battle){
 const cells=Object.values(battle?.s?.dominionCells||{});if(!cells.length||battle.s.benchmark)return false;
 c.save();c.fillStyle='rgba(33,18,48,.55)';c.strokeStyle='rgba(146,108,170,.55)';c.lineWidth=1;
 for(const cell of cells){const p=point(cell.x,cell.y);c.fillRect(p.x-z.tw/2,p.y-z.th/2,z.tw,z.th);c.strokeRect(p.x-z.tw/2+.5,p.y-z.th/2+.5,z.tw-1,z.th-1);}
 c.restore();return true;
}
