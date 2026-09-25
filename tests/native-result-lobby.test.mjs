import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 整局结束（打完 BOSS 的木桩播报／血量清空 game over）之后必须留一条回大厅的路（用户 2026-09-22 口径）。
// 三个落点：① 作战报告底部动作行 ② 血量清空那面「波次结束」横幅 ③ 模拟结束后的控制栏。
// 另外回大厅要顺手收掉演出层：它是挂在 root 上的浮层，还带着「1 秒后自动弹报告」的定时器，
// 只靠 render() 擦节点的话，那枚定时器会把报告弹到大厅上面。
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=file=>readFile(path.join(root,'dist',file),'utf8');

test('作战报告底部动作行同时给出「导出本次记录」与「回到大厅」',async()=>{
 const play=await read('native-play.js');
 assert.match(play,/function showResult\(\)/,'报告入口还在');
 assert.match(play,/<div class="native-result-actions"><button data-act="export">导出本次记录<\/button><button class="native-primary" data-act="home">回到大厅<\/button><\/div>/,
  '报告底部要留回到大厅的按钮，并且是这一屏的主按钮');
 assert.match(play,/底部动作行用 `\.native-result-actions`\s*\n\/\/ 吸底/,'报告动作行要有吸底注释说明（手机上伤害列表会滚动）');
});

test('血量清空的结束横幅除「查看伤害报告」外还留一个「回到大厅」',async()=>{
 const play=await read('native-play.js');
 assert.match(play,/<div class="native-round-end-actions"><button class="native-primary" data-act="\$\{info\.gameOver\?'result':'next'\}">\$\{info\.gameOver\?'查看伤害报告':'进入下一回合 →'\}<\/button>\$\{info\.gameOver\?'<button data-act="home">回到大厅<\/button>':''\}<\/div>/,
  'game over 的横幅要并列两个按钮，普通回合结束仍然只有「进入下一回合」');
});

test('模拟结束后的控制栏也留「回到大厅」',async()=>{
 const play=await read('native-play.js');
 assert.match(play,/s\.phase==='finished'\?'<button data-act="result">查看伤害报告<\/button><button data-act="home">回到大厅<\/button>':''/,
  'finished 阶段的控制栏要和报告入口并排放一个回到大厅');
});

test('回大厅会先收掉演出层与它的延时器，报告不会弹到大厅上面',async()=>{
 const play=await read('native-play.js');
 assert.match(play,/if\(a==='home'\)\{dismissRoundEnd\(\);/,'home 动作第一步就要收演出层');
 assert.match(play,/function dismissRoundEnd\(\)\{const r=state\.roundEnd;if\(!r\)return false;if\(r\.timer\)clearTimeout\(r\.timer\);state\.roundEnd=null;r\.node\.remove\(\);return true;\}/,
  'dismissRoundEnd 要清定时器、清引用、摘节点');
 // 自动弹报告那枚定时器的守卫是 `state.roundEnd===r&&r.node.isConnected`；
 // 上面的清理把 state.roundEnd 置空，守卫才会失效（改守卫就要连着改清理）。
 assert.match(play,/if\(state\.roundEnd===r&&r\.node\.isConnected\)showResult\(\);/,'自动报告的定时器守卫不能被绕过');
 assert.match(play,/if\(r\.info\.gameOver\)r\.timer=setTimeout\(\(\)=>\{/,'只有整局结束才会自动弹报告');
});

test('报告动作行与横幅按钮行都有样式（含吸底与手机断点）',async()=>{
 const css=await read('native.css');
 assert.match(css,/\.native-result-actions\{position:sticky;bottom:-1px;[^}]*\}/,'报告动作行要吸底');
 assert.match(css,/\.native-result-actions>button\{flex:1 1 140px/,'两个按钮平分报告底部');
 assert.match(css,/\.native-round-end-actions\{display:flex;flex-wrap:wrap;gap:10px;justify-content:center/,'横幅按钮行要能换行居中');
 assert.match(css,/\.native-round-end-actions>button\{min-width:150px/,'回到大厅按钮要和主按钮同规格');
});
