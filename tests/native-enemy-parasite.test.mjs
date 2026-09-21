import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {applyElementDamage,commitExit} from '../dist/native-effects.js';
import {applyStatus,permissions,statusAttributeChanges} from '../dist/status.js';
import {gainSp} from '../dist/native-sp.js';

function arena(){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];
 let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle;b.s.enemies=[];b.s.queue=[];b.s.limit=1000;b.s.logicEffects=[];
 b.map=structuredClone(b.map);for(const row of b.map.grid)for(const tile of row)tile.heightType='LOWLAND';
 const stats=b.stats.bind(b);b.stats=u=>({...stats(u),maxHp:50000});
 const ally=b.s.units[0];ally.x=3;ally.y=3;ally.hp=ally.maxHp=50000;ally.statuses=[];applyStatus(ally,'disarm',600);applyStatus(ally,'skillLock',600);
 return {b,ally};
}
function spawn(b,id='enemy_9007_acelem',x=3,y=3){const raw=NATIVE_DATA.enemies[id],o=b.map.origin,p={col:o.col+x,row:o.row-y};b.level={...b.level,routes:[{motionMode:raw.motion,startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};b.spawn({id,route:0});const e=b.s.enemies.at(-1);e.hp=e.maxHp=50000;return e;}
function advance(b,seconds){for(let i=0;i<Math.round(seconds*30);i++)b.step();}
function injury(b,target,type,amount=1000){return applyElementDamage(b,{target,type,amount});}
function near(a,b){assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);}

test('淤困真实step附着、每秒法术伤害、130%损伤与阻挡解除清理',()=>{
 const {b,ally}=arena(),e=spawn(b);b.step();assert.equal(e.parasiteTargetUid,ally.uid);assert.equal(e.formHold,true);assert.equal(e.canAttack,false);
 const hp=ally.hp,res=b.stats(ally).magicResistance;advance(b,1);near(hp-ally.hp,e.atk*.3*(1-res/100));
 near(injury(b,ally,'burn',100).added,130);assert.equal(e.attackCount,0);
 applyStatus(ally,'stun',2);b.step();assert.equal(e.parasiteTargetUid,null);assert.equal(e.formHold,false);near(injury(b,ally,'burn',100).added,100);
});

test('寄生爆条按十字传播，迷彩/不可选不豁免，连锁有限且不重复爆条',()=>{
 const {b,ally}=arena(),a=spawn(b),neighbor=structuredClone(ally),diagonal=structuredClone(ally);
 neighbor.uid+=100;neighbor.x=4;neighbor.untargetable=true;applyStatus(neighbor,'camouflage',600);diagonal.uid+=101;diagonal.x=4;diagonal.y=4;b.s.units.push(neighbor,diagonal);
 const second=spawn(b,'enemy_9007_acelem',4,3);b.step();assert.equal(second.parasiteTargetUid,neighbor.uid);
 assert.equal(injury(b,ally,'burn').burst,true);assert.equal(ally.elementBurst,1);assert.equal(neighbor.elementBurst,1);
 // 邻格也有寄生，故可继续传播到它的正下方；回传原目标受冷却阻止。
 assert.equal(diagonal.elementBurst,1);assert.equal(a.parasiteTargetUid,ally.uid);assert.equal(injury(b,ally,'neural').added,0);
 const {b:c,ally:u}=arena();spawn(c);const v=structuredClone(u);v.uid+=100;v.x=4;v.y=4;c.s.units.push(v);c.step();injury(c,u,'burn');assert.equal(v.elementBurst,undefined);
});

test('寄生关系随JSON恢复，来源/宿主退场立即清理，不留下永久损伤倍率',()=>{
 const {b,ally}=arena(),e=spawn(b);b.step();const restored=NativeBattle.restore(NATIVE_DATA,b.economy,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);
 const host=restored.s.units[0],parasite=restored.s.enemies[0];assert.equal(parasite.parasiteTargetUid,host.uid);near(injury(restored,host,'burn',100).added,130);
 commitExit(restored,{target:parasite,reason:'knockdown'});assert.equal(parasite.parasiteTargetUid,null);near(injury(restored,host,'burn',100).added,100);
 commitExit(b,{target:ally,reason:'retreat'});assert.equal(e.parasiteTargetUid,null);assert.equal(e.block,null);
});

test('元素上限独立于生命，领袖2000，自定义上限保留；冷却隔离其他类型',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1007_slime',8,3);e.canAttack=false;assert.equal(injury(b,e,'burn',999).burst,false);assert.equal(e.elementalMax,1000);assert.equal(injury(b,e,'burn',1).burst,true);near(e.hp,43000);
 assert.equal(injury(b,e,'neural',10000).added,0);b.s.time+=10;assert.equal(injury(b,e,'neural',1000).burst,true);
 const boss=spawn(b,'enemy_1007_slime',8,3);boss.enemyRank='BOSS';assert.equal(injury(b,boss,'burn').burst,false);assert.equal(boss.elementalMax,2000);assert.equal(injury(b,boss,'burn').burst,true);
 const custom=spawn(b,'enemy_1007_slime',8,3);custom.elementalMax=300;assert.equal(injury(b,custom,'burn',300).burst,true);
});

test('我方神经真实伤害/晕眩、灼燃先减法抗、侵蚀永久降防且冷却10秒',()=>{
 for(const type of ['neural','burn','corrosion']){
  const {b,ally}=arena();spawn(b);const hp=ally.hp,stats=b.stats(ally);injury(b,ally,type);
  if(type==='neural'){near(hp-ally.hp,1000);assert.equal(permissions(ally).block,false);}
  if(type==='burn'){near(b.stats(ally).magicResistance,stats.magicResistance-20);near(hp-ally.hp,1200*(1-Math.max(0,stats.magicResistance-20)/100));}
  if(type==='corrosion'){assert.equal(ally.corrosionDefLoss,100);near(b.stats(ally).def,Math.max(0,stats.def-100));assert.equal(ally.elementBurstUntil,10);b.s.time=10;injury(b,ally,type);assert.equal(ally.corrosionDefLoss,200);b.deploy(ally);assert.equal(ally.corrosionDefLoss,0);}
 }
});

test('凋亡真实step每秒流失技力/法术伤害，敌方15次元素伤害与衰减虚弱',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1007_slime',8,3);e.canAttack=false;ally.sp=20;const hp=ally.hp,res=b.stats(ally).magicResistance;
 injury(b,ally,'necrosis');assert.equal(gainSp(ally,{spData:{spType:'INCREASE_WITH_TIME',spCost:100}},5),0);assert.equal(permissions(ally).skill,false);
 injury(b,e,'necrosis');near(statusAttributeChanges(e).attack,-.5);advance(b,1.1);near(hp-ally.hp,100*(1-res/100));near(ally.sp,19);near(e.hp,49200);assert.ok(statusAttributeChanges(e).attack>-.5);
 advance(b,14);near(e.hp,38000);assert.equal(statusAttributeChanges(e).attack,0);near(hp-ally.hp,1500*(1-res/100));assert.equal(ally.statuses.some(s=>s.kind==='spBlock'),false);
});

test('麻痹在实际攻击出手前消耗层数并打断，震颤不额外禁止移动/阻挡',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1007_slime');injury(b,e,'neural');assert.equal(e.palsyCharges,3);const hp=ally.hp;
 advance(b,.8);assert.equal(e.palsyCharges,2);assert.equal(ally.hp,hp);applyStatus(e,'tremble',.5);assert.equal(permissions(e).move,true);assert.equal(permissions(e).block,true);
});

test('敌方损伤抵抗和元素抗性分开生效，侵蚀冷却8秒与降防跨帧保留',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1007_slime',8,3);e.canAttack=false;e.elementDamageResistance=.5;e.elementResistance=20;
 near(injury(b,e,'corrosion',1000).added,500);const def=e.def;assert.equal(injury(b,e,'corrosion',1000).burst,true);near(e.hp,46000);assert.equal(e.elementBurstUntil,8);near(e.baseDef,Math.max(0,def-120));
 advance(b,1);near(e.def,Math.max(0,def-120));
});

test('旧生命上限元素条按比例迁移，新存档自定义上限不改；凋亡不跨再部署追伤',()=>{
 const {b,ally}=arena();spawn(b,'enemy_1007_slime',8,3).canAttack=false;
 const saved=JSON.parse(JSON.stringify(b.s));delete saved.elementRulesVersion;saved.units[0].elementalMax=saved.units[0].maxHp;saved.units[0].elemental={burn:saved.units[0].maxHp*.4};
 const restored=NativeBattle.restore(NATIVE_DATA,b.economy,b.map,b.turn,saved);assert.ok(restored);near(restored.s.units[0].elementalMax,1000);near(restored.s.units[0].elemental.burn,400);
 injury(b,ally,'necrosis');commitExit(b,{target:ally,reason:'retreat'});b.deploy(ally);ally.statuses=[];applyStatus(ally,'disarm',600);applyStatus(ally,'skillLock',600);const hp=ally.hp;advance(b,1.1);near(ally.hp,hp);
});
