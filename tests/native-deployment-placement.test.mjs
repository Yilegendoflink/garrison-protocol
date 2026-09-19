import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {BRANCH_POLICIES,allowsHighlandPlacement} from '../dist/native-branches.js';
import {canRelocateTo} from '../dist/native-effects.js';

// 部署位口径：PRTS 分支特性写「可以放置于远程位」的分支（推击手／钩索师）既能下地面也能上高台。
// 本模式的 HIGHLAND 地块分 HIGHLAND/RANGED（可部署的高台）与 HIGHLAND/NONE（不可部署）两类，
// 所以这条规则只在有高台位的关卡（如 act1autochess_m03）上有实际影响。
const prtsBranches=JSON.parse(fs.readFileSync('data/prts/branch-rules.json','utf8')).records;
const MAP='act1autochess_m03';
const profiles=Object.values(NATIVE_DATA.profiles).filter(p=>p?.charId&&!p.isHidden);
const uniq=rows=>[...new Map(rows.map(p=>[p.charId,p])).values()];
const profileOf=charId=>profiles.find(p=>p.charId===charId);

// 找一个可部署的高台格与一个可部署的地面格
function tiles(map){
 let high=null,low=null;
 for(let y=0;y<map.rows;y++)for(let x=0;x<map.cols;x++){
  const cell=map.grid[y][x];if(cell.buildableType==='NONE'||cell.obstacle)continue;
  if(cell.heightType==='HIGHLAND'&&!high)high={x,y};
  if(cell.heightType!=='HIGHLAND'&&!low)low={x,y};
 }
 return {high,low};
}
function session(charId){
 const g=new NativeSession(NATIVE_DATA,{seed:5,mapId:MAP});
 g.s.funds=9999;g.s.rewardPending=null;g.s.rewardQueue=[];
 const u=g.gain(profileOf(charId).chessId);
 g.s.rewardPending=null;g.s.rewardQueue=[];
 return {g,u};
}
const deploySomewhere=(g,u)=>tiles(g.map).low&&g.deploy(u.uid,tiles(g.map).low.x,tiles(g.map).low.y,0);

test('PRTS 写着「可以放置于远程位」的分支与 highland 部署位标记一一对应',()=>{
 const allow=new Set(prtsBranches.filter(r=>/可以放置于(近战|远程)位/.test(r.baseTrait||'')).map(r=>r.id));
 assert.deepEqual([...allow].sort(),['hookmaster','pusher'],'PRTS 数据本身只给这两个分支开了异地部署');
 for(const id of Object.keys(BRANCH_POLICIES)){
  const flagged=!!BRANCH_POLICIES[id].highland;
  assert.equal(flagged,allow.has(id),`${id} 的 highland 标记应与 PRTS 分支特性一致`);
 }
});

test('钩索师／推击手可以部署到高台与地面，普通近战只能下地面',()=>{
 const map=NATIVE_DATA.maps.find(m=>m.stageId===MAP);
 const {high,low}=tiles(map);
 assert.ok(high,'m03 应当有可部署的高台格');
 assert.ok(low,'m03 应当有可部署的地面格');
 const flexible=uniq([...profiles.filter(p=>p.branch==='hookmaster'),...profiles.filter(p=>p.branch==='pusher')]);
 assert.ok(flexible.some(p=>p.charId==='char_474_glady'),'本期应当有歌蕾蒂娅');
 assert.ok(flexible.some(p=>p.branch==='pusher'),'本期应当有推击手');
 for(const p of flexible){
  const {g,u}=session(p.charId);
  assert.equal(allowsHighlandPlacement(p),true,`${p.name} 的分支应当允许上高台`);
  assert.equal(g.canDeploy(u.uid,high.x,high.y),true,`${p.name} 应当能部署到高台`);
  assert.equal(g.canDeploy(u.uid,low.x,low.y),true,`${p.name} 应当能部署到地面`);
  assert.equal(g.deploy(u.uid,high.x,high.y,0),true,`${p.name} 高台部署要真的落下去`);
 }
 const melee=profiles.find(p=>p.position==='MELEE'&&!allowsHighlandPlacement(p));
 const {g:mg,u:mu}=session(melee.charId);
 assert.equal(mg.canDeploy(mu.uid,high.x,high.y),false,`${melee.name} 不能上高台`);
 assert.equal(mg.canDeploy(mu.uid,low.x,low.y),true,`${melee.name} 照常下地面`);
 const ranged=profiles.find(p=>p.position==='RANGED');
 const {g:rg,u:ru}=session(ranged.charId);
 assert.equal(rg.canDeploy(ru.uid,high.x,high.y),true,`${ranged.name} 远程干员照常上高台`);
 assert.equal(rg.canDeploy(ru.uid,low.x,low.y),true,'本模式的高台位很少，远程干员仍然允许落在地面格');
});

test('位移类效果的落点判定走同一套部署位规则',()=>{
 const map=NATIVE_DATA.maps.find(m=>m.stageId===MAP);
 const {high,low}=tiles(map);
 const flexible=profileOf('char_474_glady');
 const {g,u}=session(flexible.charId);
 assert.equal(deploySomewhere(g,u),true,'钩索师先落到地面再开战');
 assert.equal(g.perform('start'),true,g.lastError||'开战失败');
 const battle=g.battle;
 assert.equal(canRelocateTo(battle,battle.s.units[0],high.x,high.y),true,'钩索师可以位移到高台');
 assert.equal(canRelocateTo(battle,battle.s.units[0],low.x,low.y),true,'钩索师照常位移到地面');
 const melee=profiles.find(p=>p.position==='MELEE'&&!allowsHighlandPlacement(p));
 const {g:g2,u:u2}=session(melee.charId);
 assert.equal(deploySomewhere(g2,u2),true);
 assert.equal(g2.perform('start'),true,g2.lastError||'开战失败');
 const battle2=g2.battle;
 assert.equal(canRelocateTo(battle2,battle2.s.units[0],high.x,high.y),false,'普通近战不能位移到高台');
 assert.equal(canRelocateTo(battle2,battle2.s.units[0],low.x,low.y),true,'普通近战照常位移到地面');
});
