import test from 'node:test';
import assert from 'node:assert/strict';
import {readTemplates,number,operatorRecord,enemyRecord,selectBattleTemplates,rangeRecord} from '../scripts/prts-parser.mjs';
const page=(templates)=>({pageid:1,title:'测试单位',revisionId:123,revisionAt:'2026-01-01T00:00:00Z',retrievedAt:'2026-09-12T00:00:00Z',contentHash:'abc',categories:[],templates});
test('PRTS parser preserves nested templates, links and equals without evaluating them',()=>{
 const parsed=readTemplates('<!--{{忽略|x=1}}-->{{技能|技能名=测试|技能1消耗=3|技能1描述={{color|blue|攻击+20%}} [[页面|名称]] a=b}}');
 assert.equal(parsed.unbalanced,false);assert.equal(parsed.templates.length,1);assert.equal(parsed.templates[0].fields['技能名'],'测试');
 assert.equal(parsed.templates[0].fields['技能1描述'],'{{color|blue|攻击+20%}} [[页面|名称]] a=b');
 assert.equal(readTemplates('{{属性|atk=1').unbalanced,true);
});
test('PRTS parser distinguishes absent, zero, formulas and duplicate fields',()=>{
 assert.equal(number('0'),0);assert.equal(number(''),null);assert.equal(number(undefined),null);assert.equal(number('{{#expr:1+2}}'),null);assert.equal(number('1.2s'),null);
 const [t]=readTemplates('{{属性|攻击=1|攻击=2}}').templates;assert.equal(t.fields['攻击'],'2');assert.deepEqual(t.duplicateFields,['攻击']);
});
test('operator data keeps original rarity convention, all skill levels and unknown growth anchors',()=>{
 const p=page(readTemplates('{{CharinfoV2|干员id=char_test|干员名=测试|稀有度=5|职业=狙击}}{{属性|精英0_满级=50|精英0_1级_生命上限=100|精英0_满级_生命上限=200|精英1_满级=80|精英1_满级_生命上限=300}}{{技能|技能名=连击|技能类型1=攻击回复|技能类型2=自动触发|技能1初始=0|技能1消耗=5|技能1持续=|技能专精3初始=0|技能专精3消耗=3}}').templates);
 const r=operatorRecord(p);assert.equal(r.rarity,6);assert.equal(r.skills[0].levels.length,2);assert.equal(r.skills[0].levels[0].duration,null);assert.equal(r.phases[1].anchors['1级'].maxHp,200);assert.equal(r.phases[1].derivedAnchors.maxHp.sourceRevision,306583);assert.equal(r.source.revisionId,123);assert.equal(r.quality.simulationReady,false);
});
test('enemy levels inherit only a present previous level and retain explicit blanks',()=>{
 const p=page(readTemplates('{{敌人信息/common2|名称=测试|index=B1}}{{敌人信息/levelcontent|index=0|最大生命值=550|攻击力=130|防御力=0}}{{敌人信息/levelcontent|index=1|最大生命值=2000|攻击力=}}{{敌人信息/levelcontent|index=3|最大生命值=3000}}').templates);
 const r=enemyRecord(p);assert.equal(r.levels[1].stats.defense,0);assert.equal(r.levels[1].stats.attack,null);assert.equal(r.levels[1].inheritedFrom['防御力'],0);assert.equal(r.levels[2].stats.defense,null);assert.equal(r.gameId,null);
});
test('source extraction excludes biographies, voice and module stories',()=>{
 const ts=readTemplates('{{CharinfoV2|干员名=测试|干员id=id|时装1介绍=服装故事}}{{人员档案|档案1文本=故事}}{{模组|名称=模块|攻击=10|基础信息=长篇故事|任务1=任务}}').templates;
 const selected=selectBattleTemplates(ts);assert.equal(selected.length,2);assert.equal(selected[0].fields['时装1介绍'],undefined);assert.equal(selected[1].fields['基础信息'],undefined);assert.equal(selected[1].fields['攻击'],'10');
});

test('range display grids retain origin separately and decline unsupported geometry',()=>{const p={title:'微件:Range/test',pageid:1,revisionId:2,content:'<svg><rect width="22"/><use xlink:href="#1" x="1" y="27"/><use xlink:href="#2" x="28" y="2"/></svg>'};const r=rangeRecord(p);assert.deepEqual(r.displayCells,[{x:0,y:0,kind:'origin'},{x:1,y:-1,kind:'outline'}]);assert.equal(rangeRecord({...p,content:'<svg><circle/></svg>'}).displayCells,null);});
