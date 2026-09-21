import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,moveActor,commitExit,applyHeal} from '../dist/native-effects.js';
import {applyStatus} from '../dist/status.js';
import {setEchoMode} from '../dist/native-enemy-forms.js';

function arena(positions=[]){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:1000,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const id='enemy_9023_acdums',o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:Object.values(NATIVE_DATA.levels).map(l=>l.enemyProfiles?.[id]).find(Boolean)}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}

test('余音是10次生命/2阻挡，受伤反击10%法伤与凋亡；DOT不回复受击技力',()=>{
 const {b,e,units:[u]}=arena([[4,3]]);e.canAttack=false;b.step();assert.equal(e.maxHp,10);assert.equal(e.blockCost,2);assert.equal(e.spriteScale,1);const hp=u.hp;
 dealDamage(b,{target:e,value:1000,type:'true',cause:'attack'});assert.equal(e.hp,9);assert.equal(e.sp,1);assert.ok(Math.abs((hp-u.hp)-(e.baseAtk*.1))<1e-8);assert.equal(u.elemental.necrosis,e.baseAtk*.1);
 dealDamage(b,{target:e,value:1000,type:'true',cause:'dot'});assert.equal(e.hp,8);assert.equal(e.sp,1);assert.equal(u.elemental.necrosis,e.baseAtk*.2);
});

test('余音每形态累计10次伤害切换，治疗维持生命时可反复切换且属性不叠加',()=>{
 const {b,e}=arena();e.canAttack=false;assert.equal(b.enemyAttackTiming(e).frames,80);
 for(let i=0;i<10;i++){dealDamage(b,{target:e,value:1,type:'true'});applyHeal(b,{source:e,target:e,amount:1});b.step();}
 assert.equal(e.enemyForm,'string');assert.equal(e.echoHits,0);assert.equal(b.enemyAttackDamage(e),e.baseAtk*1.5);assert.equal(e.speed,e.baseSpeed*1.2);assert.equal(b.enemyAttackTiming(e).frames,120);
 for(let i=0;i<10;i++){dealDamage(b,{target:e,value:1,type:'true'});applyHeal(b,{source:e,target:e,amount:1});b.step();}
 assert.equal(e.enemyForm,'pipe');assert.equal(b.enemyAttackDamage(e),e.baseAtk);assert.equal(e.speed,e.baseSpeed);
});

test('一个余音满12SP触发全場合奏，各自使用形态范围/倍率并清空全体SP',()=>{
 const {b,e,units}=arena([[3,3],[4,3],[7,3]]);e.canAttack=false;b.spawn({id:e.id,route:0});const other=b.s.enemies.at(-1);other.x=6;other.route=[{kind:'wait',x:6,y:3,time:600}];other.cmd=0;other.canAttack=false;setEchoMode(b,other,'string');e.sp=12;other.sp=7;const hp=units.map(u=>u.hp);advance(b,2.1);
 assert.equal(e.sp,0);assert.equal(other.sp,0);assert.ok(Math.abs((hp[0]-units[0].hp)-(e.baseAtk))<1e-8);assert.equal(hp[1]-units[1].hp,0);assert.ok(Math.abs((hp[2]-units[2].hp)-(other.baseAtk*1.5))<1e-8);assert.equal(units[0].elemental.necrosis,e.baseAtk*.3);assert.equal(units[2].elemental.necrosis,other.baseAtk*1.5*.5);
});

test('余音形态、次数与SP跨JSON保存，沉默阻止合奏但不阻止受伤反击天赋',()=>{
 const {b,g,e,units:[u]}=arena([[4,3]]);e.canAttack=false;setEchoMode(b,e,'string');applyStatus(e,'silence',20);e.sp=12;advance(b,2.1);assert.equal(e.sp,12);const hp=u.hp;dealDamage(b,{target:e,value:1,type:'true'});assert.ok(Math.abs((hp-u.hp)-(e.baseAtk*1.5*.1))<1e-8);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const echo=restored.s.enemies[0];assert.equal(echo.enemyForm,'string');assert.equal(echo.echoHits,1);assert.equal(echo.sp,12);assert.equal(restored.enemyAttackDamage(echo),echo.baseAtk*1.5);
});
