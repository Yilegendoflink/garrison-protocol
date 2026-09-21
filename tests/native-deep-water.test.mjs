import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {applyStatus} from '../dist/status.js';

function arena(){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,ally=b.s.units[0];b.map=structuredClone(NATIVE_DATA.maps.find(m=>m.stageId==='act1autochess_m05'));b.s.queue=[];b.s.enemies=[];b.s.units=[];b.s.logicEffects=[];b.s.limit=1000;
 return {b,g,ally};
}
function spawn(b,id,x=4,y=3){const raw=NATIVE_DATA.enemies[id],o=b.map.origin,p={col:o.col+x,row:o.row-y};b.level={...b.level,routes:[{motionMode:raw.motion,startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};b.spawn({id,route:0});const e=b.s.enemies.at(-1);e.canAttack=false;return e;}
function advance(b,seconds){for(let i=0;i<Math.round(seconds*30);i++)b.step();}

test('m05裁切外的深水控制器保留本期技能等级与黑板，不误套其他地图',()=>{
 const map=NATIVE_DATA.maps.find(m=>m.stageId==='act1autochess_m05');const raw=JSON.parse(fs.readFileSync('data/modes/alliance-lower/levels/'+map.source.file));
 const c=raw.predefines.tokenInsts.find(c=>c.inst.characterKey==='trap_042_tidectrl');assert.ok(c.position.row>map.origin.row);assert.equal(c.skillIndex,2);assert.equal(c.mainSkillLvl,1);
 assert.deepEqual(map.environment.deepWater,{skillId:'sktok_tidectrl_3',level:1,damage:40,moveScale:.6,attackSpeedScale:.4,source:map.source.file});
 assert.deepEqual(NATIVE_DATA.maps.filter(m=>m.environment?.deepWater).map(m=>m.stageId),['act1autochess_m05','act2autochess_m04']);
});

test('深水对地面敌人按秒造成无来源真实DOT与减速，飞行/消失/干地不受影响且不回受击SP',()=>{
 const {b}=arena(),ground=spawn(b,'enemy_1025_reveng'),air=spawn(b,'enemy_1005_yokai'),dry=spawn(b,'enemy_1025_reveng',3,3),hidden=spawn(b,'enemy_1025_reveng');hidden.hidden=true;hidden.route=[{kind:'wait',time:600}];
 ground.enemySp={type:'INCREASE_WHEN_TAKEN_DAMAGE',max:10,increment:1};ground.sp=0;const hp=[ground,air,dry,hidden].map(e=>e.hp);
 advance(b,1.1);assert.equal(ground.hp,hp[0]-40);assert.equal(air.hp,hp[1]);assert.equal(dry.hp,hp[2]);assert.equal(hidden.hp,hp[3]);assert.equal(ground.sp,0);
 assert.equal(ground.waterMoveScale,.6);assert.equal(ground.waterAttackSpeedScale,.4);ground.x=3;b.step();assert.equal(ground.waterlogged,false);assert.equal(ground.waterMoveScale,1);assert.equal(ground.waterAttackSpeedScale,1);
});

test('潜水员免疫水蚀伤害与减速但仍获得水中增攻/隐匿，离水清除且不会攻击飞行目标',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1158_divman'),hp=e.hp;applyStatus(e,'silence',60);advance(b,1.1);
 assert.equal(e.waterlogged,true);assert.equal(e.hp,hp);assert.equal(e.waterMoveScale,1);assert.equal(e.waterAttackMultiplier,1.4);assert.equal(e.invisible,true);assert.equal(e.enemyAttack.groundOnly,true);
 e.x=3;b.step();assert.equal(e.waterAttackMultiplier,1);assert.equal(e.invisible,false);
});

test('码头水手/水手长的特殊水蚀自伤与普通水蚀分别生效，出水后停止',()=>{
 for(const [id,damage]of [['enemy_1160_hvyslr',1000],['enemy_1160_hvyslr_2',1400]]){
  const {b}=arena(),e=spawn(b,id),hp=e.hp;advance(b,1.1);assert.equal(e.hp,hp-40-damage);e.x=3;b.step();const after=e.hp;advance(b,2);assert.equal(e.hp,after);
 }
});

test('水蚀剩余计时跨JSON恢复，致死伤害仍走统一退场；无控制器时不凭水格启动',()=>{
 const {b,g}=arena(),e=spawn(b,'enemy_1025_reveng');e.hp=20;advance(b,.6);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);advance(restored,.3);assert.equal(restored.s.kills,0);advance(restored,.2);assert.equal(restored.s.kills,1);assert.equal(restored.s.finished,true);
 const {b:c}=arena(),dry=spawn(c,'enemy_1025_reveng'),hp=dry.hp;delete c.map.environment;advance(c,2);assert.equal(dry.hp,hp);assert.equal(dry.waterlogged,false);
});

test('潜水员水中真实命中增攻，阻挡解除后三秒恢复隐匿；深水控制器不对我方施加水蚀',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1158_divman');ally.x=4;ally.y=3;ally.deployed=true;ally.hp=ally.maxHp=10000;applyStatus(ally,'disarm',60);applyStatus(ally,'skillLock',60);
 const stats=b.stats.bind(b);b.stats=u=>({...stats(u),maxHp:10000,blockCnt:3,def:0});b.s.units.push(ally);b.economy.random=()=>.999;e.atk=100;
 advance(b,.1);assert.equal(e.block,ally.uid);assert.equal(e.statuses.some(s=>s.kind==='invisible'&&s.source==='deep-water'),false);
 const hp=ally.hp;b.hurt(ally,e);assert.equal(ally.hp,hp-140);ally.x=2;advance(b,2.8);assert.equal(e.invisible,false);advance(b,.4);assert.equal(e.invisible,true);
 assert.equal(ally.hp,hp-140);assert.equal(ally.elemental?.corrosion||0,0);
});

test('深水减速实际进入路线推进，离水恢复；读取技能2级标记配置不会产生一级伤害',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1025_reveng');e.route=[{kind:'move',x:4,y:3},{kind:'move',x:8,y:3}];e.cmd=0;const x=e.x;b.step();assert.ok(Math.abs(e.x-x-e.speed*.6/30)<1e-6);
 e.x=3;e.route=[{kind:'move',x:3,y:3},{kind:'move',x:3,y:0}];e.cmd=0;e.cmdLeft=null;const y=e.y;b.step();assert.ok(Math.abs(y-e.y-e.speed/30)<1e-6);
 e.x=4;e.y=3;e.route=[{kind:'wait',time:600}];e.cmd=0;e.cmdLeft=null;b.map.environment.deepWater={...b.map.environment.deepWater,level:2,damage:0,moveScale:1,attackSpeedScale:1};const hp=e.hp;advance(b,2);assert.equal(e.waterlogged,true);assert.equal(e.hp,hp);
});
