import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,commitExit,applyLoss,grantGuard,grantShield} from '../dist/native-effects.js';
import {applyStatus,statusAttributeChanges} from '../dist/status.js';
import {drawEnemyPhase} from '../dist/native-fx.js';

function arena(positions=[]){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:1000,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const id='enemy_2010_csdcr',o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:Object.values(NATIVE_DATA.levels).map(l=>l.enemyProfiles?.[id]).find(Boolean)}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}


function hits(b,e,n){for(let i=0;i<n;i++)dealDamage(b,{target:e,value:1,type:'true',cause:'attack'});}
function cloneSinger(b){b.spawn({id:'enemy_2010_csdcr',route:0});const e=b.s.enemies.at(-1);e.canAttack=false;return e;}
const bonus=e=>statusAttributeChanges(e).attackSpeed;

test('歌伶每20次受击为当前全场敌人加100攻速10秒，计数重置且来源离场不撤销',()=>{
 const {b,e}=arena();e.canAttack=false;const other=cloneSinger(b);other.x=9;b.step();hits(b,e,19);assert.equal(e.scarletHits,19);assert.equal(bonus(other),0);hits(b,e,1);assert.equal(e.scarletHits,0);assert.equal(bonus(other),100);assert.equal(b.enemyAttackTiming(other).frames,60);
 const later=cloneSinger(b);assert.equal(bonus(later),0);commitExit(b,{target:e});advance(b,9.9);assert.equal(bonus(other),100);advance(b,.2);assert.equal(bonus(other),0);
});
test('歌伶多来源攻速不叠加但刷新时长，孤立/隐藏目标不获益，沉默不禁用天赋',()=>{
 const {b,e}=arena();e.canAttack=false;const other=cloneSinger(b),isolated=cloneSinger(b),hidden=cloneSinger(b);isolated.isolated=true;hidden.hidden=true;applyStatus(e,'silence',60);b.step();hits(b,e,20);assert.equal(bonus(other),100);assert.equal(bonus(isolated),0);assert.equal(bonus(hidden),0);
 advance(b,5);hits(b,other,20);assert.equal(bonus(e),100);assert.equal(other.statuses.filter(s=>s.kind==='attackSpeedUp').length,1);advance(b,5.1);assert.equal(bonus(e),100);advance(b,5);assert.equal(bonus(e),0);
});
test('歌伶只计受击回复类伤害：DOT/流失/无敌/护盾抵消不计，屏障吸收的有效伤害计入',()=>{
 const {b,e}=arena();e.canAttack=false;b.step();dealDamage(b,{target:e,value:1,type:'true',cause:'dot'});applyLoss(b,{target:e,amount:1});e.invulnerable=true;hits(b,e,1);e.invulnerable=false;assert.equal(e.scarletHits,0);
 grantGuard(b,e,{id:'test',charges:1,types:['true']});hits(b,e,1);assert.equal(e.scarletHits,0);grantShield(b,e,{id:'test-shield',amount:10,types:['true']});const hp=e.hp;hits(b,e,1);assert.equal(e.hp,hp);assert.equal(e.scarletHits,1);
 hits(b,e,18);const other=cloneSinger(b);fatal(b,e);assert.equal(bonus(other),0,'致死伤害不会在退场后发放攻速');
});
test('歌伶普攻造成法术伤害并附带历史黑板20%攻击力神经损伤',()=>{
 const {b,e,units:[u]}=arena([[4,3]]);b.step();const hp=u.hp;advance(b,2);assert.equal(e.damageType,'arts');assert.equal(e.attackElementScale,.2);assert.ok(Math.abs((hp-u.hp)-e.atk)<1e-8);assert.equal(u.elemental.neural,e.atk*.2);
});
test('歌伶计数与攻速剩余时长跨存档，阈值/持续时间/攻速从黑板读取',()=>{
 const {b,g,e}=arena();e.canAttack=false;hits(b,e,19);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const singer=restored.s.enemies[0];assert.equal(singer.scarletHits,19);hits(restored,singer,1);restored.step();assert.equal(bonus(singer),100);
 const again=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(restored.s)));assert.ok(again);advance(again,10);assert.equal(bonus(again.s.enemies[0]),0);
 singer.enemyTalent['AttackSpeedUp.stack_cnt']=2;singer.enemyTalent['AttackSpeedUp.attack_speed']=37;singer.enemyTalent['AttackSpeedUp.duration']=1;singer.statuses=[];hits(restored,singer,2);assert.equal(bonus(singer),37);advance(restored,1.1);assert.equal(bonus(singer),0);
});
test('歌伶10层警示展示只读状态，触发20层后清除提示',()=>{
 const {b,e}=arena();e.canAttack=false;hits(b,e,10);const before=JSON.stringify(b.s),labels=[],c={save(){},restore(){},fillText(t){labels.push(t);}};assert.equal(drawEnemyPhase(c,(x,y)=>({x,y}),{th:20},b,{reduceFx:true,formatText:s=>'提示'+s}),true);assert.deepEqual(labels,['提示受击 10/20']);assert.equal(JSON.stringify(b.s),before);hits(b,e,10);labels.length=0;drawEnemyPhase(c,(x,y)=>({x,y}),{th:20},b);assert.deepEqual(labels,[]);
});
