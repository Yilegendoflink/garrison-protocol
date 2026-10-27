import test from 'node:test';
import assert from 'node:assert/strict';
import {openBattle,deployNow,enemy,byId} from './effects-harness.mjs';
import {tickLogic} from '../dist/native-effects.js';

test('耶拉二技能只对范围内可索敌目标造成伤害与寒冷，不攻击红门敌人',()=>{
 const {g,b}=openBattle({chessId:'chess_char_3_20_a',skillIndex:1});deployNow(b);
 const u=byId(b,'char_4013_kjera');u.x=1;u.y=3;u.dir=0;
 // 排除盟约寒风和装备干扰，仅验证耶拉自身技能；强制寒冷概率命中。
 assert.equal(b.on('kjeragShip'),false);u.source.equipment=[];g.random=()=>0;
 const door=enemy(b,{x:b.map.cols-1,y:0,hp:100000});
 assert.equal(b.inside(u,door),false);
 const spot=b.range(u,true).find(p=>p.x>u.x&&p.y===u.y);
 assert.ok(spot);
 const near=enemy(b,{...spot,hp:100000});
 u.sp=b.spCost(u);b.activate(u);assert.ok(b.skillActive(u));assert.ok(u.floatUnits>=2);
 b.s.time=.1;tickLogic(b,1/30);
 assert.equal(door.hp,door.maxHp,'编号更早的红门敌人不能被全场选中');
 assert.deepEqual(door.statuses,[],'范围外不能施加寒冷或冻结');
 assert.ok(near.hp<near.maxHp,'范围内目标正常受到技能伤害');
 assert.ok(near.statuses.some(s=>s.kind==='frozen'),'多浮游单元命中叠加寒冷后正常冻结');
 // 锁定目标离开范围后不再受到后续技能攻击。
 near.x=door.x;near.y=door.y;near.statuses=[];const hp=near.hp;
 b.s.time=1.2;tickLogic(b,1/30);
 assert.equal(near.hp,hp);assert.deepEqual(near.statuses,[]);
 assert.equal(door.hp,door.maxHp);assert.deepEqual(door.statuses,[]);
 // 没有合法目标时，不得对范围内不可选中的目标施加寒冷。
 const invalid=enemy(b,{...spot,hp:100000,untargetable:true});
 b.s.time=2.3;tickLogic(b,1/30);
 assert.equal(invalid.hp,invalid.maxHp);assert.deepEqual(invalid.statuses,[]);
});
