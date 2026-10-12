import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderLobby} from '../dist/native-lobby.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {createHost} from './native-host.mjs';

// 开始页面（大厅）清理与「输入密码」入口（用户 2026-09-22 口径）：
//   1. 删掉右上角「已知差异」、任务配置里的「费用规则」、资料与工具里的「职业分支规则」与「旧版演示与资料库」；
//   2. 「战前准备」从资料与工具挪进任务配置、排在「恢复本地模拟」上面；
//   3. 资料与工具底部新增「输入密码」→ 数字键盘（数字／删除／清空／确定），确认后的功能待补。
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=file=>readFile(path.join(root,'dist',file),'utf8');
// 大厅是纯字符串渲染：直接渲染真实数据断言最终 HTML，比在源码里找片段更可靠。
const lobbyHtml=(game=null)=>renderLobby({data:NATIVE_DATA,state:{mode:'mode_single_normal',map:'random',band:null,game},avatar:()=>'<img alt="">'});

test('大厅不显示阵地预览卡片，阵地选择仍正确传入新局',async()=>{
 const h=createHost(),app=h.elements.get('app'),maps=NATIVE_DATA.maps.filter(map=>map.weight>0),map=maps[1];
 assert.doesNotMatch(app.html,/native-battlefield-preview|native-home-maps|作战阵地预览/);
 app.fire('change',{target:{id:'native-map',value:map.stageId,dataset:{}}});
 assert.doesNotMatch(app.html,/native-battlefield-preview|native-home-maps/);
 await h.dispatch('new');await h.dispatch('begin');assert.equal(h.save().s.mapId,map.stageId);
});

test('大厅不再有被删掉的入口，战前准备挪进任务配置',async()=>{
 for(const [label,html] of [['没有存档',lobbyHtml()],['有存档',lobbyHtml({s:{round:2}})]]){
  assert.doesNotMatch(html,/data-act="limits"/,label+'：右上角的「已知差异」要删掉');
  assert.doesNotMatch(html,/费用规则/,label+'：任务配置里的「费用规则」备注要删掉');
  assert.doesNotMatch(html,/data-act="branches"/,label+'：资料与工具里的「职业分支规则」要删掉');
  assert.doesNotMatch(html,/legacy\.html|旧版演示/,label+'：「旧版演示与资料库」入口要删掉');
  assert.doesNotMatch(html,/data-act="sandbox"|战斗技能测试场/,label+'：主菜单的「战斗技能测试场」入口要删掉');
  assert.doesNotMatch(html,/native-loadout-note|native-tool-link|sandbox-entry/,label+'：删掉的几块 DOM 不留空壳');
  assert.match(html,/native-loadout-actions"><button class="native-prep-entry" data-act="prepare"><span class="native-prep-entry-icon" aria-hidden="true">◈<\/span><span class="native-prep-entry-label">战前准备<\/span><\/button>(<button data-act="resume">恢复本地模拟<\/button>)?<button data-act="import">导入存档<\/button><\/div><\/section>/,label+'：战前准备要落在任务配置的动作行里（带图标的主入口），且排在「恢复本地模拟」上面');
 }
 // 只是删了入口：技能测试场的代码与动作还在（将来可能挂到「输入密码」后面）
 const play=await read('native-play.js');
 assert.match(play,/if\(a==='sandbox'\)\{enterPlayChrome\(\);openSandbox\(\);return;\}/,'技能测试场的动作不要跟着删，只删入口');
});

test('资料与工具底部新增「输入密码」入口',()=>{
 const html=lobbyHtml();
 assert.match(html,/data-act="passcode"><span class="native-tool-icon">※<\/span><span><b>输入密码<\/b>/,'资料与工具底部要有「输入密码」入口');
 const grid=html.slice(html.indexOf('native-tool-grid'),html.indexOf('native-tool-grid')+600);
 assert.ok(grid.includes('data-act="editor"')&&grid.indexOf('data-act="editor"')<grid.indexOf('data-act="passcode"'),'它排在「协议自定义」之后（也就是列表底部）');
});

test('数字键盘：数字／删除／清空／确定都接上，确认后的动作留了唯一接线点',async()=>{
 const play=await read('native-play.js'),css=await read('native.css');
 assert.match(play,/if\(a==='passcode'\)\{state\.passcode=\{digits:''\};renderPasscodePad\(\);return;\}/,'点入口打开键盘');
 assert.match(play,/if\(a==='passcode-key'\)\{passcodeKey\(button\.dataset\.key\|\|''\);return;\}/,'键盘按键走 passcode-key');
 const pad=play.slice(play.indexOf('function renderPasscodePad()'));
 const body=pad.slice(0,pad.indexOf('\nfunction passcodeKey'));
 assert.match(body,/data-act="passcode-key"/,'键帽都走同一个动作');
 assert.match(body,/data-key="\$\{d\}">\$\{d\}/,'数字键由循环生成');
 const digits=[...body.matchAll(/'(\d)'/g)].map(m=>m[1]);
 for(const key of ['1','2','3','4','5','6','7','8','9'])assert.ok(digits.includes(key),'数字键 '+key);
 assert.match(body,/data-key="0">0</,'数字键 0');
 assert.match(body,/data-key="back"/,'删除一位');
 assert.match(body,/data-key="clear">清空</,'清空键');
 assert.match(body,/data-key="ok" class="native-primary">确定</,'确定键');
 assert.match(play,/if\(key==='clear'\)p\.digits=''/,'清空把已输入的清掉');
 assert.match(play,/else if\(key==='back'\)p\.digits=p\.digits\.slice\(0,-1\)/,'删除只去掉一位');
 assert.match(play,/if\(!p\.digits\)\{notice\('请先输入密码'\);return;\}/,'空密码按确定要给提示');
 // 2026-09-27：确认后的动作改成走密码表（20100305→弹窗「策略：S.E.E.S.已解锁」并置位存档标记；
 // 其它数字只提示「什么都没有发生」）。完整回归在 tests/native-passcode-sees.test.mjs。
 assert.match(play,/function passcodeSubmit\(code\)\{/,'确认后的动作要有唯一接线点');
 assert.match(play,/applyPasscode\(archiveNow\(\),code\)/,'接线点要走 native-passcode 的密码表');
 assert.match(play,/passcodeSubmit\(code\);/, '确定要真的调用那个接线点');
 assert.match(css,/\.native-keypad\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,'键盘是 3 列网格');
 assert.match(css,/\.native-keypad-actions button\{width:100%/,'确定键独占一行');
});
