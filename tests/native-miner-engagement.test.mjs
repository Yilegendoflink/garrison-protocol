import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,commitExit,addDamageRedirect,grantShield} from '../dist/native-effects.js';
import {applyStatus,statusAttributeChanges,permissions} from '../dist/status.js';

function arena(positions=[],id='enemy_10124_uashld_2'){
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





function miner(b,x,y=3){const m={uid:b.s.nextId++,id:'enemy_3010_mcreep',kind:'summon',type:'test',x,y,hp:10000,maxHp:10000,atk:0,def:0,res:0,attackSpeed:100,deployed:true,deployGen:0,canAttack:false,statuses:[]};b.s.summons.push(m);return m;}
const pairs=b=>b.s.minerEngagements||[];
function keepBattle(b){b.spawn({id:'enemy_1251_lysyta',route:0});const e=b.s.enemies.at(-1);e.canAttack=false;e.x=8;e.y=3;e.route=[{kind:'wait',x:8,y:3,time:600}];e.cmd=0;}

test('中坚盾卫选最近三名矿工交战，双方束缚但不改普通阻挡或攻击权限',()=>{
 const {b,e}=arena();e.canAttack=false;const far=miner(b,3.85),middle=miner(b,3.7),near=miner(b,3.5),fourth=miner(b,3.89);b.step();assert.deepEqual(pairs(b).map(p=>p.minerUid),[near.uid,middle.uid,far.uid]);assert.equal(permissions(e).move,false);assert.equal(permissions(e).attack,true);assert.equal(e.block,null);assert.equal(permissions(fourth).move,true);for(const m of [near,middle,far])assert.equal(permissions(m).move,false);
});
test('两名交战来源不会抢同一矿工，指挥员上限读黑板为1，已有绑定不会被更近者抢走',()=>{
 const {b,e}=arena();e.canAttack=false;e.enemyTalent['BlockMcreep.block_mcreep_cnt']=1;b.spawn({id:'enemy_10125_uacomd',route:0});const other=b.s.enemies.at(-1);other.canAttack=false;const a=miner(b,3.5),c=miner(b,3.7);b.step();assert.equal(pairs(b).length,2);assert.equal(new Set(pairs(b).map(p=>p.minerUid)).size,2);assert.equal(pairs(b).find(p=>p.enemyUid===e.uid).minerUid,a.uid);const closer=miner(b,3.1);advance(b,.4);assert.equal(pairs(b).find(p=>p.enemyUid===e.uid).minerUid,a.uid);assert.ok(!pairs(b).some(p=>p.minerUid===closer.uid));
});
test('交战按0.3秒检查，进入用碰撞半径，离开用1格中点距离，解绑不移除其他束缚',()=>{
 const {b,e}=arena();e.canAttack=false;const m=miner(b,3.95);b.step();assert.equal(pairs(b).length,0);m.hitRadius=.1;advance(b,.3);assert.equal(pairs(b).length,1);m.x=3.99;advance(b,.3);assert.equal(pairs(b).length,1);applyStatus(e,'root',100,{source:'other'});m.x=4.2;b.step();assert.equal(pairs(b).length,1);advance(b,.3);assert.equal(pairs(b).length,0);assert.equal(permissions(m).move,true);assert.ok(e.statuses.some(s=>s.source==='other'));assert.equal(e.statuses.some(s=>String(s.source).startsWith('miner-engagement:')),false);
});
test('任一方死亡或隐藏后解除交战，残留绑定不会占住其他来源的名额',()=>{
 const {b,e}=arena();keepBattle(b);e.canAttack=false;const m=miner(b,3.5);b.step();commitExit(b,{target:m});advance(b,.3);assert.equal(pairs(b).length,0);assert.equal(permissions(e).move,true);const next=miner(b,3.5);advance(b,.3);assert.equal(pairs(b).length,1);next.hidden=true;advance(b,.3);assert.equal(pairs(b).length,0);next.hidden=false;advance(b,.3);assert.equal(pairs(b).length,1);commitExit(b,{target:e});advance(b,.3);assert.equal(pairs(b).length,0);assert.equal(permissions(next).move,true);
});
test('交战绑定跨JSON保存且校验唯一矿工，再部署代际变化不沿用旧绑定',()=>{
 const {b,g,e}=arena();e.canAttack=false;const m=miner(b,3.5);b.step();const saved=JSON.parse(JSON.stringify(b.s)),restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);advance(restored,.3);assert.equal(pairs(restored).length,1);const copy=restored.s.summons.find(x=>x.uid===m.uid);copy.deployGen++;copy.x=7;advance(restored,.3);assert.equal(pairs(restored).length,0);assert.equal(permissions(copy).move,true);saved.minerEngagements.push({...saved.minerEngagements[0]});assert.equal(NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved),null);
});
test('交战不占干员阻挡容量，已有阻挡者仍是普攻首选',()=>{
 const {b,e,units:[u]}=arena([[3,3]]);const m=miner(b,3.5);b.step();assert.equal(e.block,u.uid);assert.equal(pairs(b).length,1);assert.equal(b.enemySkillTargets(e)[0].uid,u.uid);assert.equal(permissions(u).move,true);assert.equal(permissions(m).move,false);
});
