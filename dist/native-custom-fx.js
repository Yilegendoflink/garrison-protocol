// 纯绘制与战斗资源 UI；读取实际实体/事件，绝不写战斗状态。
import {tileLiftAmount} from './protocol.js';
const COLORS={char_1035_wisdel:'#ff985e',char_1050_chen3:'#ed7570',char_4132_ascln:'#b793de',char_2027_wang:'#e6d5a3',char_4231_clemnt:'#82badc'};
const line=(c,a,b)=>{c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();};
const ring=(c,p,x,y)=>{c.beginPath();c.ellipse(p.x,p.y,x,y,0,0,Math.PI*2);c.stroke();};
const cross=(c,p,r)=>{line(c,{x:p.x-r,y:p.y},{x:p.x+r,y:p.y});line(c,{x:p.x,y:p.y-r},{x:p.x,y:p.y+r});};
const cell=(c,p,z)=>c.strokeRect(p.x-z.tw*.46,p.y-z.th*.46,z.tw*.92,z.th*.92);
function shardBurst(c,p,z,phase,reduced){for(let k=0;k<(reduced?4:9);k++){const angle=k*Math.PI*2/(reduced?4:9),r=z.tw*(.15+phase*.38);line(c,{x:p.x+Math.cos(angle)*r,y:p.y+Math.sin(angle)*r*.7},{x:p.x+Math.cos(angle)*(r+z.tw*.08),y:p.y+Math.sin(angle)*(r+z.tw*.08)*.7});}}
export function renderCustomBattleControls(game,selectedUid=null){
 const b=game?.battle;if(game?.s.phase!=='battle'||!b)return '';
 const units=b.s.units.filter(u=>u.deployed&&u.hp>0&&COLORS[u.id]);if(!units.length)return b.s.units.some(u=>COLORS[u.id])?'<div class="native-custom-actions"></div>':'';
 return `<div class="native-custom-actions">${units.map(u=>{const p=b.profile(u),s=p.skillIndex??u.source?.skillIndex??0,c=u.custom||{},active=b.skillActive(u),resource=u.id==='char_2027_wang'?`棋子 ${c.stock||0}/${c.stockCap||0} · 场上 ${b.s.summons.filter(t=>t.type==='wang-stone'&&t.ownerUid===u.uid&&t.deployed).length}/${c.deployCap||0}`:u.ammo>0?`弹药 ${u.ammo}/${u.ammoMax}`:c.phase==='slashing'?`斩击 ${c.chain?.remaining||0}`:active?`${Math.max(0,u.skillLeft).toFixed(1)} 秒`:'';return `<span><b>${p.name}</b>${resource?`<small>${resource}</small>`:''}${u.id==='char_2027_wang'?`<button data-act="custom-stone" data-uid="${u.uid}" aria-pressed="${selectedUid===u.uid}" class="${selectedUid===u.uid?'chosen':''}">${selectedUid===u.uid?'取消投子':'投放棋子'}</button>`:''}${active&&(u.id==='char_1035_wisdel'&&s>0||['char_2027_wang','char_4231_clemnt'].includes(u.id)&&s===2)?`<button data-act="custom-stop" data-uid="${u.uid}">停止技能</button>`:''}</span>`;}).join('')}</div>`;
}
export function drawCustomGround(c,point,z,battle,{reduceFx=false}={}){
 const b=battle,s=b?.s;if(!s)return;c.save();c.lineWidth=1.5;
 for(const u of s.units.filter(u=>u.deployed&&u.hp>0&&COLORS[u.id])){
  const p=b.profile(u),index=p.skillIndex??u.source?.skillIndex??0;
  if(u.id==='char_4132_ascln'&&b.skillActive(u)&&index>0){c.strokeStyle=COLORS[u.id];c.globalAlpha=.35;for(const t of b.range(u,true))cell(c,point(t.x,t.y),z);c.globalAlpha=1;}
 }
 for(const f of s.customEffects||[]){const p=point(f.x||0,f.y||0);c.strokeStyle=f.type==='sword'?'#ef8279':f.type==='follower'?'#ebdfbf':'#8ac5db';c.globalAlpha=.65;
  if(f.type==='vortex'){ring(c,p,z.tw*1.5,z.th*1.5);if(!reduceFx){c.globalAlpha=.12;c.fillStyle='#72bbd3';c.beginPath();c.ellipse(p.x,p.y,z.tw*1.5,z.th*1.5,0,0,Math.PI*2);c.fill();c.globalAlpha=.4;for(let k=0;k<3;k++){const a=s.time*2+k*Math.PI*2/3;line(c,point(f.x+Math.cos(a)*.3,f.y+Math.sin(a)*.3),point(f.x+Math.cos(a+.6)*1.2,f.y+Math.sin(a+.6)*1.2));}}}
  if(f.type==='bomb'){for(const [x,y]of [[0,0],[1,0],[-1,0],[0,1],[0,-1]])cell(c,point(f.x+x,f.y+y),z);c.globalAlpha=1;cross(c,p,z.tw*.18);}
  if(f.type==='follower'){c.globalAlpha=.9;ring(c,p,z.tw*.12,z.th*.13);if(f.customDirs?.length)cross(c,p,z.tw*.18);}
 }
 const nodes=[...(s.summons||[]).filter(t=>t.type==='wang-stone'&&t.deployed),...(s.customEffects||[]).filter(t=>t.type==='follower')];c.strokeStyle='#ded0a7';c.globalAlpha=.6;
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)if(nodes[i].ownerUid===nodes[j].ownerUid&&Math.abs(nodes[i].x-nodes[j].x)+Math.abs(nodes[i].y-nodes[j].y)===1)line(c,point(nodes[i].x,nodes[i].y),point(nodes[j].x,nodes[j].y));
 c.restore();
}
export function drawCustomFx(c,point,z,battle,{reduceFx=false,enemyOffsets=null}={}){
 const b=battle,s=b?.s;if(!s)return;c.save();c.lineWidth=1.7;c.lineCap='round';
 for(const token of (s.summons||[]).filter(t=>t.deployed&&t.hp>0&&['wisdel-shadow','wang-stone'].includes(t.type))){const p=point(token.x,token.y);p.y-=tileLiftAmount(b.map.grid[token.y]?.[token.x],z.th)*.5;c.save();
  if(token.type==='wisdel-shadow'){c.fillStyle='#182127';c.strokeStyle='#a0bdc3';c.globalAlpha=.9;c.beginPath();c.moveTo(p.x-z.tw*.28,p.y+z.th*.18);c.quadraticCurveTo(p.x-z.tw*.34,p.y-z.th*.42,p.x-z.tw*.12,p.y-z.th*.64);c.lineTo(p.x-z.tw*.08,p.y-z.th*.85);c.lineTo(p.x+z.tw*.07,p.y-z.th*.66);c.quadraticCurveTo(p.x+z.tw*.35,p.y-z.th*.32,p.x+z.tw*.25,p.y+z.th*.18);c.closePath();c.fill();c.stroke();c.strokeStyle='#ef9b63';line(c,{x:p.x-z.tw*.09,y:p.y-z.th*.42},{x:p.x+z.tw*.09,y:p.y-z.th*.42});if(!reduceFx){c.globalAlpha=.4;const drift=Math.sin(s.time*2+token.uid)*z.tw*.06;ring(c,{x:p.x+drift,y:p.y+z.th*.17},z.tw*.31,z.th*.13);}}
  else{c.fillStyle='#332e28';c.strokeStyle='#dcca9f';c.beginPath();c.ellipse(p.x,p.y,z.tw*.22,z.th*.23,0,0,Math.PI*2);c.fill();c.stroke();c.fillStyle='#e7d6b3';c.font=`bold ${Math.max(11,z.tw*.22)}px serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('子',p.x,p.y);if(token.customDirs?.length){c.globalAlpha=.7;ring(c,p,z.tw*.3,z.th*.31);}}
  c.restore();
 }
 for(const u of s.units.filter(u=>u.deployed&&u.hp>0&&COLORS[u.id])){const p=point(u.x,u.y),state=u.custom||{};c.strokeStyle=COLORS[u.id];c.fillStyle=COLORS[u.id];
  if(u.id==='char_1035_wisdel'&&state.lockedUid!=null&&b.skillActive(u)){const e=s.enemies.find(e=>e.uid===state.lockedUid&&e.hp>0);if(e){const t=point(e.x,e.y);ring(c,t,z.tw*.2,z.th*.22);cross(c,t,z.tw*.3);}}
  if(u.id==='char_1050_chen3'&&state.evadeReady){c.beginPath();c.moveTo(p.x+z.tw*.3,p.y-z.th*.85);c.lineTo(p.x+z.tw*.44,p.y-z.th*.67);c.lineTo(p.x+z.tw*.3,p.y-z.th*.48);c.stroke();}
  if(u.id==='char_4132_ascln'&&b.skillActive(u)&&(b.profile(u).skillIndex??u.source?.skillIndex)===2){c.globalAlpha=reduceFx?.25:.45;for(let k=0;k<(reduceFx?2:4);k++){const sign=k%2?1:-1,a=(k>>1)*.18;c.beginPath();c.moveTo(p.x,p.y-z.th*.35);c.quadraticCurveTo(p.x+sign*z.tw*(.2+a),p.y-z.th*(.95+a),p.x+sign*z.tw*(.55+a),p.y-z.th*.4);c.stroke();}c.globalAlpha=1;}
 }
 for(const e of s.enemies.filter(e=>e.hp>0&&!e.hidden)){const p=point(e.x,e.y),off=enemyOffsets?.get(e.uid);if(off){p.x+=off.x;p.y+=off.y;}if(e.flying)p.y-=15;
  if(Object.keys(e.customResidues||{}).length){c.strokeStyle='#ff9b62';c.beginPath();c.moveTo(p.x+z.tw*.2,p.y-z.th*.45);c.lineTo(p.x+z.tw*.28,p.y-z.th*.66);c.lineTo(p.x+z.tw*.34,p.y-z.th*.45);c.stroke();}
  const stacks=Object.values(e.customAscln||{}).reduce((n,m)=>Math.max(n,m.layers||0),0);if(stacks){c.fillStyle='#c6a1ec';for(let k=0;k<stacks;k++)c.fillRect(p.x-z.tw*.17+k*6,p.y+z.th*.26,4,5);}
 }
 for(const f of s.customEffects||[]){const p=point(f.x||0,f.y||0);
  if(f.type==='sword'){c.strokeStyle='#f49588';const to=point(f.x+f.dx*.55,f.y+f.dy*.55),from=point(f.x-f.dx*.6,f.y-f.dy*.6);c.lineWidth=3;line(c,from,to);cross(c,to,z.tw*.07);c.lineWidth=1.7;}
  if(f.type==='ship'){c.strokeStyle='#a9e2f0';c.fillStyle='#254961';c.beginPath();c.moveTo(p.x,p.y-z.th*.3);c.lineTo(p.x+z.tw*.3,p.y);c.lineTo(p.x,p.y+z.th*.3);c.lineTo(p.x-z.tw*.3,p.y);c.closePath();c.fill();c.stroke();c.font='10px sans-serif';c.fillStyle='#dbf5fc';c.textAlign='center';c.fillText(`${f.passengers?.length||0} / 15`,p.x,p.y+4);for(const uid of f.passengers||[]){const e=s.enemies.find(e=>e.uid===uid&&e.hp>0);if(e){const t=point(e.x,e.y);ring(c,t,z.tw*.31,z.th*.35);}}}
 }
 for(const e of s.events||[]){if(e.type!=='custom-fx'||s.time-e.t<0||s.time-e.t>.32)continue;const u=s.units.find(u=>u.uid===e.uid),p=point(e.targetX??e.x,e.targetY??e.y),k=1-(s.time-e.t)/.32;c.strokeStyle=COLORS[u?.id]||'#e7d4ae';c.globalAlpha=k;
  if(['impact','aftershock','residue-explode','ascln-spread'].includes(e.fx)){const radius=Number(e.radius)||(e.fx==='residue-explode'?1.1:.7);ring(c,p,z.tw*radius*(reduceFx?1:.65+(1-k)*.35),z.th*radius*(reduceFx?1:.65+(1-k)*.35));if(u?.id==='char_1035_wisdel')shardBurst(c,p,z,1-k,reduceFx);}
  else if(e.fx==='bomb-hit'){for(const [x,y]of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){const q=point((e.targetX??e.x)+x,(e.targetY??e.y)+y);cell(c,q,z);cross(c,q,z.tw*.16);}}
  else if(e.fx==='stone-trigger'){if(e.skill===2)for(const axis of e.dirs||[])line(c,point(e.targetX-(axis==='x'?3:0),e.targetY-(axis==='y'?3:0)),point(e.targetX+(axis==='x'?3:0),e.targetY+(axis==='y'?3:0)));else if(e.skill===3)for(const g of b.data.ranges['x-1'].grids)cell(c,point(e.targetX+g.col,e.targetY-g.row),z);else ring(c,p,z.tw*.2,z.th*.2);}
  else if(e.fx==='chen-slash'||e.fx==='critical'){c.lineWidth=2.5;line(c,{x:p.x-z.tw*.27,y:p.y+z.th*.2},{x:p.x+z.tw*.27,y:p.y-z.th*.3});c.lineWidth=1.7;}
  else if(e.fx==='custom-strike'){if(u?.id==='char_4132_ascln'){for(const sign of [-1,1]){c.beginPath();c.moveTo(p.x-z.tw*.26,p.y+sign*z.th*.2);c.quadraticCurveTo(p.x,p.y-sign*z.th*.3,p.x+z.tw*.3,p.y-sign*z.th*.12);c.stroke();}}else if(u?.id==='char_1050_chen3'){line(c,{x:p.x-z.tw*.25,y:p.y+z.th*.24},{x:p.x+z.tw*.25,y:p.y-z.th*.3});}else if(u?.id==='char_4231_clemnt'){for(let j=0;j<2;j++){c.beginPath();c.moveTo(p.x-z.tw*.25,p.y+z.th*(.18+j*.12));c.quadraticCurveTo(p.x,p.y-z.th*(.2+j*.12),p.x+z.tw*.3,p.y);c.stroke();}}}
  else if(e.fx==='skill-start'){ring(c,p,z.tw*.38,z.th*.4);if(u?.id==='char_1035_wisdel')shardBurst(c,p,z,1-k,reduceFx);if(u?.id==='char_2027_wang')cross(c,p,z.tw*.3);if(u?.id==='char_4132_ascln'){c.beginPath();c.moveTo(p.x-z.tw*.4,p.y+z.th*.15);c.quadraticCurveTo(p.x,p.y-z.th*.8,p.x+z.tw*.4,p.y+z.th*.15);c.stroke();}}
  else if(e.fx==='miss')cross(c,p,z.tw*.16);
  else ring(c,p,z.tw*.16,z.th*.17);
 }
 c.restore();
}
