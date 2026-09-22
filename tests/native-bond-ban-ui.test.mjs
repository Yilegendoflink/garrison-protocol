import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 盟约禁用的接线（用户 2026-09-22 口径）：机制、判定与名单在 dist/native-bond-ban.js，
// 这里只做源码级门禁，盯住三件容易在重构里丢的事：
//   1. 对局入口真的把「本局禁用」传进 NativeSession（默认开着，沙盒显式关掉）；
//   2. eligible() 是唯一准入过滤点，且池子过滤用的是 bondBanned/isOperatorBanned；
//   3. 商店以外的渠道（gain／奖励候选／援军转让）也走同一条判定。
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const play=await readFile(path.join(root,'dist/native-play.js'),'utf8');
const session=await readFile(path.join(root,'dist/native-session.js'),'utf8');
const economy=await readFile(path.join(root,'dist/native-economy.js'),'utf8');
const editor=await readFile(path.join(root,'dist/native-wave-editor.js'),'utf8');
const build=await readFile(path.join(root,'scripts/build-browser.mjs'),'utf8');
const banModule=await readFile(path.join(root,'dist/native-bond-ban.js'),'utf8');
const css=await readFile(path.join(root,'dist/native.css'),'utf8');

test('对局按种子定死本局禁用的盟约，并原样交给 NativeSession',()=>{
 assert.match(play,/bondBan:\{bonds:bondBanIds\(data,seed\),exempt:loadBondBan\(data\)\.exempt\}/,'简报阶段就要算好这批禁用盟约，玩家看到的就是对局真正用的那份');
 assert.match(play,/bondBan:state\.draft\.bondBan/,'begin 必须把简报那份禁用记录传进 NativeSession');
 assert.match(play,/function newSandbox\(\)\{const economy=new NativeSession\(data,\{[^}]*bondBan:\{bonds:\[\],exempt:\{\}\}/,'沙盒是技能测试场，要显式关掉禁用（否则点名干员会随种子时有时无）');
 assert.match(session,/this\.s\.bondBan=banOption/,'显式传入优先');
 assert.match(session,/\{bonds:bondBanIds\(this\.data,seed\),exempt:loadBondBan\(this\.data\)\.exempt\}/,'没传也要按种子＋编制台名单算一份，不能静默不启用');
});

test('调配池过滤只有一个入口，商店以外的渠道各自挡住',()=>{
 assert.match(session,/eligible\(\)\{return Object\.values\(this\.data\.season\.charShopChessDatas\)\.filter\(o=>o\.charId&&!o\.isHidden&&!this\.isOperatorBanned\(o\.chessId\)\);?\}/,'eligible() 是商店／具名池／later 池共用的唯一准入过滤点');
 assert.match(economy,/bondBanned\(chessId\)\{const ban=this\.s\?\.bondBan;return !!ban&&isOperatorBanned\(/,'判定要在 economy 层，固定点名发放与奖励候选才能共用');
 assert.match(session,/gain\(chessId\)\{\s*if\(this\.bondBanned\(chessId\)\)/,'gain 是所有发放的总入口，被禁干员在这里挡下');
 const gain=session.slice(session.indexOf('gain(chessId){'),session.indexOf('gain(chessId){')+400);
 assert.match(gain,/return null/,'挡下时返回 null（不发、不记账）');
 assert.match(session,/const unit=this\.gain\(record\.chessId\);this\.s\.strategyClaims\[`fang:received:\$\{record\.transferId\}`\]=1;if\(!unit\)continue;/,'援军转让遇到被禁干员要跳过并销账，不能空指针');
 assert.match(economy,/reward\.kind!=='item'&&this\.bondBanned\(id\)\)\)return false;/,'晋升奖励候选也要挡住被禁干员');
 assert.match(economy,/if\(request\.kind!=='item'&&this\.bondBanned\(id\)\)throw Error/,'抽取结果再兜一道门禁，防止新增抽取路径漏过滤');
});

test('编制台单独一页配置每个盟约的不禁用名单',()=>{
 assert.match(editor,/data-act="ed-page" data-page="bonds"/,'编制台要有独立页面入口');
 assert.match(editor,/function renderBondBanPage\(data,ui\)/,'名单页渲染入口');
 assert.match(editor,/data-act="ed-bb-toggle"/,'逐条勾选');
 assert.match(editor,/data-act="ed-bb-all" data-bond="\$\{esc\(id\)\}" data-mode="all"/,'整盟约开关');
 assert.match(editor,/saveBondBan\(ui\.bondBan,data\)/,'每次改动都要落盘（localStorage）');
 assert.match(editor,/loadBondBan\(data\)/,'打开页面时读配置');
 assert.match(play,/garrison-bond-ban\.json/,'名单要能单独导出');
 assert.match(build,/'native-bond-ban\.js'/,'新模块必须登记进构建脚本');
});

 test('固定不被禁的四个盟约与内置名单都在界面上说清楚',()=>{
 assert.match(banModule,/BOND_BAN_EXCLUDED=Object\.freeze\(\['emptyShip','suntShip','maniShip','soloShip'\]\)/,'协防干员／绝技／调和／独行要显式登记为固定不被禁');
 assert.match(banModule,/bondIsBanExcluded\(id\)\)continue/,'抽取池要跳过固定不被禁的盟约');
 assert.match(banModule,/BOND_EXEMPT_TABLE=\{/,'内置的真实不禁用名单要在模块里');
 assert.match(editor,/固定不被禁用/,'编制台要把固定不被禁的四个盟约单独分组');
 assert.match(editor,/恢复内置名单/,'「恢复默认」恢复的是内置真实名单');
 assert.match(banModule,/协防干员／绝技／调和／独行固定不参与/,'简报要说明哪四个盟约不参与抽取');
});

test('战前预览：核心盟约全列＋被禁的灰掉划掉，附加盟约单列，被禁干员进弹窗',()=>{
 // 判定与 HTML 片段在模块里（tests/native-bond-ban.test.mjs 直接断言渲染结果），这里钉住接线与样式。
 assert.match(banModule,/export function bondBanBriefingHtml\(data,ban,ui=\{\}\)/,'简报片段要在可测的模块里');
 assert.match(banModule,/export function bannedOperatorsHtml\(data,ban,ui=\{\}\)/,'被禁干员弹窗内容同样在模块里');
 assert.match(banModule,/native-ban-heading">核心盟约/,'核心盟约要单独一组标题');
 assert.match(banModule,/native-ban-heading">被禁用的附加盟约/,'被禁用的附加盟约要单独一组');
 assert.match(banModule,/data-act="ban-list"/,'简报上要有打开弹窗的按钮');
 assert.match(play,/function bondBanBriefing\(d\)\{return bondBanBriefingHtml\(data,d\?\.bondBan,\{esc\}\);\}/,'native-play 只注入转义函数');
 assert.match(play,/function showBannedOperators\(\)\{modal\(bannedOperatorsHtml\(data,activeBondBan\(state\.draft\?\.bondBan,state\.game\?\.s\?\.bondBan\),\{esc,avatar\}\)\);\}/,'弹窗要用 activeBondBan 取「本局」的记录（draft 优先），不能优先读上一局留下的 state.game');
 assert.match(play,/if\(a==='ban-list'\)\{showBannedOperators\(\);return;\}/,'按钮要接到动作分发');
 assert.match(css,/\.native-ban-bond\.banned\{[^}]*opacity/,'被禁的盟约要灰掉');
 assert.match(css,/\.native-ban-bond\.banned b\{text-decoration:line-through/,'被禁的盟约要划掉名字');
 assert.match(css,/\.native-ban-bond\.available\{[^}]*border-left/,'没被禁的核心盟约要一眼能区分');
 assert.match(css,/\.native-ban-operators\{[^}]*grid/,'被禁干员用头像网格列');
 assert.match(css,/\.native-ban-operators img\{[^}]*filter:grayscale/,'被禁干员头像做成灰的');
});

test('对局内随时能查禁用：桌面顶栏、手机走「战况·设置」面板，盟约那列不放',()=>{
 assert.match(play,/<button class="native-ban-entry" data-act="ban-list">禁用名单<\/button>/,'桌面顶栏要有入口');
 assert.match(play,/const banCount=g\?\.bannedOperatorList\?\.\(\)\.length\|\|0,banBonds=g\?\.s\?\.bondBan\?\.bonds\?\.length\|\|0/,'战况面板要算出被禁干员数与缺席盟约数');
 assert.match(play,/banBonds\?`<button class="native-ban-entry" data-act="ban-list">禁用名单（\$\{banCount\} 名 · 缺席 \$\{banBonds\} 盟约）<\/button>`:''/,'手机端的「战况 / 设置」面板里要有带计数的禁用入口，没有禁用时不显示');
 assert.match(play,/if\(a==='ban-list'\)\{showBannedOperators\(\);return;\}/,'两个入口共用同一个动作');
 // 盟约那列只列当前盟约，不放禁用入口（用户 2026-09-22 口径：电脑也不放）。
 assert.doesNotMatch(play,/native-bond-ban-entry|banEntryButton/,'盟约预览列里不许再放禁用入口');
 assert.doesNotMatch(css,/native-bond-ban-entry/,'盟约预览列的入口样式要一并删掉');
 assert.match(css,/\.native-top \.native-ban-entry\{[^}]*border-left/, '顶栏入口要和普通按钮区分开');
 assert.match(css,/html\.native-landscape-ui #native-modal \.native-ban-entry\{[^}]*width:100%/, '手机端入口在战况面板里占满一行，好点');
});
