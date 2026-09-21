import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStatus,tickStatuses,permissions,statusAttributeChanges} from '../dist/status.js';

test('敌方寒冷在冻结期间续冻，不附带友方冻结的减法抗',()=>{
 const u={hp:100,statuses:[]},enemy={source:7,frostSide:'enemy'};
 applyStatus(u,'cold',4,enemy);applyStatus(u,'cold',4,enemy);tickStatuses(u,3);
 applyStatus(u,'cold',4,enemy);assert.deepEqual(u.statuses.map(s=>s.kind),['frozen']);assert.equal(u.statuses[0].remaining,4);
 assert.equal(statusAttributeChanges(u).resistance,0);assert.equal(statusAttributeChanges(u).attackSpeed,0);assert.equal(permissions(u).skill,false);
});

test('友方寒冷每两次配对，冻结取已抵抗时长的较长者，不二次抵抗',()=>{
 const u={hp:100,statuses:[],statusResistance:.5};
 applyStatus(u,'cold',10,{source:1});tickStatuses(u,1);applyStatus(u,'cold',2,{source:2});
 assert.equal(u.statuses[0].kind,'frozen');assert.equal(u.statuses[0].remaining,4);
 tickStatuses(u,1);applyStatus(u,'cold',10,{source:1});assert.equal(u.statuses.find(s=>s.kind==='frozen').remaining,3);
 assert.ok(u.statuses.some(s=>s.kind==='cold'));applyStatus(u,'cold',2,{source:2});assert.equal(u.statuses.some(s=>s.kind==='cold'),false);
 assert.equal(Math.max(...u.statuses.map(s=>s.remaining)),5);assert.equal(statusAttributeChanges(u).resistance,-15);
});

test('同一来源施加两类寒冷也不跨阵营配对，减法抗按效果类型而非目标身份',()=>{
 const u={hp:100,statuses:[]};
 applyStatus(u,'cold',5,{source:1});applyStatus(u,'cold',5,{source:1,frostSide:'enemy'});
 assert.equal(u.statuses.length,2);assert.equal(u.statuses.some(s=>s.kind==='frozen'),false);assert.equal(statusAttributeChanges(u).attackSpeed,-60);
 applyStatus(u,'cold',2,{source:2,frostSide:'enemy'});assert.equal(statusAttributeChanges(u).resistance,0);assert.ok(u.statuses.some(s=>s.kind==='cold'&&s.frostSide==='ally'));
 applyStatus(u,'cold',2,{source:2});assert.equal(statusAttributeChanges(u).resistance,-15);assert.equal(u.statuses.filter(s=>s.kind==='frozen').length,2);
 tickStatuses(u,2.1);assert.equal(permissions(u).attack,false);assert.equal(statusAttributeChanges(u).resistance,-15);tickStatuses(u,3);assert.equal(permissions(u).attack,true);
});

test('冻结免疫时两类寒冷各自保留，完全抵抗不会续冻',()=>{
 const u={hp:100,statuses:[],immunities:{frozen:true}};
 for(const frostSide of ['ally','enemy'])for(let i=0;i<3;i++)applyStatus(u,'cold',4,{source:i,frostSide});
 assert.equal(u.statuses.length,2);assert.ok(u.statuses.every(s=>s.kind==='cold'));
 u.immunities.frozen=false;applyStatus(u,'cold',4,{frostSide:'enemy'});tickStatuses(u,1);u.statusResistance=1;
 assert.equal(applyStatus(u,'cold',20,{frostSide:'enemy'}),false);assert.equal(u.statuses.find(s=>s.kind==='frozen').remaining,3);
});

test('cold upgrade respects frozen immunity instead of stripping the existing cold',()=>{
 const u={hp:100,maxHp:100,statuses:[],immunities:{frozen:true}};
 assert.equal(applyStatus(u,'cold',5,{source:1,resistible:false}),true);
 assert.equal(statusAttributeChanges(u).attackSpeed,-30);
 // 第二次寒冷：本应升级为冰冻，但目标免疫冰冻 —— 保留并刷新寒冷，而不是清空
 assert.equal(applyStatus(u,'cold',5,{source:1,resistible:false}),true);
 assert.deepEqual(u.statuses.map(s=>s.kind),['cold']);
 assert.equal(u.statuses[0].remaining,5);
 assert.equal(statusAttributeChanges(u).attackSpeed,-30,'寒冷减速必须仍然生效');
 assert.equal(statusAttributeChanges(u).resistance,0,'未进入冰冻，不应有额外法抗削减');
 assert.equal(permissions(u).attack,true,'寒冷不禁止行动');

 // 寒冷到期后正常清除
 tickStatuses(u,5.1);
 assert.deepEqual(u.statuses,[]);
 assert.equal(statusAttributeChanges(u).attackSpeed,0);
});

test('cold still upgrades to frozen when the target is not frozen-immune',()=>{
 const u={hp:100,maxHp:100,statuses:[],immunities:{}};
 applyStatus(u,'cold',4,{source:1,resistible:false});
 applyStatus(u,'cold',4,{source:1,resistible:false});
 assert.deepEqual(u.statuses.map(s=>s.kind),['frozen']);
 assert.equal(statusAttributeChanges(u).resistance,-15);
 assert.equal(permissions(u).attack,false);
 assert.equal(permissions(u).move,false);
});

test('a fully resisted cold never strips an existing cold',()=>{
 const u={hp:100,maxHp:100,statuses:[],immunities:{},statusResistance:1};
 applyStatus(u,'cold',4,{source:1,resistible:false});
 assert.deepEqual(u.statuses.map(s=>s.kind),['cold']);
 assert.equal(applyStatus(u,'cold',4,{source:1,resistible:true}),false);
 assert.deepEqual(u.statuses.map(s=>s.kind),['cold'],'被抵抗的尝试不得删除已有寒冷');
});

test('frozen-immune enemies with real data stay cold without becoming frozen',()=>{
 const u={hp:100,maxHp:100,statuses:[],immunities:{frozen:true,sleep:true}};
 for(let i=0;i<3;i++)applyStatus(u,'cold',3,{source:7,resistible:false});
 assert.equal(u.statuses.filter(s=>s.kind==='cold').length,1);
 assert.equal(u.statuses.some(s=>s.kind==='frozen'),false);
 assert.equal(permissions(u).block,true,'寒冷不得影响阻挡权限');
 assert.equal(permissions(u).skill,true,'寒冷不得影响技能权限');
});
