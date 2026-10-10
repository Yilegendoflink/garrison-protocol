import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';
const bound=['char_427_vigil','char_249_mlyss','char_4162_cathy','char_108_silent','char_1012_skadi2'];
const chess=(id,golden=false)=>Object.values(data.profiles).find(p=>p.charId===id&&!!p.isGolden===golden).chessId;
function game(){const g=new NativeSession(data,{mapId:'act1autochess_m03',seed:42,bondBan:NO_BOND_BAN});g.map=g.board={...g.map,grid:g.map.grid.map(row=>row.map(t=>({...t,heightType:'LOWLAND',buildableType:'ALL',obstacle:false})))};g.s.rewardPending=null;g.s.rewardQueue=[];return g;}
function owner(g,id,x,y,golden=false){const u=g.gain(chess(id,golden));if(id==='char_108_silent')u.skillIndex=1;assert.ok(g.deploy(u.uid,x,y,0));g.syncSummonCards();const cards=g.s.summonCards.filter(c=>c.ownerUid===u.uid);assert.ok(cards.length);for(const c of cards){let placed=false;for(let cy=0;cy<g.map.rows&&!placed;cy++)for(let cx=0;cx<g.map.cols&&!placed;cx++)if(!g.s.units.some(v=>v.position?.x===cx&&v.position?.y===cy)&&g.canDeploySummonCard(c.uid,cx,cy))placed=g.deploySummonCard(c.uid,cx,cy);if(c.type!=='cathy-device')assert.ok(placed);}assert.ok(cards.some(c=>c.position));return {u,cards};}

test('逐名检查绑定召唤物：被普通干员换位和主动换位都清布局（初始/精锐）',()=>{
 for(const id of bound)for(const golden of [false,true]){
  const g=game(),{u,cards}=owner(g,id,2,2,golden),other=g.gain(chess('char_107_liskam'));assert.ok(g.deploy(other.uid,7,4,0));const uids=cards.map(c=>c.uid);
  assert.ok(g.perform('deploy',other.uid,2,2,0));assert.deepEqual(u.position,{x:7,y:4});assert.ok(cards.every(c=>c.position===null),id+' 被动换位不能留下召唤物');assert.deepEqual(g.s.summonCards.filter(c=>c.ownerUid===u.uid).map(c=>c.uid),uids);
  let placed=false;const c=cards[0];for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploySummonCard(c.uid,x,y))placed=g.deploySummonCard(c.uid,x,y);assert.ok(placed);
  assert.ok(g.perform('deploy',u.uid,2,2,0));assert.ok(cards.every(c=>c.position===null),id+' 主动换位也清布局');
 }
});

test('两个绑定持有者交换位置，双方都清布局，其余持有者保持原位',()=>{
 const g=game(),a=owner(g,'char_427_vigil',2,2),b=owner(g,'char_249_mlyss',6,3),untouched=owner(g,'char_1012_skadi2',9,5),positions=untouched.cards.map(c=>structuredClone(c.position));
 assert.ok(g.perform('deploy',a.u.uid,6,3,0));assert.ok([...a.cards,...b.cards].every(c=>c.position===null));assert.deepEqual(untouched.cards.map(c=>c.position),positions);
});

test('未移动与跨回合对账保持召唤物位置；持有者回整备区后卡片移除',()=>{
 for(const id of bound){const g=game(),{u,cards}=owner(g,id,2,2),positions=cards.map(c=>structuredClone(c.position));assert.ok(g.deploy(u.uid,2,2,0));g.s.round++;g.syncSummonCards();assert.deepEqual(cards.map(c=>c.position),positions,id+' 未换位应保留');const replacement=g.gain(chess('char_107_liskam'));assert.ok(g.perform('deploy',replacement.uid,2,2,0));assert.equal(u.position,null);assert.equal(g.s.summonCards.some(c=>c.ownerUid===u.uid),false);}
});
