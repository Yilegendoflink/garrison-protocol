import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,commitExit,addDamageRedirect,grantShield} from '../dist/native-effects.js';
import {applyStatus,statusAttributeChanges} from '../dist/status.js';

function arena(positions=[],id='enemy_1387_winshd'){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:1000,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:NATIVE_DATA.enemies[id]}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}




function brazier(b,x=2,y=3){const d={uid:b.s.nextId++,id:'trap_137_winfire',kind:'summon',type:'test-brazier',x,y,hp:40000,maxHp:40000,heaterState:'lit',deployed:true,canAttack:false,statuses:[]};b.s.summons.push(d);return d;}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,a+' != '+b);

test('持盾者无封冻也每3秒加一层，上限10层，基础防御加算而非法抗乘算',()=>{
 const {b,e}=arena();applyStatus(e,'silence',60);advance(b,2.9);assert.equal(e.coldShieldStacks,0);advance(b,.1);assert.equal(e.coldShieldStacks,1);close(e.def,e.baseDef*1.1);assert.equal(e.res,e.baseRes+5);advance(b,40);assert.equal(e.coldShieldStacks,10);close(e.def,e.baseDef*2);assert.equal(e.res,e.baseRes+50);
});
test('持盾者受热点燃供暖器周围8格后改为每3秒减层，熄灭后恢复增长，层数不为负',()=>{
 const {b,e}=arena();advance(b,6);assert.equal(e.coldShieldStacks,2);const heater=brazier(b);b.step();assert.equal(b.heatedByBrazier(e),true);advance(b,2.9);assert.equal(e.coldShieldStacks,2);advance(b,.2);assert.equal(e.coldShieldStacks,1);advance(b,6);assert.equal(e.coldShieldStacks,0);assert.equal(e.def,e.baseDef);heater.heaterState='off';b.step();advance(b,3);assert.equal(e.coldShieldStacks,1);
});
test('供暖只认在场点燃的正确装置，寒冷/冻结、普通装置或死亡供暖器不能减层',()=>{
 const {b,e}=arena();const h=brazier(b);h.id='trap_fake';applyStatus(e,'cold',30);b.step();assert.equal(b.heatedByBrazier(e),false);h.id='trap_137_winfire';h.heaterState='off';assert.equal(b.heatedByBrazier(e),false);h.heaterState='lit';h.hp=0;assert.equal(b.heatedByBrazier(e),false);h.hp=40000;h.deployed=false;assert.equal(b.heatedByBrazier(e),false);h.deployed=true;assert.equal(b.heatedByBrazier(e),true);e.x=h.x;e.y=h.y;assert.equal(b.heatedByBrazier(e),false,'周围8格不含装置自身格');e.x=h.x+2;assert.equal(b.heatedByBrazier(e),false);
});
test('持盾者层数/计时/热源跨JSON保存，恢复后不把防御再乘一遍',()=>{
 const {b,g,e}=arena();advance(b,9);const h=brazier(b);b.step();advance(b,1.5);const saved=JSON.parse(JSON.stringify(b.s)),restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);const guard=restored.s.enemies[0];advance(b,1.6);advance(restored,1.6);assert.equal(guard.coldShieldStacks,e.coldShieldStacks);close(guard.def,e.def);close(guard.res,e.res);assert.equal(restored.heatedByBrazier(guard),true);
});
test('强攻冠军优先点燃供暖器右侧1格风门内目标，熄灭/不可部署格回退，阻挡者仍优先',()=>{
 const {b,e,units:[normal,door]}=arena([[5,3],[4,3]],'enemy_1389_winbab_2');e.range=4;normal.deployAt=100;door.deployAt=0;b.step();assert.equal(b.enemySkillTargets(e)[0].uid,normal.uid);const h=brazier(b,3,3);b.map.grid[3][4].buildableType='ALL';assert.equal(b.enemySkillTargets(e)[0].uid,door.uid);h.heaterState='off';assert.equal(b.enemySkillTargets(e)[0].uid,normal.uid);h.heaterState='lit';b.map.grid[3][4].buildableType='NONE';assert.equal(b.enemySkillTargets(e)[0].uid,normal.uid);b.map.grid[3][4].buildableType='ALL';e.block=normal.uid;assert.equal(b.enemySkillTargets(e)[0].uid,normal.uid);e.block=null;door.invisible=true;assert.equal(b.enemySkillTargets(e)[0].uid,normal.uid);
});
test('叠层间隔、上下限与属性量读取本期黑板，多个热源不加速减层',()=>{
 const {b,e}=arena();e.enemyTalent['ColdShield.max_stack_cnt']=2;e.enemyTalent['ColdShield.def']=.2;e.enemyTalent['ColdShield.magic_resistance']=7;advance(b,9);assert.equal(e.coldShieldStacks,2);close(e.def,e.baseDef*1.4);assert.equal(e.res,e.baseRes+14);brazier(b,2,3);brazier(b,3,2);b.step();advance(b,3);assert.equal(e.coldShieldStacks,1);
});
