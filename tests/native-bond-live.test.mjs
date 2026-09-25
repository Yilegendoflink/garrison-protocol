// 用户 2026-09-23：「在战斗中触发的层数变化是否实时显示？至少谢拉格目前测试到回合结束才累加」。
// 根因：盟约侧栏（`.native-bonds`）过去只在 `render()` 里生成，而战斗期间 `render()` 只在阶段切换时
// （波次结束／整局结束）跑一次，于是战斗中叠的层要等回合结束那一刻才显示。现在 `updateHud()`
// （每 0.2 秒模拟时间跑一次，可见与后台都跑）会调 `updateBondLive()`，按当前层数重算侧栏与打开着的盟约面板。
// 本文件：① 真启动 native 客户端打一局，**战斗中**侧栏（只由 updateBondLive 写的替身节点）内容必须等于局内状态；
// ② 局内状态一变，下一次 HUD 节奏就要更新（旧实现只能在 render() 时更新）；
// ③ 源码门禁：刷新只有这一条路径，且 render()／面板／实时刷新共用同一份 HTML 生成器。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHost,startBattleWithUnit,deployLastUnit} from './native-host.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const play=fs.readFileSync(path.join(root,'dist/native-play.js'),'utf8');
const shownLayers=html=>[...html.matchAll(/data-id="([^"]+)"[\s\S]*?<small>([^<]*)<\/small>/g)].map(m=>[m[1],m[2]]);
const buttonCount=html=>(html.match(/data-act="bond-info"/g)||[]).length;

test('战斗中盟约侧栏的层数跟着局内状态走（不再等回合结束）',async()=>{
 const host=createHost();
 await startBattleWithUnit(host);
 host.tick(40);                                        // 跑过几个 HUD 节奏（0.2 秒模拟时间一次）
 const first=host.save().s;
 assert.equal(first.phase,'battle','这一步必须处于战斗中');
 const bars=host.virtual('.native-bonds').innerHTML;   // 这个替身只有 updateBondLive 会写
 assert.ok(buttonCount(bars)>0,'战斗中侧栏也应当由实时刷新写进去');
 for(const [id,text] of shownLayers(bars))assert.equal(text,((first.bondLayers?.[id])||0)+' 层',`${id} 的侧栏层数必须等于局内层数`);
 // 战斗中继续推进：render() 在这段时间里不会跑，侧栏仍必须跟着局内状态走
 host.tick(80);
 const again=host.save().s;
 assert.equal(again.phase,'battle');
 for(const [id,text] of shownLayers(host.virtual('.native-bonds').innerHTML))assert.equal(text,((again.bondLayers?.[id])||0)+' 层',id);
 assert.match(host.elements.get('app').innerHTML,/class="native-bonds"/,'侧栏还在页面里（没有被整页重建）');
});

test('局内状态一变，侧栏在下一次 HUD 节奏就更新',async()=>{
 const host=createHost();
 await host.dispatch('new');
 await host.dispatch('begin');
 await host.dispatch('buy',{index:'0'});await host.dispatch('buy',{index:'0'});   // 买下但先不落场
 host.tick(20);
 const before=host.virtual('.native-bonds').innerHTML;
 assert.equal(buttonCount(before),0,'还没落场时侧栏是占位文案');
 await deployLastUnit(host);                        // 落场：盟约计数从 0 变 1
 host.tick(20);
 const after=host.virtual('.native-bonds').innerHTML;
 assert.ok(buttonCount(after)>0,'落场后侧栏必须在下一次 HUD 节奏列出盟约');
 assert.notEqual(after,before);
 const live=host.save().s;
 for(const [id,text] of shownLayers(after))assert.equal(text,((live.bondLayers?.[id])||0)+' 层',id);
});

test('源码门禁：层数实时刷新只有 updateBondLive 一条路径，HTML 只有一份',()=>{
 assert.equal((play.match(/function bondSidebarHtml/g)||[]).length,1,'侧栏 HTML 生成器只能有一份');
 assert.equal((play.match(/function bondModalHtml/g)||[]).length,1,'盟约面板 HTML 生成器只能有一份');
 assert.match(play,/<aside class="native-bonds">\$\{bondSidebarHtml\(g,rows\)\}<\/aside>/,'render() 用生成器建侧栏');
 assert.match(play,/if\(a==='bond-info'\)\{modal\(bondModalHtml\(button\.dataset\.id\),\{bond:button\.dataset\.id\}\);return;\}/,'点击盟约按钮也走生成器');
 assert.match(play,/if\(aside\.dataset\.bondSig!==html\)\{aside\.dataset\.bondSig=html;aside\.innerHTML=html;\}/,'只在内容真的变了才写 DOM');
 assert.match(play,/updateBondLive\(\);\n if\(!painting&&eggOn\(\)\)/,'updateHud 每个 HUD 节奏调用一次 updateBondLive');
 assert.match(play,/const bond=state\.modalMeta&&state\.modalMeta\.bond;/,'打开着的盟约面板也一起刷新');
});
