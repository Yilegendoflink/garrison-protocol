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
- **整备区上限只认 `handLength()`**：未上场干员 ＋ 未装备装备 ＋ 未放置的召唤物卡合计 10 格（`HAND_LIMIT`，`protocol.js`）。干员／策略效果发放的卡牌可以临时超出，但 `handFull()` 为真时禁止购入干员和装备，也禁止收回场上召唤卡，必须先用部署、出售、装备消耗或销毁清出空余；「第三张同名卡」的三合一不占新格，仍然放行。UI 的计数、拖回提示和商店提示都走 `handFull()`，不要再写死 10。
- **召唤物卡占格口径（已确认，别当 bug 修）**：只在「未放置」时占一格，放到场上后不占。因此满手时场上召唤卡收不回来，只能等持有者离场或先清其他格——这是用户确认过的玩法设计，不要为了「流畅」改成「场上召唤卡也占格」或给收回开例外。**跨回合留在原位**：进入新回合只做「按持有者／类型对账」（`syncSummonCards()`，不要传 `resetPlaced:true`），放置位置保留到持有者撤走（卡片被移除）或玩家主动 `withdrawSummon` 为止；备战期画的是整备区布置 + 已放置的召唤物卡，**不画上一场战斗残留的召唤物实体**（用 `protocol.battleBoardVisible(phase)` 判定，只有 battle/finished/intermission 沿用战斗棋盘）。已放置的召唤物卡占格，别的干员不能压上去（`canDeploy` 里查 `summonCards`；持有者本人可以，因为它移动时会清掉自己的召唤物位置）。
- **干员档案层级**：`.native-dossier` 是覆盖在棋盘上的浮层（PC 上 z-index 8），PC 下 `max-height:calc(100vh - 556px)` 让它截止在整备区上方并自身滚动。档案高度若放到全视口，会把下方整备区卡片整片吃掉，卡片点不中、装备也拖不上；反过来把整备区抬到档案之上，档案底部的「撤回整备区／出售」按钮又会点不到。两边都要能用，只能靠限高错开。
- **难度选择的海猫模式**：`mode_cat_all` 只是 lobby 下拉里的选项，底层仍跑 `mode_single_normal`（`state.draft.cat` → `s.cat`）。它把 `s.funds` 顶到 `Number.MAX_SAFE_INTEGER`，让 `spend`/`upgrade`/`refresh` 的原判定全部通过；界面上一律用 `fundsMarkup()` 显示彩色 `ALL`，不要直接印 `s.funds`。
- **敌方小怪体型**：解压缩出来的碎片（器皿／镜／茶器／矛头一类，即 `enemyBehavior.hitCountHp` 的敌人）画面上按 `e.spriteScale`（0.6）缩小，免得和精英怪一样大。缩放必须在生成时定死：`hitCountHp` 是运行时状态，余烬／再生形态也会置真，不能拿它当缩放依据。
- **次数血条不吃战斗缩放**：`combatScale` 只作用于常规血量，`hitCountHp` 敌人的生命值就是「需要击倒的伤害次数」，生成时取原表数值、不乘倍率，否则 0.7 倍会把「2 次」变成 1.4。
- **手机端盟约面板**：横屏手机 UI（`html.native-landscape-ui`）左侧的盟约竖列是 flex column，卡片必须写 `flex:0 0 auto`（`native.css` 该段内的 `.native-bonds button`）：盟约一多时靠面板自身的 `overflow-y:auto` 整体上下滚动。漏掉它 flex 会把 20 多条盟约压进可视高度，卡片从 41px 挤到 34px 以下、名字和层数叠在一格里（真浏览器复测：`node scripts/mobile-bonds-browser.mjs`，静态口径回归：`tests/native-mobile-layout.test.mjs`）。窄屏竖排的横向条（`@media(max-width:600px)`）仍靠 `min-width:80px` 保底宽度横向滚动，不要改成压扁。

## 敌人能力口径

- **死亡类能力只有一个入口**：死亡爆炸、死亡区域、解压缩都走 `native-effects` 的 `commitExit` → `battle.onEnemyDeath`，不要再挂在干员攻击路径上（那样被持续伤害击杀就漏触发）。生成的敌人先入队（`queueEnemySpawn`），在敌人状态结算后与战斗结束判定前各刷一次，别在遍历 `s.enemies` 时直接 push。
- **反推原表字段**：`DeadSpawn.*`、`Revive[Trigger].*`、`Atkup.atk`／`AtkUp.atk`、`shield.dynamic` 等一律从 `talentBlackboard` 取，取不到就不给这个能力，并在 `enemy-behavior-overrides.json` 里显式关闭。`aura.*` 前缀是**自身条件判定**，不是发给周围敌人的光环（真光环是 `defup.*`）。
- **放开随机池要走流程**：复杂敌人先在 `enemy-behavior-overrides.json` 里 `randomPoolEligible:false`，补完专属实现并写了定向测试后再逐条放开；`filterRandomPoolTable` 会把不合格的敌人从词条池里剔掉，没放开就等于没上场。
- **具名卡池要在 `native-session.js` 显式建表**：`drawFromPool` 只认池名，而原表（`pool_chess_glady`、`pool_char_pinus`、`pool_equip_*`）只给名字不给成员，不建表就等于按商店规则从整池抽。成员只能从效果文案或装备字段推：`members`（可带权重）、`bond`（该盟约的装备）、`any`（文案没限定，等于任意）；推不出来的宁可不做也不要编，并在表里注明依据。
- **隐匿只有一条判定**：`invisible` = 状态表（`invisible`/`camouflage`）或形态自带的 `formInvisible`，`revealed` = 反隐时间窗（`revealUntil`，每帧由 `syncReveals` 收敛）。被阻挡（`e.block!=null`）视为脱离隐匿。改索敌时三处一起改：`targets()`、`autoSkillWouldHit()`、敌方 AI 的远程选目标；反隐由 `revealEnemy` 续期，不要写回永久置位的 `e.revealed=true`。敌方隐匿技能只有两条实现路径：`InvisibleCombat` 挂在 `resolveEnemyStrike`（攻击显形），清明 `InvisibleShield` 走独立计时的 `tickEnemyInvisibleShield`（跟攻击解耦）；技能文案里带「技能结束时」的是条件式发放（忍冬 S3 迷彩），通用「开技即获得」分支必须跳过它。
- **卫戍效果（干员特质）的口径已定，照 `GARRISON_EFFECT_AUDIT.md` 走**：触发时间点 = 原表 `eventType`（`SERVER_GAIN` 获得时 / `SERVER_PREP_START` 进入休整期 / `SERVER_PREP_FIN` 休整期结束 / `SERVER_REFRESH_SHOP` 刷新 / `SERVER_CHESS_SOLD` 出售 / `SERVER_PRICE` 价格 / `IN_BATTLE` 作战能力）。多盟约「每叠加 N 层」= **每个盟约分别 ⌊层数/divide_num⌋ 后相加**；「核心盟约每叠加 N 层」= **8 个核心盟约的层数合计**（与该干员自身所属盟约无关）；`bond_self` = 每个已激活盟约各 +N；`bond_actived_maxstack` = 只取已激活中层数最多的那一个、并列随机；击倒计数**不含我方干员**；「每场作战至多 N 层」**按每波**重置（计数箱挂 `battle.garrisonCounters`，不要再写回 `u.counters`）。送特质（`give_garrison_to_*`）必须按 `check_bond_id` 校验，不匹配不发，每波开战前清空 `extraGarrisonIds` 并与目标已有的 garrison 去重。**卫戍文本必须带触发时机前缀**：走 `protocol.garrisonText`（有 `<获得时>` 这类原表标签就用标签，没有的按 `eventType`／能力键补），干员档案用 `<b class="native-garrison-when">` 渲染——直接 `plain(garrisonDesc)` 会把时机标签当富文本吃掉。**原表富文本统一走 `protocol.richText`**：`<@ba.vup>`／`<$ba.stun>`／`<@autochess.gray>`／`</>` 这类样式标签丢掉，`<铜灯盘>`／`<替身>`／`<寻呼模块>`／`<炎>` 这类**内容**标签里的文字必须保留（原表还有 `<在场<@autochess.dgreen>6</>名不同【炎】干员>` 这种嵌套，按尖括号配对扫描）。展示路径都用它：`native-play` 的 `plain`、`native-skill-text` 的 `plainText`、`native-wave-editor` 的敌人描述、`build-native` 烘进 `enemyIndex` 的 `desc`；`replace(/<[^>]+>/g,'')` 只允许留在解析逻辑里（行为推断、文案取值、特质转发判定）。新增作战能力键必须同时更新 `GARRISON_EFFECT_AUDIT.md` 与 `tests/native-garrison-effects.test.mjs` 的键登记表（那里有一条门禁测试，未登记直接挂）。

资料：`data/prts/` 参考底库；`data/normalized/` 规范化；`data/modes/alliance-lower/` 本期包（历史提交 `86da4cfa…`）。客户端规模仍是 112 可见预设、266 养成状态、23 盟约、40 策略、215 敌人引用、376 头像。

无第三方 JS。开发 Node.js 22+；Pages 用 24。`npm run build` 只编译。`npm test` 跑 `tests/*.test.mjs`。

## 红线

- **资料已采集 ≠ 机制已实现 ≠ 原作对照通过。** 适配层有注册、有处理器，只说明入口在，不说明数值和时序已对照。
- **四个账本分开：** `funds`（整备资金）≠ `cost`（战斗部署费用，本项目开局 20）≠ 诗怀雅金币 ≠ 技力 SP。
- 战斗规则走 `native-effects` 结算入口（伤害/治疗/回复/流失/退场，带 `eventId` / `parentEventId` / `attackId`）。不要为了特效去改命中结果。
- 能力状态只能由真实场景改 `operator-capability-status.json`；构建脚本不得批量升 `verified`。
- 商店抽取顺序是**先掷阶级再从该阶级库存里抽**（`native-session.js` 的 `SHOP_TIER_ROLL`：最高阶30% / 次高阶40% / 更低阶合计30%，档内按剩余库存加权、同店无放回）；掷中的阶级没库存才回落到整池随机。百分比是项目规定值，不要写成原作权重，也不要改回「整池直接按库存抽」。
- 波次已改为词条难度预算自建池，不再追求关卡模板逐波复刻。
- 推 `main` 会发布 Pages 且不跑测试。功能分支验收后再合并。

## 文档怎么读

**当前事实：** 本页、`README.md`、`OPERATOR_ADAPTERS.md`、`OPERATOR_COMPLETION_PLAN.md`、`COST_INTERACTIONS_AUDIT.md`、`docs/ENEMY_BEHAVIOR_DEVELOPMENT.md`、`PUBLISHING.md`、`COMBAT_RULES.md`。

**切片验收（当时为真，不是全局完成）：** `PUBLIC_CAPABILITIES_ACCEPTANCE.md`、`COMBAT_ACCEPTANCE.md`、`FX_EFFECTS.md`、`BRANCH_RULES.md`。

**历史：** `NATIVE_RULES_PROGRESS.md`、`S4_S6_PROGRESS.md`、`S0_S3_DELIVERY.md`、`CODEX_HANDOFF.md` 旧段、`COMBAT_SYSTEM.md`（legacy `combat.js`）、`本地运行说明.md` 中「开始独立模拟」一类旧文案。

S0–S6 工程已铺开；S7 是固定种子对照，S8–S10 同盟/创作工具/精修未开始。
