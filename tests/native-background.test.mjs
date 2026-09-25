// 用户 2026-09-23 口径：「网页切走时后台继续运行而不是暂停」。
// 宿主与开局流程见 `tests/native-host.mjs`（真正启动 native 客户端 + 可派发的虚拟定时器）。
// 战斗时钟的读数取自状态条里的「剩余时间」（`updateHud` 每 0.2 秒模拟时间刷新一次，可见与后台都会刷新）——
// 不用自动存档读：存档只在 `saveTime>2` 时写，读数天然滞后。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHost,startBattle} from './native-host.mjs';

const remaining=host=>{const m=/剩余时间<\/small><b>(\d+)/.exec(host.elements.get('native-status').innerHTML);return m?Number(m[1]):null;};

test('切走页面不再暂停：隐藏时后台按真实时间补帧，回到前台恢复绘制',async()=>{
 const host=createHost();
 await startBattle(host);
 host.tick(70);
 const before=remaining(host),draws=host.drawCalls;
 assert.ok(before>0,'状态条应当显示本波剩余时间');
 // 切走：rAF 停摆，只剩被节流的定时器
 host.setHidden(true);
 host.advance(5000);                               // 真实时间过了 5 秒
 host.fireTimers();                                // 后台驱动唤醒
 const spent=before-remaining(host);
 assert.ok(spent>=4&&spent<=6,`后台应当按真实时间推进约 5 秒（推进了 ${spent} 秒）`);
 assert.equal(host.drawCalls,draws,'后台不重绘画布（省电，也不做没人看的绘制）');
 // 回到前台：rAF 恢复，立刻补绘制并继续推进
 host.setHidden(false);
 host.tick(1);
 assert.ok(host.drawCalls>draws,'回到前台恢复绘制');
 const resumed=remaining(host);
 host.tick(30);
 assert.ok(remaining(host)<resumed,'回到前台后战斗继续推进');
});

test('手动暂停仍然有效：暂停状态下切走页面，后台也不推进模拟',async()=>{
 const host=createHost();
 await startBattle(host);
 host.tick(70);
 assert.match(host.elements.get('app').innerHTML,/data-act="pause"[^>]*>暂停</,'未暂停时按钮是「暂停」');
 await host.dispatch('pause');                     // 玩家自己按的暂停
 assert.match(host.elements.get('app').innerHTML,/data-act="pause"[^>]*>继续</,'暂停后按钮变成「继续」');
 const pausedAt=remaining(host);
 host.setHidden(true);
 host.advance(5000);host.fireTimers();
 assert.equal(remaining(host),pausedAt,'暂停时后台不补帧');
 host.setHidden(false);
 host.tick(30);
 assert.equal(remaining(host),pausedAt,'回到前台仍然暂停（等玩家继续）');
});
