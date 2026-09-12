import {OP,OPERATORS,CLASSES,ENEMIES} from './data.js';
const imageCache=new Map();
function asset(url){if(!imageCache.has(url)){const img=new Image();img.src=url;imageCache.set(url,img);}return imageCache.get(url);}
for(const op of OPERATORS)asset(`./assets/${op.id}-avatar.png`);
const enemyImage=id=>asset(`./assets/enemy-${id==='heavy'?'defender':id}.png`);

export class Battlefield {
 constructor(canvas,game){this.canvas=canvas;this.ctx=canvas.getContext('2d');if(!this.ctx)throw new Error('当前浏览器无法创建 Canvas 画布，请使用最新版 Edge、Chrome 或 Firefox。');this.game=game;this.effects=[];this.selection=null;this.hover=null;this.paths=true;this.grid=true;this.time=0;this.width=800;this.height=520;this.scale=1;if(typeof ResizeObserver==='function'){this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);}else window.addEventListener('resize',()=>this.resize());this.resize();}
 resize(){const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);this.width=rect.width;this.height=rect.height;this.canvas.width=Math.round(rect.width*dpr);this.canvas.height=Math.round(rect.height*dpr);this.ctx.setTransform(dpr,0,0,dpr,0,0);this.scale=Math.min((this.width-38)/11.7,(this.height-40)/4.7);this.tw=this.scale;this.th=this.scale*.60;this.ox=(this.width-this.tw*11)/2;this.oy=(this.height-this.th*7)/2-3;}
 point(x,y){return {x:this.ox+(x+.5)*this.tw+(3-y)*this.tw*.035,y:this.oy+(y+.5)*this.th};}
 cell(px,py){const rect=this.canvas.getBoundingClientRect(),yy=(py-rect.top-this.oy)/this.th,y=Math.floor(yy),x=Math.floor((px-rect.left-this.ox-(3-y)*this.tw*.035)/this.tw);return {x,y};}
 add(effect){if(effect.x===null||effect.y===null)return;this.effects.push({...effect,age:0,life:effect.type==='skill'?1.45:effect.type==='hit'?.45:.75});if(this.effects.length>200)this.effects.splice(0,50);}
 clear(){this.effects=[];}
 roundRect(x,y,w,h,r=0){const c=this.ctx;c.beginPath();if(r)c.roundRect(x,y,w,h,r);else c.rect(x,y,w,h);}
 line(points,color,width=1){const c=this.ctx;c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle=color;c.lineWidth=width;c.stroke();}
 draw(dt=0){this.time+=dt;const c=this.ctx,w=this.width,h=this.height,g=this.game,s=g.s,t=this.tw,th=this.th;if(!w||!h)return;c.clearRect(0,0,w,h);
  const bg=c.createLinearGradient(0,0,w,h);bg.addColorStop(0,'#172229');bg.addColorStop(1,'#10181d');c.fillStyle=bg;c.fillRect(0,0,w,h);
  // Coordinate grid outside the play area is a navigational aid.
  c.strokeStyle='#718e9e0c';c.lineWidth=1;for(let x=0;x<w;x+=24){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}for(let y=0;y<h;y+=24){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}
  const pathSet=new Set(g.map.paths.flat().map(p=>p.join(',')));
  const selected=s.units.find(u=>u.uid===this.selection);let rangeSet=new Set();if(selected?.x!==null&&selected?.x!==undefined){const bu=s.battle?.units.find(u=>u.uid===selected.uid);const extra=g.rangeExtra(selected);rangeSet=new Set(g.rangeCells(selected,extra).map(p=>p.join(',')));}
  for(let y=0;y<g.map.rows;y++)for(let x=0;x<g.map.cols;x++){
   const p=this.point(x,y),type=g.tile(x,y),path=pathSet.has(`${x},${y}`),high=type==='high';const tx=p.x-t*.48,ty=p.y-th*.47-(high?5:0),ww=t*.96,hh=th*.94;
   if(type==='blocked'){c.fillStyle='#0c151a';c.fillRect(tx,ty,ww,hh);c.strokeStyle='#2b3c45';c.lineWidth=.7;c.strokeRect(tx+4,ty+4,ww-8,hh-8);c.strokeStyle='#26373f';c.beginPath();c.moveTo(tx+ww*.3,ty+hh*.35);c.lineTo(tx+ww*.7,ty+hh*.65);c.moveTo(tx+ww*.7,ty+hh*.35);c.lineTo(tx+ww*.3,ty+hh*.65);c.stroke();continue;}
   c.fillStyle=high?'#1f2e36':'#18252d';c.fillRect(tx,ty+5,ww,hh);
   const grad=c.createLinearGradient(tx,ty,tx,ty+hh);if(high){grad.addColorStop(0,'#5a6d77');grad.addColorStop(1,'#425760');}else if(path){grad.addColorStop(0,'#414e53');grad.addColorStop(1,'#323f45');}else{grad.addColorStop(0,'#2a3b43');grad.addColorStop(1,'#25353d');}c.fillStyle=grad;c.fillRect(tx,ty,ww,hh);
   if(this.grid){c.strokeStyle=high?'#8398a155':path?'#697e8840':'#60778135';c.lineWidth=.75;c.strokeRect(tx+.5,ty+.5,ww-1,hh-1);c.fillStyle='#b2cbd31a';for(const [xx,yy] of [[tx+4,ty+4],[tx+ww-5,ty+4],[tx+4,ty+hh-5],[tx+ww-5,ty+hh-5]])c.fillRect(xx,yy,1.4,1.4);}
   if(high){c.fillStyle='#94adbb38';c.fillRect(tx+ww*.2,ty+hh-3,ww*.6,1);}
   if(rangeSet.has(`${x},${y}`)){c.fillStyle='#93dbe32b';c.fillRect(tx,ty,ww,hh);c.strokeStyle='#a0eaf060';c.strokeRect(tx,ty,ww,hh);}
   if(this.hover?.x===x&&this.hover?.y===y&&selected&&s.phase==='prep'){c.fillStyle=g.canPlace(selected,x,y)?'#8cd5dd33':'#ff6b4133';c.fillRect(tx,ty,ww,hh);c.strokeStyle=g.canPlace(selected,x,y)?'#a2e7ed':'#ff825b';c.lineWidth=2;c.strokeRect(tx,ty,ww,hh);}
  }
  // Flow routes and portal markings use the exact movement paths.
  if(this.paths)for(let i=0;i<g.map.paths.length;i++){const path=g.map.paths[i];c.setLineDash([5,8]);this.line(path.map(p=>this.point(...p)),'#f99b5e44',1.3);c.setLineDash([]);if(s.phase!=='battle')for(let j=2;j<path.length-1;j+=3){const p=this.point(...path[j]),prev=path[j-1],next=path[j];let angle=Math.atan2(next[1]-prev[1],next[0]-prev[0]);c.save();c.translate(p.x,p.y);c.rotate(angle);this.line([{x:-4,y:-3},{x:0,y:0},{x:-4,y:3}],'#d6a58699',1.2);c.restore();}}
  const portals=new Map();for(const p of g.map.paths){portals.set(p[0].join(','),{pos:p[0],entry:true});portals.set(p.at(-1).join(','),{pos:p.at(-1),entry:false});}for(const {pos,entry} of portals.values()){const p=this.point(...pos);c.fillStyle=entry?'#e5693940':'#71c9e04d';c.fillRect(p.x-t*.45,p.y-th*.44,t*.9,th*.88);c.strokeStyle=entry?'#ff8e61':'#9aedff';c.lineWidth=2;c.strokeRect(p.x-t*.38,p.y-th*.37,t*.76,th*.74);c.fillStyle=entry?'#ffaf88':'#c1f6ff';c.font=`600 ${t*.33}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(entry?'›':'⌂',p.x,p.y);c.font=`${Math.max(7,t*.14)}px monospace`;c.fillText(entry?'ENTRY':'DEFEND',p.x,p.y+th*.28);}
  // Tile coordinates remain legible at desktop and phone sizes.
  c.fillStyle='#78929f';c.font=`${Math.max(8,t*.15)}px monospace`;c.textAlign='center';for(let x=0;x<g.map.cols;x++){let p=this.point(x,0);c.fillText(String(x+1).padStart(2,'0'),p.x,this.oy-11);}for(let y=0;y<g.map.rows;y++){let p=this.point(0,y);c.fillText(String.fromCharCode(65+y),this.ox-13,p.y);}
  let drawUnits=s.phase==='battle'||s.phase==='intermission'||s.phase==='finished'?s.battle?.units||[]:g.onField;
  const actors=[...drawUnits.map(u=>({type:'unit',v:u,y:u.y})),...(s.battle?.enemies||[]).map(e=>({type:'enemy',v:e,y:e.y}))].sort((a,b)=>a.y-b.y);
  for(const actor of actors)actor.type==='unit'?this.drawUnit(actor.v):this.drawEnemy(actor.v);
  if(s.battle?.drone){const d=s.battle.drone,p=this.point(d.x,d.y);c.strokeStyle='#98edc87a';c.lineWidth=2;c.beginPath();c.ellipse(p.x,p.y,t*1.6,th*1.6,0,0,Math.PI*2);c.stroke();c.fillStyle='#afffd3';c.font=`bold ${t*.36}px sans-serif`;c.textAlign='center';c.fillText('✚',p.x,p.y-th*.7);}
  for(const e of this.effects){e.age+=dt;if(e.age>=e.life)continue;const p=this.point(e.x,e.y),a=1-e.age/e.life;c.globalAlpha=a;
   if(e.type==='hit'||e.type==='enemyHit'||e.type==='heal'){
    const color=e.type==='heal'?'#b0ecc4':e.type==='enemyHit'?'#ff7d52':e.damageType==='arts'?'#c6a8fd':e.damageType==='true'?'#ffffff':'#ffe7b0';
    if(e.from&&e.age<.14){const from=this.point(...e.from);this.line([{x:from.x,y:from.y-th*.24},{x:p.x,y:p.y-th*.15}],color,e.type==='heal'?1:1.7);}
    if(e.value&&e.value>5&&e.type!=='heal'){c.font=`600 ${Math.max(10,t*.23)}px 'Barlow Condensed',sans-serif`;c.textAlign='center';c.fillStyle='#061018';c.fillText(e.value,p.x+1,p.y-th*.65-e.age*23+1);c.fillStyle=color;c.fillText(e.value,p.x,p.y-th*.65-e.age*23);}
   }else if(e.type==='skill'){c.strokeStyle='#f0d389';c.lineWidth=1.4;c.beginPath();c.ellipse(p.x,p.y,t*(.35+e.age*.4),th*(.3+e.age*.35),0,0,Math.PI*2);c.stroke();if(e.age<1.2){c.font=`600 ${Math.max(9,t*.18)}px sans-serif`;c.textAlign='center';c.fillStyle='#fff0b5';c.fillText(e.text,p.x,p.y-th*.85-e.age*4);}}
   else{const color=e.type==='leak'||e.type==='boss'?'#ff8055':e.type==='down'?'#e87858':'#b0f3ef';c.strokeStyle=color;c.lineWidth=2;c.beginPath();c.ellipse(p.x,p.y,t*(.3+e.age*(e.type==='boss'?3:1)),th*(.3+e.age*(e.type==='boss'?3:1)),0,0,Math.PI*2);c.stroke();}
   c.globalAlpha=1;
  }this.effects=this.effects.filter(e=>e.age<e.life);
  c.textAlign='left';c.textBaseline='alphabetic';c.fillStyle='#70929f66';c.font='10px monospace';c.fillText(`SECTOR ${g.map.code}  /  ${g.map.cols} × ${g.map.rows}`,15,h-15);
  if(s.phase==='battle'&&s.battle){c.textAlign='right';c.fillStyle='#8facb7';c.font='12px monospace';c.fillText(`DP ${Math.floor(s.battle.dp).toString().padStart(2,'0')}   ${Math.floor(s.battle.time/60).toString().padStart(2,'0')}:${Math.floor(s.battle.time%60).toString().padStart(2,'0')}`,w-15,h-15);if(s.battle.time>s.battle.limit){c.fillStyle='#ff9b70';c.font='bold 12px sans-serif';c.fillText('战场恶化 · 敌方持续强化',w-15,23);}}
 }
 drawUnit(u){const c=this.ctx,t=this.tw,th=this.th,p=this.point(u.x,u.y),o=OP[u.id],inBattle=u.stats!==undefined,down=inBattle&&u.hp===0,size=t*.66,high=this.game.tile(u.x,u.y)==='high',cy=p.y-th*.17-(high?5:0);c.save();if(inBattle&&!u.deployed&&!down)c.globalAlpha=.3;if(down)c.globalAlpha=.42;
  c.fillStyle='#03121ca1';c.beginPath();c.ellipse(p.x,p.y+th*.22,t*.39,th*.2,0,0,Math.PI*2);c.fill();
  c.fillStyle=u.elite?'#e9c878':'#9cdbe0';c.fillRect(p.x-size/2-2,cy-size/2-2,size+4,size+4);const img=asset(`./assets/${u.id}-avatar.png`);if(img.complete&&img.naturalWidth)c.drawImage(img,p.x-size/2,cy-size/2,size,size);else{c.fillStyle='#354f5c';c.fillRect(p.x-size/2,cy-size/2,size,size);c.fillStyle='#e0f4fc';c.textAlign='center';c.font=`${t*.3}px sans-serif`;c.fillText(o.name[0],p.x,cy+5);}
  c.fillStyle='#041016ba';c.fillRect(p.x-size/2,cy+size*.2,size,size*.32);c.fillStyle='#effbff';c.font=`600 ${Math.max(7,t*.15)}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(o.name,p.x,cy+size*.36);
  if(u.elite){c.fillStyle='#edd087';c.font=`bold ${t*.17}px sans-serif`;c.textAlign='left';c.fillText('✦',p.x-size*.48,cy-size*.4);}
  const angle=[0,Math.PI/2,Math.PI,-Math.PI/2][u.dir];c.save();c.translate(p.x,cy);c.rotate(angle);c.fillStyle='#bcf3f7';c.beginPath();c.moveTo(size*.67,0);c.lineTo(size*.52,-4);c.lineTo(size*.52,4);c.fill();c.restore();
  if(inBattle){const bw=size+4,bx=p.x-bw/2,by=cy+size/2+4;c.fillStyle='#11191e';c.fillRect(bx,by,bw,4);c.fillStyle=u.hp/u.maxHp<.3?'#ee815e':'#a2e0d3';c.fillRect(bx,by,bw*Math.max(0,u.hp/u.maxHp),4);const sk=this.game.skill(this.game.s.units.find(v=>v.uid===u.uid));c.fillStyle=u.active>0?'#f4d38b':'#7bbaf3';c.fillRect(bx,by+5,bw*(u.active>0?1:Math.min(1,u.sp/sk.sp)),2);if(u.shield>0){c.strokeStyle='#f7df9cb0';c.lineWidth=2;c.strokeRect(p.x-size/2-4,cy-size/2-4,size+8,size+8);}}
  if(this.selection===u.uid){c.strokeStyle='#d4ffff';c.lineWidth=2;c.strokeRect(p.x-size/2-5,cy-size/2-5,size+10,size+10);}
  c.restore();if(down){c.fillStyle='#f8ede0';c.textAlign='center';c.font=`600 ${t*.26}px 'Barlow Condensed',sans-serif`;c.fillText(u.down>0?`${Math.ceil(u.down)}s`:`DP ${u.stats.dp}`,p.x,cy);}
 }
 drawEnemy(e){const c=this.ctx,t=this.tw,th=this.th,p=this.point(e.x,e.y),size=t*(e.boss?.8:.51),cy=p.y-(e.flying?th*.6:th*.19);c.save();c.fillStyle='#070d10a8';c.beginPath();c.ellipse(p.x,p.y+th*.19,t*.27,th*.12,0,0,Math.PI*2);c.fill();
  c.fillStyle=e.boss?'#ad683060':'#8f4b3855';c.beginPath();c.arc(p.x,cy,size*.55,0,Math.PI*2);c.fill();c.strokeStyle=e.boss?'#ffb576':'#e7896980';c.lineWidth=e.boss?2:1;c.stroke();const img=enemyImage(e.icon);if(img.complete&&img.naturalWidth)c.drawImage(img,p.x-size/2,cy-size/2,size,size);else{c.fillStyle='#f0ad8d';c.font=`${size*.6}px sans-serif`;c.textAlign='center';c.fillText(e.glyph,p.x,cy+size*.2);}
  c.fillStyle='#170e0b';c.fillRect(p.x-size/2,cy-size*.65,size,3);c.fillStyle=e.boss?'#f0b774':'#e78e6c';c.fillRect(p.x-size/2,cy-size*.65,size*Math.max(0,e.hp/e.maxHp),3);if(e.shield>0){c.fillStyle='#d9c185';c.fillRect(p.x-size/2,cy-size*.65-4,size*e.shield/e.maxShield,2);}
  if(e.slow<1){c.strokeStyle='#9ae4f478';c.beginPath();c.arc(p.x,cy,size*.6,0,Math.PI*2);c.stroke();}if(e.stun>0){c.fillStyle='#f4dc86';c.font=`${t*.24}px sans-serif`;c.textAlign='center';c.fillText('✧',p.x,cy-size*.8);}if(e.boss){c.fillStyle='#f5dbb0';c.font=`600 ${Math.max(9,t*.17)}px sans-serif`;c.textAlign='center';c.fillText(e.name,p.x,cy+size*.8);}c.restore();
 }
}
