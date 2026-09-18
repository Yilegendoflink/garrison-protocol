# Agent 规则：卫戍协议盟约下半

更新：2026-09-16。下次改代码前先读本页。`NATIVE_RULES_PROGRESS.md`、`S4_S6_PROGRESS.md`、`CODEX_HANDOFF.md` 是历史交接，其中「主入口仍是 35 人演示」「还没建仓库」已经过时。

## 项目是什么

非官方同人网页，还原国服《卫戍协议：盟约 · 下半期》（锚点 2026-03-14 / 03-27）。公开仓库 [Yilegendoflink/garrison-protocol](https://github.com/Yilegendoflink/garrison-protocol)，Pages 随 `main` 自动构建部署，**工作流不跑测试**。

最终 Boss 阶段按约定是无限生命木桩（150 秒、可手动结束、只统计本阶段伤害）。其余干员、敌人、盟约、策略仍要求跟下半期一致。官方账号不是运行依赖。

## 2026-09-16 事实

当前 `main` 约 `93b8e4a`（商店刷新阶级概率）。主入口是 native 客户端，已接历史下半期数据，不是 35 人 legacy 演示。

| 标志 | 值 | 含义 |
| --- | --- | --- |
| `s6.dataCatalogComplete` | true | 资料目录齐 |
| `s6.playableParityComplete` | **false** | 不是原作可玩对等 |
| `s6.acceptedScopeComplete` | **true** | 用户约定的 S06 木桩范围旗标；不等于 112 人完整还原 |
| `needsSpecialHandler` | 全 0 | 112 名都进了 `descriptor-v1` 适配层 |
| 能力状态 `verified` | 约 21 个能力格 | 抽样场景，不是整名干员验收 |

`npm run release:check` 仍会因 `s4`/`s5` 的 pending 失败。不要用「acceptedScopeComplete=true」宣布发布验收完成。

工作区未提交：`dist/native-battle.js`、`native-economy.js`、`native-effects.js`、`native-session.js` 与 `tests/native-bonds.test.mjs`，正在补战斗盟约效果（炎佑、谢拉格寒风、阿戈尔吞噬/复活、拉特兰弹药、坚守分摊等）。未提交 ≠ 已合并到 Pages。

## 工程分层

当前可玩链路在 `dist/native-*.js`。`dist/engine.js` / `combat.js` / `app.js` 是旧演示层，只给 `legacy.html`。

- `native-play.js` / `native-lobby.js` / `native.css`：大厅、战前准备、对局 UI、两段式部署、干员档案、本波头像预览
- `native-session.js`：商店、装备、阶段、存档
- `native-economy.js` / `garrison.js` / `strategy.js`：整备资金、运营特质、策略
- `native-battle.js` / `native-combat.js` / `native-effects.js` / `native-operator-effects.js`：战斗循环、结算入口、逐名适配
- `native-sp.js`：技力（脱手清空、持续倒流、弹药格子）
- `native-waves.js` / `native-wave-random.js` / `native-wave-editor.js`：词条预算抽怪与编制台
- `native-branches.js`：职业分支基础层
- `native-fx.js`：**只画特效**。`s.events` 会裁剪过期，禁止当规则执行依据
- `scripts/build-native.mjs`：把固定历史库编进客户端

## 对局 UI 交互约定（`native-play.js`）

- **整备区装备拖放**：`pointerdown` 在 `[data-act="item"]` 上起拖（`drag.kind==='item'`、`from:'hand'`），落点由 `overUnitCard` 找干员卡；点击流程（先点装备再点干员）与拖放共用 `equipItemOnUnit(uid,itemUid)`，槽位满时它弹摧毁选择（`data-act="replace"` + `data-slot`）。
- **拖到商店出售**：干员卡拖到 `#native-supply-shop` 上松手即出售，`overShop` 判定，`dragFeedback` 给商店加 `drop-target`。
- **新增拖放分支必须清 `drag`**：`pointerup` 的 `d.moved` 分支里提前 `return` 的分支要显式 `drag=null; dragFeedback();`，否则下一次拖放会复用上一次的 `drag.uid`。
- **干员档案层级**：`.native-dossier`（含 body）在 PC 上 `pointer-events:none`，只当滚动容器用（滚轮由 `root` 的 wheel 监听 + `scrollerAtPoint` 接管）。一旦给它恢复 `auto`，它会盖住下方整备区卡片，卡片点不中、装备也拖不上去。

资料：`data/prts/` 参考底库；`data/normalized/` 规范化；`data/modes/alliance-lower/` 本期包（历史提交 `86da4cfa…`）。客户端规模仍是 112 可见预设、266 养成状态、23 盟约、40 策略、215 敌人引用、376 头像。

无第三方 JS。开发 Node.js 22+；Pages 用 24。`npm run build` 只编译。`npm test` 跑 `tests/*.test.mjs`。

## 红线

- **资料已采集 ≠ 机制已实现 ≠ 原作对照通过。** 适配层有注册、有处理器，只说明入口在，不说明数值和时序已对照。
- **四个账本分开：** `funds`（整备资金）≠ `cost`（战斗部署费用，本项目开局 20）≠ 诗怀雅金币 ≠ 技力 SP。
- 战斗规则走 `native-effects` 结算入口（伤害/治疗/回复/流失/退场，带 `eventId` / `parentEventId` / `attackId`）。不要为了特效去改命中结果。
- 能力状态只能由真实场景改 `operator-capability-status.json`；构建脚本不得批量升 `verified`。
- 商店仍是候选受限后的等权抽取，不要写成原作权重。
- 波次已改为词条难度预算自建池，不再追求关卡模板逐波复刻。
- 推 `main` 会发布 Pages 且不跑测试。功能分支验收后再合并。

## 文档怎么读

**当前事实：** 本页、`README.md`、`OPERATOR_ADAPTERS.md`、`OPERATOR_COMPLETION_PLAN.md`、`COST_INTERACTIONS_AUDIT.md`、`docs/ENEMY_BEHAVIOR_DEVELOPMENT.md`、`PUBLISHING.md`、`COMBAT_RULES.md`。

**切片验收（当时为真，不是全局完成）：** `PUBLIC_CAPABILITIES_ACCEPTANCE.md`、`COMBAT_ACCEPTANCE.md`、`FX_EFFECTS.md`、`BRANCH_RULES.md`。

**历史：** `NATIVE_RULES_PROGRESS.md`、`S4_S6_PROGRESS.md`、`S0_S3_DELIVERY.md`、`CODEX_HANDOFF.md` 旧段、`COMBAT_SYSTEM.md`（legacy `combat.js`）、`本地运行说明.md` 中「开始独立模拟」一类旧文案。

S0–S6 工程已铺开；S7 是固定种子对照，S8–S10 同盟/创作工具/精修未开始。
