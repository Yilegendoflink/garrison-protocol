import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {WAVE_STORE_KEY,defaultWaveTable,loadWaveTable,normalizeWaveTable,saveWaveTable,sameWaveTable,waveTableIsDefault} from '../dist/native-wave-fill.js';
import {BOND_BAN_KEY,banConfigIsDefault,defaultBanRules,loadBondBan,resetBondBan,saveBondBan} from '../dist/native-bond-ban.js';

// 大厅「配置已改动」提示（用户 2026-09-22 口径）：
//   ① 只有「敌人池」或「盟约禁用配置」与默认不一致时才出现；
//   ② 点击它把两者**一起**恢复默认；
//   ③ 电脑端样式要正常：大厅的 `.native-home button{width:100%}` 会把提示文字挤成一列一个字。
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=file=>readFile(path.join(root,'dist',file),'utf8');

// 这两个模块都用 `typeof localStorage!=='undefined'` 兜底，测试里塞一个内存实现即可。
function withStorage(run){
 const previous=globalThis.localStorage,map=new Map();
 globalThis.localStorage={getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),clear:()=>map.clear()};
 try{return run(map);}finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
}

test('敌人池判定：默认表算干净，改过任意一处就算已改动（键序差异不算）',()=>withStorage(()=>{
 assert.equal(waveTableIsDefault(defaultWaveTable()),true,'从没读过存档时按默认表判定');
 assert.equal(waveTableIsDefault(loadWaveTable()),true,'没有存档时 loadWaveTable 就是默认表');
 assert.equal(sameWaveTable(defaultWaveTable(),JSON.parse(JSON.stringify(defaultWaveTable()))),true,'同一份配置的副本算相同');
 saveWaveTable(defaultWaveTable());
 assert.equal(waveTableIsDefault(loadWaveTable()),true,'存回默认表仍然是干净的');
 // 改预算／改池子／改费用都算改动
 const budget=defaultWaveTable();budget.types.TIMES[1].templates[0].budget+=5;saveWaveTable(budget);
 assert.equal(waveTableIsDefault(loadWaveTable()),false,'改预算要算已改动');
 saveWaveTable(defaultWaveTable());
 const pool=defaultWaveTable();pool.types.TIMES[1].templates[0].pool=[];saveWaveTable(pool);
 assert.equal(waveTableIsDefault(loadWaveTable()),false,'清空敌人池要算已改动');
 saveWaveTable(defaultWaveTable());
 const cost=defaultWaveTable();cost.defaultCost=7;saveWaveTable(cost);
 assert.equal(waveTableIsDefault(loadWaveTable()),false,'改默认费用要算已改动');
}));

test('禁用配置判定：默认方案算干净，只改 never 也算已改动',()=>withStorage(()=>{
 assert.equal(banConfigIsDefault(NATIVE_DATA,defaultBanRules()),true);
 assert.equal(banConfigIsDefault(NATIVE_DATA,loadBondBan(NATIVE_DATA)),true,'没有存档时 loadBondBan 就是默认方案');
 // 顺序不同但集合相同 → 不算改动
 const reordered={always:[],never:[...defaultBanRules().never].reverse()};
 assert.equal(banConfigIsDefault(NATIVE_DATA,reordered),true,'数组顺序差异不算改动');
 // 固定禁用某个盟约 → 改动
 const fixed={always:[defaultBanRules().never[0]],never:defaultBanRules().never};
 assert.equal(banConfigIsDefault(NATIVE_DATA,fixed),false,'多一个固定禁用要算已改动');
 // 把默认「不被禁」的盟约放回随机池 → 改动
 const released={always:[],never:defaultBanRules().never.slice(1)};
 assert.equal(banConfigIsDefault(NATIVE_DATA,released),false,'放回随机池要算已改动');
}));

test('恢复默认：敌人池与禁用配置一起回到默认，未改动的仍然是干净',()=>withStorage(map=>{
 const table=defaultWaveTable();table.types.TIMES[1].templates[0].budget+=9;saveWaveTable(table);
 saveBondBan({always:[defaultBanRules().never[0]],never:defaultBanRules().never},NATIVE_DATA);
 assert.equal(waveTableIsDefault(loadWaveTable()),false);
 assert.equal(banConfigIsDefault(NATIVE_DATA),false);
 // 这就是大厅按钮做的事
 saveWaveTable(normalizeWaveTable(defaultWaveTable()));
 resetBondBan(NATIVE_DATA);
 assert.equal(waveTableIsDefault(loadWaveTable()),true,'敌人池回到默认');
 assert.equal(banConfigIsDefault(NATIVE_DATA),true,'禁用配置回到默认');
 assert.ok(map.has(WAVE_STORE_KEY)&&map.has(BOND_BAN_KEY),'两个配置都落到存储里');
}));

test('接线：提示只在任一配置改动时插入，点击走 pool-defaults 同时恢复两者',async()=>{
 const play=await read('native-play.js');
 assert.match(play,/insertAdjacentHTML\('afterbegin',poolDirty\(\)\?'<div class="native-pool-update">/,'提示要按 poolDirty() 条件插入');
 assert.match(play,/function poolDirty\(\)\{return !waveTableIsDefault\(state\.waveTable\|\|loadWaveTable\(\)\)\|\|!banConfigIsDefault\(data\);\}/,'「或」的判定只看这两份配置（判定逻辑在各自模块里）');
 assert.match(play,/data-act="pool-defaults">恢复默认配置</,'按钮文案与动作');
 assert.match(play,/if\(a==='pool-defaults'\)\{[\s\S]{0,240}saveWaveTable\(normalizeWaveTable\(defaultWaveTable\(\)\)\);/,'点击要恢复敌人池默认');
 assert.match(play,/if\(a==='pool-defaults'\)\{[\s\S]{0,320}resetBondBan\(data\);/,'点击要一起恢复禁用配置');
 assert.match(play,/resetBondBan\(data\);[\s\S]{0,220}render\(\);return;/,'恢复后要重渲染（提示随之消失）');
 // 编制台里那个「恢复默认」只动敌人池，别被这次改动带跑
 assert.doesNotMatch(play,/data-act="ed-defaults">恢复默认配置/,'大厅按钮不要再复用 ed-defaults');
});

test('电脑端样式：动作按钮不吃大厅的 width:100%，文字块占满剩余宽度',async()=>{
 const css=await read('native.css');
 assert.match(css,/\.native-home button,\.native-home a\{display:block;width:100%/,'前提：大厅的按钮默认是全宽（这就是提示被挤成一列字的原因）');
 assert.match(css,/\.native-pool-update-action\{[^}]*width:auto!important/,'动作按钮要显式 width:auto');
 assert.match(css,/\.native-pool-update-action\{[^}]*display:inline-block!important/,'还要覆盖 display:block');
 assert.match(css,/\.native-pool-update>div\{[^}]*flex:1 1 auto/,'文字块要占满剩余宽度，不能挤成最小内容宽度');
 assert.match(css,/@media\(max-width:680px\)\{\.native-pool-update\{align-items:stretch;flex-direction:column\}\.native-pool-update-action\{width:100%!important\}\}/,'窄屏堆叠时仍然整行');
});
