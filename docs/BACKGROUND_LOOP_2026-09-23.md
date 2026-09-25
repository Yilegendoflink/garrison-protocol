# 页面切走时后台继续运行（用户 2026-09-23 口径）

口径原文：「能否实现网页切走时后台继续运行而不是暂停」——**能**，现在切走标签页／切到别的窗口时战斗继续推进。

## 一、改前的行为

`native-play.js` 的 `visibilitychange` 里直接 `state.paused=true`，等于「一切走就自动暂停」；
即使不暂停也跑不动——隐藏标签页里 `requestAnimationFrame` 完全停摆，而帧循环只有这一条驱动
（`frame()` 里 `dt=Math.min(.15,(now-last)/1000)`，即使 rAF 偶尔醒一次也最多补 0.15 秒）。

## 二、现在的实现（只有一份循环）

- `document.addEventListener('visibilitychange')`：**隐藏时不再暂停**，只写 `expiresAt`（暂离 24 小时的安全网）、
  `save()`，然后 `scheduleBackground()`；回到前台 `cancelBackground()`，把 `last` 对到当前时刻、
  把欠账 `acc` 截断成一帧，再补一次 `updateHud()+draw()`。
- `scheduleBackground()` / `backgroundWake()`：每 `BG_WAKE_MS`(250ms) 唤醒一次，按
  `performance.now()` 的**真实差值**补帧（时间从 `last` 累计，不假设「一帧 = 1/30 秒」），
  唤醒结束后若仍是隐藏状态就继续排下一次。
- `advance(now,live)` 是**唯一**的推进函数，可见帧（`frame()` → `live=true`）与后台帧
  （`backgroundWake()` → `live=false`）共用，避免两条路径漂移：
  - `live=true`：保持原来的 `dt` 上限 0.15 秒（掉帧不瞬移）、跑满 `acc`、发声、`roundEndTick+draw()`；
  - `live=false`：`dt` 上限放宽到 `BG_MAX_GAP`(3600 秒，防「被冻结几小时后一口气跑掉几小时」)，
    单次唤醒给 `BG_BUDGET_MS`(200ms) 的**墙钟预算**，预算用完就把欠账留在 `acc` 里等下一次唤醒继续补，
    绝不长时间阻塞主线程。
- 后台**不做**的事：不重绘画布、不刷头部计数（`updateHud` 仍按每 0.2 秒模拟时间跑，因为它只写文本）、
  不发声——但 `playBattleEvents` 仍以静音调用，只为推进「已播放」游标，否则回到前台会补响一串音效。
- 后台**照旧**的事：自动存档（`saveTime>2` 秒模拟时间一次）、阶段变化时的 `save()+render()`、
  波次结束／整局结束的演出与报告（它们的定时器本来就是 `setTimeout`）。

## 三、浏览器限制（不可能比这更快）

- 隐藏标签页的定时器会被节流：Chrome 隐藏后最多约 **1 秒一次**；隐藏 5 分钟后进入
  intensive throttling，可能降到 **1 分钟一次**；个别情况（内存回收、移动端后台）整个标签页会被
  **冻结甚至丢弃**。冻结期间没有任何代码在跑，补不回来。
- 所以本实现保证的是「**醒着的时候按真实时间补齐**」，不保证「任何情况下都和真实时间一致」。
  被冻结期间落下的时间**不追**：回到前台后 `acc` 被截断成一帧，战斗从后台实际推进到的位置继续，
  不会出现进场瞬移或长时间卡顿。
- 页面被浏览器丢弃后只能靠自动存档恢复：`beforeunload`／隐藏时都会 `save()`，24 小时内可从大厅
  「继续模拟」，超时按现有口径重新开局。

## 四、与暂停、暂离的关系

- **手动暂停仍然有效**：暂停按钮（`data-act="pause"`）改的是 `state.paused`，后台补帧的循环同样看这个标志，
  暂停状态下切走不会偷偷推进（回归里有这一条）。
- 恢复旧存档时仍然 `state.paused=true`（等玩家点「继续」），这条没变。
- `expiresAt`（暂离 24 小时）与 `beforeunload` 的存档行为没变。

## 五、回归

`tests/native-background.test.mjs`（2 条）自带一个最小 DOM 宿主，**真的启动 `dist/native.bundle.js`**：
虚拟时钟 + 可派发的 `setTimeout` 队列模拟「切走」；战斗时钟的读数取自状态条里的「剩余时间」
（`updateHud` 在可见与后台都会刷新；自动存档只在 `saveTime>2` 时写，读数天然滞后，不能用来断言）。

- 大厅 → 战前准备 → 开局 → 开战后，`setHidden(true) + advance(5000) + fireTimers()` 应当推进约 5 秒，
  且期间 `drawCalls` 不增长；`setHidden(false) + tick()` 后恢复绘制并继续推进。
- 手动暂停后切走，前后读数必须完全一致。

宿主里把 `Date.now()` 固定住（开局种子取自它，否则每次跑到的地图都不一样）、并对画布上下文
补齐 `createLinearGradient`／`createRadialGradient` 等返回值。
