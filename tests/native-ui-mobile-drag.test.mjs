import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 手机端拖放与遮挡修正（2026-09-22 用户报障）：
//   1. 整备区的装备卡片是 <div role="button" data-act="item">，只有 <button> 有 touch-action:none，
//      手机上拖动被当成横向滚动、随即 pointercancel —— 装备没法拖到干员身上。
//   2. 盖在棋盘上的信息层（整备区标签、朝向面板的说明文字）会挡住预览格，
//      按不到画布就选不了朝向；触屏下关掉这两段说明文字，并让信息层指针穿透。
//   3. 商店干员的详情要能点其他地方直接关闭。
//   4. 干员档案的名字旁边直接标出所属盟约。
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css=await readFile(path.join(root,'dist/native.css'),'utf8');
const play=await readFile(path.join(root,'dist/native-play.js'),'utf8');

test('整备区的装备卡片与干员卡一样禁止 touch-action 滚动，手机才拖得动',()=>{
 assert.match(css,/\.native-bench button,\.native-bench>\[data-act="item"\]\{[^}]*touch-action:none/,
  '装备卡片必须和干员卡一起拿到 touch-action:none，否则手机的拖动会被横向滚动接管');
 assert.match(css,/\.native-bench button,\.native-bench>\[data-act="item"\]\{[^}]*(-webkit-touch-callout:none)/,
  '长按菜单也要关掉，否则拖到一半会弹出系统菜单');
 assert.match(css,/\.native-bench>\[data-act="item"\]\{[^}]*flex:0 0 68px[^}]*height:94px/,
  '桌面端装备卡片要和干员卡同尺寸');
 assert.match(css,/html\.native-landscape-ui \.native-bench>\[data-act="item"\]\{[^}]*flex:0 0 62px[^}]*height:40px/,
  '手机横屏下装备卡片要和干员卡同样缩到 62×40');
});

test('盖在棋盘上的信息层不再拦截指针，触屏下关掉说明文字',()=>{
 assert.match(css,/\.native-bench-label\{pointer-events:none\}/,'整备区标签是纯信息层，必须让指针穿透');
 assert.match(css,/\.native-facing\{pointer-events:none\}/,'朝向面板本体要穿透，否则会挡住预览格的拖动');
 assert.match(css,/\.native-facing button\{pointer-events:auto\}/,'朝向面板的按钮仍要能点');
 const hover=css.slice(css.indexOf('@media(hover:none)'));
 assert.match(hover,/\{[\s\S]*\.native-bench-label #native-drop-hint\{display:none\}/,'触屏关掉「可将场上干员拖回此处……」的提示文字');
 assert.match(hover,/\{[\s\S]*\.native-facing \.native-facing-tip\{display:none\}/,'触屏关掉朝向面板里的说明文字');
 assert.match(play,/<span class="native-facing-tip">拖动选择朝向/,'说明文字要单独成 span，才能只关文字、保留方向按钮');
});

test('商店干员／装备详情点其他地方直接关闭，且不打断购买流程',()=>{
 assert.match(play,/function dismissInspectOnOutsidePress\(e\)/,'详情关闭要有统一入口');
 assert.match(play,/if\(dismissInspectOnOutsidePress\(e\)\)return;/,'pointerdown 里要调用它（手机与桌面共用同一条路径）');
 const helper=play.slice(play.indexOf('function dismissInspectOnOutsidePress(e)'));
 const body=helper.slice(0,helper.indexOf('\n}'));
 assert.match(body,/\['unit','shop','shopItem','pack','equip','summon'\]/,'商店干员（shop）必须在可关闭的详情里');
 assert.match(body,/button\[data-act="buy"\], button\[data-act="buyItem"\], \[data-act="reward"\]/,'商店卡片与奖励候选不能被关详情吞掉：同卡再点＝购买、异卡再点＝切详情');
 assert.match(body,/state\.item&&e\.target\.closest\?\.\('\[data-act="select"\]'\)/,'已选好装备再点干员是要装备，不能只关闭详情');
});

test('干员档案的名字旁边直接标出所属盟约',()=>{
 assert.match(play,/native-dossier-name-bonds/,'档案标题旁边要有盟约标签');
 const at=play.indexOf('native-dossier-name-bonds');
 const title=play.slice(at-260,at+220);
 assert.match(title,/bondIds\.length/,'标签要用干员自身的盟约（含装备叠加的盟约）渲染');
 assert.match(title,/bondInfoDict\[id\]\?\.name/,'盟约名走原表，不要在这里写死');
 assert.match(css,/\.native-dossier-name-bonds\{[^}]*inline-flex/,'盟约标签要跟在名字后面横排');
});
