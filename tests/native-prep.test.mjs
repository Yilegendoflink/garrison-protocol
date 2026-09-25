import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {richText} from '../dist/protocol.js';
import {NativeSession} from '../dist/native-session.js';
import {bondIsCore} from '../dist/native-bond-ban.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';
import {
 PREP_SKILL_KEY,PREP_SKILL_VERSION,PREP_TIERS,applyPrepSkills,clearPrepSkills,filterPrepEquipment,
 filterPrepOperators,loadPrepSkills,normalizePrepSkills,prepBondOptions,prepCatalog,prepDirtyCount,
 prepEquipmentRows,prepOperatorRow,prepOperatorRows,renderPreparePage,savePrepSkills,
} from '../dist/native-prep.js';

// 战前准备（用户 2026-09-22 口径）：大厅新入口 → 独立页面，两个页签（全干员／全装备效果），
// 下方筛选条（阶级 1–6 六个数字选项 ＋ 核心／附加盟约两个下拉），页面上能改干员默认技能，
// 保存后局内购买该干员默认携带指定技能；打开时的初始状态就是当前的默认配置。
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=file=>readFile(path.join(root,file),'utf8');

// 每个用例自己装一个内存 localStorage；退出时恢复原样（Node 里默认没有 localStorage）。
function withStorage(run){
 const previous=globalThis.localStorage;
 try{
  const store=new Map();
  globalThis.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  return run(store);
 }finally{
  if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;
 }
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui={esc,avatar:charId=>`<img data-avatar="${charId}" alt="">`};
const render=(prep,tab)=>renderPreparePage(data,{tab:tab||'operator',tier:0,core:'',extra:'',skills:{},saved:{},...prep},ui);
const stores=Object.values(data.season.charShopChessDatas).filter(s=>s.charId&&!s.isHidden);

test('名册：112 名干员按 charId 归并，56 件可见装备（3 件隐藏道具不列）',()=>{
 const rows=prepOperatorRows(data);
 assert.equal(rows.length,112,'名册与干员数一致（按 charId 归并，精锐与初始算同一名）');
 assert.equal(new Set(rows.map(r=>r.charId)).size,112);
 for(const row of rows){
  assert.ok(row.chessId&&data.profiles[row.chessId],`${row.name} 要能落到一个真实形态`);
  assert.ok(row.choices.length>=1,`${row.name} 至少要有一个技能档`);
  assert.ok(row.archive===null||row.choices.some(c=>c.index===row.archive),`${row.name} 的档案默认档必须真存在`);
 }
 const equipment=prepEquipmentRows(data);
 const visible=Object.values(data.items).filter(item=>!item.hidden);
 assert.equal(equipment.length,visible.length,'可见装备全部列出');
 assert.equal(equipment.filter(item=>item.elite).length,visible.filter(item=>item.elite).length,'精锐形态文案也要列');
 for(const item of equipment)assert.ok(item.base||item.elite,item.name+' 至少要有一份效果文案');
 for(const id of ['chess_item_6_01_m','chess_item_6_02_m','chess_item_6_03_m'])assert.ok(!equipment.some(item=>item.id===id),'隐藏的悬赏道具不列进装备效果页');
 // 页面把「初始形态的档位」当成该干员的档位，所以精锐形态的技能档必须与初始形态逐项一致。
 for(const shop of stores){
  const base=data.profiles[shop.chessId],golden=data.profiles[shop.goldenChessId];
  assert.ok(golden,`${shop.charId} 缺少精锐形态档案`);
  assert.deepEqual((golden.skillChoices||[]).map(c=>c.skill?.name),(base.skillChoices||[]).map(c=>c.skill?.name),`${shop.charId} 精锐与初始的技能档必须一致，否则「默认技能」对精锐形态会错位`);
 }
});

test('筛选：阶级 1–6 六个选项、核心 8 ＋ 附加 15 两个下拉，两个下拉同时生效',()=>{
 assert.deepEqual([...PREP_TIERS],[1,2,3,4,5,6],'阶级筛选就是 1–6 六个数字选项');
 const rows=prepOperatorRows(data),bonds=prepBondOptions(data);
 assert.equal(bonds.core.length,8,'核心盟约 8 个');
 assert.equal(bonds.extra.length,15,'附加盟约 15 个');
 for(const bond of bonds.core)assert.equal(bondIsCore(data,bond.id),true,bond.name+' 要按原表 isPower 归到核心');
 for(const bond of bonds.extra)assert.equal(bondIsCore(data,bond.id),false,bond.name+' 是附加盟约');
 // 阶级筛选的人数与原表商店分档一致。
 const counts={};for(const shop of stores)counts[shop.chessLevel]=(counts[shop.chessLevel]||0)+1;
 for(const tier of PREP_TIERS){
  const list=filterPrepOperators(rows,{tier});
  assert.equal(list.length,counts[tier],`${tier} 阶共 ${counts[tier]} 人`);
  assert.ok(list.every(row=>row.tier===tier));
 }
 assert.equal(filterPrepOperators(rows,{}).length,rows.length,'不选就是不筛');
 // 核心＋附加是「同时满足」：拉特兰 ＋ 迅捷 这类双盟约干员仍要能筛出来。
 const both=filterPrepOperators(rows,{core:'lateranoShip',extra:'swiftShip'});
 assert.ok(both.length>0,'要有同时挂拉特兰与迅捷的干员');
 assert.ok(both.every(row=>row.bonds.includes('lateranoShip')&&row.bonds.includes('swiftShip')));
 assert.ok(filterPrepOperators(rows,{core:'lateranoShip',extra:'yanShip'}).length===0,'两个盟约不同时满足时筛空');
 // 装备按自己的盟约归属筛（装备的 giveBondId 是它自己的盟约，不是给携带者的）。
 const items=prepEquipmentRows(data),victoria=filterPrepEquipment(items,{core:'victoriaShip'});
 assert.ok(victoria.length>0,'维多利亚有专属装备');
 assert.ok(victoria.every(item=>item.bond==='victoriaShip'));
 assert.equal(filterPrepEquipment(items,{tier:1}).length,items.filter(item=>item.tier===1).length);
});

test('初始状态＝当前默认配置：没设置过的干员跟随档案默认，购买时一个字段都不写',()=>{
 withStorage(()=>{
  assert.deepEqual(loadPrepSkills(data),{},'没配置过就是空表');
  const html=render();
  assert.match(html,/<option value="" selected>跟随档案默认（/,'下拉默认选中「跟随档案默认」');
  assert.ok(!html.includes('未保存的改动'),'刚打开时没有未保存改动');
  assert.match(html,/与已保存配置一致/);
  // 没有配置时 applyPrepSkills 不写 skillIndex（＝行为和以前完全一致）。
  const row=prepOperatorRows(data).find(r=>r.choices.length>=2);
  const unit={uid:1,chessId:row.chessId,charId:row.charId};
  applyPrepSkills(data,[unit]);
  assert.equal(unit.skillIndex,undefined,'没有配置就不能凭空写死档位');
 });
});

test('配置落盘：带版本号、非法干员／档位被丢弃、可以整体清空',()=>{
 withStorage(store=>{
  const a=prepOperatorRows(data).find(r=>r.choices.length>=2);
  const b=prepOperatorRows(data).find(r=>r.choices.length>=1&&r.charId!==a.charId);
  const saved=savePrepSkills({[a.charId]:a.choices[1].index,'char_not_here':0,[b.charId]:9},data);
  assert.deepEqual(saved,{[a.charId]:a.choices[1].index},'只留名册里真实存在、且档位合法的条目');
  const raw=JSON.parse(store.get(PREP_SKILL_KEY));
  assert.equal(raw.version,PREP_SKILL_VERSION,'配置要带版本号');
  assert.deepEqual(raw.skills,saved);
  assert.deepEqual(loadPrepSkills(data),saved);
  store.set(PREP_SKILL_KEY,JSON.stringify({version:PREP_SKILL_VERSION-1,skills:{[a.charId]:0}}));
  assert.deepEqual(loadPrepSkills(data),{},'旧版本配置要整份丢弃');
  store.set(PREP_SKILL_KEY,'{ not json');
  assert.deepEqual(loadPrepSkills(data),{},'坏数据回落成空表而不是崩掉');
  store.set(PREP_SKILL_KEY,JSON.stringify({version:PREP_SKILL_VERSION,skills:{[a.charId]:0}}));
  assert.deepEqual(loadPrepSkills(data),{[a.charId]:0});
  clearPrepSkills();
  assert.deepEqual(loadPrepSkills(data),{},'清空后回到「全部跟随档案默认」');
  assert.deepEqual(normalizePrepSkills({skills:{[a.charId]:a.choices[0].index}},data),{[a.charId]:a.choices[0].index},'也接受 {skills:{...}} 形式的原始配置');
 });
});

test('保存后局内购买默认携带指定技能：同名副本一致，精锐形态同样生效',()=>{
 withStorage(()=>{
  const row=prepOperatorRows(data).find(r=>r.choices.length>=2&&r.tier<=3);
  const index=row.choices.find(c=>c.index!==row.archive).index;
  savePrepSkills({[row.charId]:index},data);
  const g=new NativeSession(data,{bondBan:NO_BOND_BAN,seed:11});
  const first=g.gain(row.chessId);
  assert.equal(first.skillIndex,index,'购买的干员默认携带配置的技能');
  assert.equal(g.gain(row.chessId).skillIndex,index,'第二张同名卡同样默认携带');
  // 精锐形态是同一名干员的另一种形态（charId 相同），也要拿到同一个默认技能。
  const golden=data.season.charShopChessDatas[row.chessId].goldenChessId;
  assert.equal(g.gain(golden).skillIndex,index,'精锐形态也要按同一份默认技能');
  for(const unit of g.s.units)assert.equal(unit.skillIndex,index,'同名干员的全部副本必须一致');
 });
});

test('局内已经显式改过技能时，配置不会把它覆盖回去',()=>{
 withStorage(()=>{
  const row=prepOperatorRows(data).find(r=>r.choices.length>=3);
  const configured=row.choices.find(c=>c.index!==row.archive).index;
  const inRun=row.choices.find(c=>c.index!==row.archive&&c.index!==configured).index;
  savePrepSkills({[row.charId]:configured},data);
  const g=new NativeSession(data,{bondBan:NO_BOND_BAN,seed:12});
  const first=g.gain(row.chessId);
  assert.equal(first.skillIndex,configured);
  assert.equal(g.perform('skill',first.uid,inRun),true,'局内可以改技能');
  assert.equal(g.gain(row.chessId).skillIndex,inRun,'再买一张要沿用局内改过的档位，不能被配置覆盖');
  for(const unit of g.s.units)assert.equal(unit.skillIndex,inRun);
 });
});

test('读档补齐与对齐：显式档位优先，没写过档位的按配置补上',()=>{
 withStorage(()=>{
  const rows=prepOperatorRows(data);
  const a=rows.find(r=>r.choices.length>=2),b=rows.find(r=>r.choices.length>=2&&r.charId!==a.charId);
  const target=a.choices.find(c=>c.index!==a.archive).index;
  savePrepSkills({[a.charId]:a.choices.find(c=>c.index!==target&&c.index!==a.archive)?.index??a.archive,[b.charId]:b.choices[b.choices.length-1].index},data);
  const units=[
   {uid:1,chessId:a.chessId,charId:a.charId,skillIndex:target},
   {uid:2,chessId:a.chessId,charId:a.charId},
   {uid:3,chessId:b.chessId,charId:b.charId},
  ];
  applyPrepSkills(data,units);
  assert.equal(units[0].skillIndex,target,'存档里显式写下的档位优先');
  assert.equal(units[1].skillIndex,target,'同一名干员缺档位的副本对齐到那个值');
  assert.equal(units[2].skillIndex,b.choices[b.choices.length-1].index,'没写过档位的按配置补');
  // 没有配置、也没有显式档位时保持 undefined（旧存档与旧行为不受影响）。
  const c=rows.find(r=>r.choices.length>=2&&![a.charId,b.charId].includes(r.charId));
  const free={uid:4,chessId:c.chessId,charId:c.charId};
  applyPrepSkills(data,[free]);
  assert.equal(free.skillIndex,undefined);
 });
});

test('页面：两个页签、六个阶级选项、两个盟约下拉、保存按钮与未保存提示',()=>{
 withStorage(()=>{
  const row=prepOperatorRows(data).find(r=>r.choices.length>=2);
  const index=row.choices.find(c=>c.index!==row.archive).index;
  const html=render({tier:row.tier,skills:{[row.charId]:index},saved:{}});
  assert.match(html,/data-act="prep-tab" data-tab="operator"/,'全干员页签');
  assert.match(html,/data-act="prep-tab" data-tab="equipment"/,'全装备效果页签');
  assert.equal((html.match(/data-act="prep-tier" data-tier="\d"/g)||[]).length,6,'阶级就是 1–6 六个数字按钮');
  assert.match(html,new RegExp(`data-act="prep-tier" data-tier="${row.tier}" class="chosen"`),'当前阶级要高亮');
  assert.match(html,/id="prep-core"/,'核心盟约下拉');
  assert.match(html,/id="prep-extra"/,'附加盟约下拉');
  assert.match(html,/data-act="prep-save"/,'保存按钮');
  assert.match(html,/data-act="prep-clear"/,'一键改回档案默认');
  assert.match(html,/未保存的改动 1 项/,'未保存改动要计数');
  assert.match(html,/class="native-prep-list" id="prep-list"/,'列表容器');
  assert.match(html,new RegExp(`data-act="prep-skill" data-char="${row.charId}"`),'每名干员一个默认技能下拉');
  assert.equal((html.match(/data-act="prep-skill"/g)||[]).length,filterPrepOperators(prepOperatorRows(data),{tier:row.tier}).length,'列表按筛选结果渲染');
  // 两个盟约下拉的选中项要跟着筛选状态走。
  const filtered=render({core:'victoriaShip',extra:'investShip'});
  assert.match(filtered,/<option value="victoriaShip" selected>/,'核心盟约下拉要回显当前筛选');
  assert.match(filtered,/<option value="investShip" selected>/,'附加盟约下拉要回显当前筛选');
  assert.ok(filtered.includes('<p class="native-prep-empty">'),'筛不出条目时要给一句说明');
  // 装备页要把基础与精锐两份效果文案都列出来（取原表 effectInfoDataDict 的 effectDesc）。
  const item=Object.values(data.items).find(entry=>entry.elite&&!entry.hidden);
  const equipment=render({tab:'equipment'},'equipment');
  const baseText=esc(richText(data.season.effectInfoDataDict[item.normal.effectId].effectDesc));
  const eliteText=esc(richText(data.season.effectInfoDataDict[item.elite.effectId].effectDesc));
  assert.ok(baseText!==eliteText,'拿一件基础／精锐文案不同的装备做样本');
  assert.ok(equipment.includes(baseText),'装备页要列基础形态的效果文案：'+baseText);
  assert.ok(equipment.includes(eliteText),'装备页要列精锐形态的效果文案：'+eliteText);
  assert.equal((equipment.match(/native-prep-item/g)||[]).length,prepEquipmentRows(data).length,'装备页列出全部可见装备');
  assert.equal(prepCatalog(data).operators.length,112);
  assert.equal(prepDirtyCount({a:1,b:0},{a:1}),1,'新增的覆盖算一处改动');
  assert.equal(prepDirtyCount({a:1},{a:1,b:2}),1,'删掉的覆盖也算一处改动');
  assert.equal(prepDirtyCount({a:1},{a:1}),0);
  assert.equal(prepOperatorRow(data,row.charId).name,row.name);
 });
});

test('接线：大厅入口、独立页面、动作与筛选下拉都接上，模块登记进构建脚本',async()=>{
 const [lobby,play,session,css,build]=await Promise.all([read('dist/native-lobby.js'),read('dist/native-play.js'),read('dist/native-session.js'),read('dist/native.css'),read('scripts/build-browser.mjs')]);
 assert.match(lobby,/data-act="prepare"><span class="native-tool-icon">◈<\/span><span><b>战前准备<\/b>/,'大厅资料与工具里要有「战前准备」入口');
 assert.match(play,/if\(state\.view==='prepare'\)\{const p=prepState\(\);root\.innerHTML=renderPreparePage\(data,p,\{esc,avatar\}\)/,'独立页面走 renderPreparePage');
 for(const [act,label] of [['prepare','打开页面'],['prep-tab','切页签'],['prep-tier','阶级筛选'],['prep-save','保存'],['prep-clear','改回档案默认']])assert.match(play,new RegExp(`a==='${act}'`),`动作 ${act}（${label}）要接上`);
 assert.match(play,/if\(e\.target\.id==='prep-core'\)\{p\.core=e\.target\.value/,'核心盟约下拉要重筛');
 assert.match(play,/if\(e\.target\.id==='prep-extra'\)\{p\.extra=e\.target\.value/,'附加盟约下拉要重筛');
 assert.match(play,/e\.target\.dataset\.act==='prep-skill'\)\{const charId=e\.target\.dataset\.char/,'技能下拉改的是草稿');
 assert.match(play,/if\(!p\.skills\)\{p\.saved=loadPrepSkills\(data\);p\.skills=\{[^}]*\.\.\.p\.saved\}/,'打开页面时草稿从已保存配置复制（初始状态＝当前默认）');
 assert.match(play,/p\.saved=savePrepSkills\(p\.skills,data\)/,'保存按钮才写 localStorage');
 assert.match(play,/state\.view==='editor'\|\|state\.view==='briefing'\|\|state\.view==='prepare'/,'「回到大厅」要把 prepare 一起处理');
 assert.match(session,/applyPrepSkills\(this\.data,this\.s\.units\.filter\(v=>v\.charId===u\.charId\)\)/,'购买时按配置给新干员定默认技能（只对齐同名副本）');
 assert.match(session,/applyPrepSkills\(data,c\.s\.units\)/,'读档时补齐／对齐同名干员的技能');
 assert.match(build,/'native-prep\.js'/,'新模块必须登记进构建脚本');
 assert.match(css,/\.native-prep-filters\{position:sticky;bottom:0/,'筛选条放在界面下方并吸底');
 assert.match(css,/\.native-prep-tier-row button\.chosen\{/,'选中的阶级要有高亮');
 assert.match(css,/\.native-prep-card\.is-custom\{/,'改过默认技能的干员卡片要能看出来');
});
