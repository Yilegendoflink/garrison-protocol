import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStatus,tickStatuses,permissions,statusAttributeChanges} from '../dist/status.js';

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
