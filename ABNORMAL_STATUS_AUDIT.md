# 异常状态缺口对照（AUDIT）

对照对象：[PRTS · 异常效果](https://prts.wiki/w/%E5%BC%82%E5%B8%B8%E6%95%88%E6%9E%9C)（客户端 2.7.61：43 个异常效果 + 2 个占位；2 个异常组合；9 种抗性）与 [CH-4 异常状态](https://prts.wiki/w/CH-4_%E5%BC%82%E5%B8%B8%E7%8A%B6%E6%80%81) 的术语口径。

本项目实现盘点范围为 `dist/status.js`（判定层）、`dist/native-battle.js`（单位/敌人构造与循环）、`dist/native-effects.js` 与 `dist/native-operator-effects.js`（结算入口与逐名适配）、`dist/native-fx.js`（图标/着色）。

图例：✅ 机制与免疫都闭合 ｜ 🟡 部分实现（有机制缺免疫、或语义与原文有差） ｜ ❌ 未实现

## 一、异常效果（AbnormalFlag）

| # | 内部ID | 站内称呼 | 状态 | 现状与缺口 |
| --- | --- | --- | --- | --- |
| 0 | STUNNED | 晕眩 | ✅ | `stun` 全项封锁 + `stunImmune`，敌我都接线 |
| 1 | SP_RECOVER_STOPPED | 阻回 | 🟡 | 只有 `spLock`/技能期间的散装逻辑（`native-sp.js`），没有当作异常效果统一判定；「阻止任何非强制技力增加」未集中实现 |
| 2 | TARGET_FREE | 不可选中 | 🟡 | `untargetable` 字段可用，但只由敌人行为配置写入；未做成状态、未归入无法选择类检查 |
| 3 | BLOCK_FREE | 不可阻挡 | 🟡 | `unblockable` 是敌人行为字段，不是可运行时施加的异常；`permissions().beBlocked` 只认沉睡/浮空 |
| 4 | HIDDEN | 隐藏 | 🟡 | 仅 `e.hidden` 表示「不参与索敌」，缺「未绑定选择器的能力不触发」这一完整语义 |
| 5 | INVINCIBLE | 无敌 | 🟡 | 伤害/anchor 判定可用；未处理「元素值变为0」「不触发能力」，也没归入无法选择类 |
| 6 | UNDEADABLE | 不死 | 🟡 | 有 `lives`/`reviveActor` 等复活链路，但没有不死标志的负血规则，也没有通用接线 |
| 7 | HEAL_FREE | 禁疗 | 🟡 | 有 `healable`/`healingBlocked`，但不成体系：不能作为异常被施加/免疫，治疗选取检查不完整 |
| 8 | UNBALANCE_IMMUNE | 失衡免疫 | ❌ | 位移链路（`moveActor`/`teleportActor`）既不查失衡免疫，也没有重量判定 |
| 9 | INVISIBLE | 隐匿 | ✅ | `invisible` + `revealed`，索敌与反隐已接 |
| 10 | ~~占位~~ | × | — | 原作已弃用，忽略 |
| 11 | DISARMED | 缴械 | 🟡 | `disarm` 只挡攻击；原文「持有无敌时此异常无效」未实现；干员侧无 `disarmImmune` 之类接线 |
| 12 | SILENCED | 沉默 | ❌ | **缺口最明确**：`CONTROL.silence = []`（`status.js:2`），施加沉默不会禁止技能；`permissions().skill` 只被晕眩/冻结/沉睡/浮空/恐惧/战栗/麻痹影响 |
| 13 | UNMOVABLE | 束缚 | 🟡 | `root` 挡移动、`moveActor` 会查；但没有「自缚」变体，且和「停顿」共用减速链路容易混淆 |
| 14 | ~~占位~~ | × | — | 原作已弃用，忽略 |
| 15 | ALLY_TARGET_FREE | 孤立 | 🟡 | 只有召唤物构造里的 `isolated` 字段；不能作为状态施加，同阵营选取检查不完整 |
| 16 | FROZEN | 冻结 | ✅ | 寒冷二段升级、法抗 -15、封锁全套；**方向差异**见下节 |
| 17 | CAMOUFLAGE | 迷彩 | 🟡 | 当作 `invisible` 的孪生处理；缺「因隐匿免疫失效但仍可被检测」的细则 |
| 18 | FORCE_DISARMED | 强制缴械 | ❌ | 无常量。`char_1045_svash2`「强行关闭技能并缴械」靠技能期间截断实现，不是异常效果 |
| 19 | STUNNED_NO_AMPLIFY_DAMAGE | 无法行动 | ❌ | 无常量。沉睡已经有「不增伤」的效果，但无法行动是独立 flag |
| 20 | DISABLE_COMBAT | 禁用近战 | ❌ | 无。敌人「无法阻挡攻击／无法被阻挡／不自动解除阻挡」的组合语义没有对应实现 |
| 21 | ELEMENT_FREE_ALL | 元素免疫 | 🟡 | 有 `elementalImmune` 标志让爆条归零；「元素值不会损失」未完整实现 |
| 22 | UNMOVABLE_PRIVATE | 自缚 | ❌ | 无常量，也与束缚不做区分 |
| 23 | COLD | 寒冷 | ✅ | 攻速 -30、二次成冻结 |
| 24 | SKILL_NOT_ACTIVATABLE | 静默 | ❌ | 无常量；与沉默同效但不被识别为沉默，本项目两者都没有 |
| 25 | LEVITATE | 浮空 | 🟡 | 有 `levitate` + `levitateImmune`，也带不可阻挡/缴械；缺浮空 Buff 的重量 >3 时间减半、缚地对冲、视为飞行单位 |
| 26 | DURANCE | 禁锢 | ❌ | 无。保全派驻语义，本模式无内容引用，可低优先级 |
| 27 | NOT_WITHDRAWABLE | 无法撤退 | ❌ | 无。整备期撤回是 UI 行为，没有战斗内「不可手动撤退」规则 |
| 28 | OUT_OF_GROUND | 离地 | ❌ | 无。用于中断套索式弹道 |
| 29 | SP_MODIFY_STOPPED | 技力封闭 | ❌ | 无。与非强制 modifier 的技力修改隔离未实现 |
| 30 | ANTI_STATUS_RESISTABLE | 状态免疫 | ❌ | 无。无法阻止可抵抗 Buff 施加 |
| 31 | DISARMED_COMBAT | 战栗 | 🟡 | `tremble` 在状态层按「全封锁」处理，比原文（仅 COMBAT 状态机下的普攻）重；且敌军免疫映射写的是 `a.palsyImmune`。本项目 10 条干员文本用到战栗 |
| 32 | TOWER_TARGET_FREE | 塔不可选中 | ❌ | 无。本项目没有召唤塔类单位，暂可忽略 |
| 33 | FEARED | 恐惧 | 🟡 | 只做「原地不动」，没有恐惧控制器（沿路径逃离）逻辑 |
| 34 | SKILL_ACTIVABLE_IN_ABNORMAL | 技能强启 | ❌ | 无 |
| 35 | MOTION_TARGET_FREE | 对地规避 | ❌ | 无。数据有字段，代码不消费 |
| 36 | FORCE_LEVITATE | 浮空强化 | ❌ | 无 |
| 37 | BUFF_ADD_CAN_BE_CANCELED_IF_DEFENSE | BUFF可抵挡 | ❌ | 无 |
| 38 | DEFENSE_BUFF_ADD_IF_CANCELABLE_BUFF | BUFF抵挡 | ❌ | 无 |
| 39 | PALSY | 麻痹 | ❌ | **数据已接、机制为空**：干员与敌人都有 `palsyImmune`，但没有任何技能施加麻痹，也没有「普攻瞬间插 0.5s 麻痹震颤打断」的机制。本项目 9 条干员文本用到麻痹 |
| 40 | PALSYING | 麻痹震颤 | ❌ | 无。`native-fx.js` 也不画图标 |
| 41 | ATTRACTED | 诱导 | ❌ | 无。有 `attractImmune` 字段与 `attract` 状态名，但没有沿路径待机地块的移动逻辑 |
| 42 | FEARED_PRIVATE | 自惧 | ❌ | 无 |
| 43 | DOZE | 小睡 | ❌ | 无。需要无敌 + 不可阻挡 + 缴械 + 隐藏免疫 + 对友方隐藏的组合 |
| 44 | TELEPORTED | 被传送 | 🟡 | `teleportActor` 存在且被多技能调用，但**没有任何传送免疫检查**；`teleportImmune` 只在数据目录里躺着 |
| 45 | GROUND_BOUND | 缚地 | ❌ | 无。`groundBoundImmune` 只在数据目录里 |

## 二、异常组合（AbnormalCombo）

| 组合 | 站内称呼 | 状态 | 缺口 |
| --- | --- | --- | --- |
| SLEEPING | 沉睡 | 🟡 | `sleep` 实现了无法行动 + 不可阻挡 + 沉睡期间不被攻击；缺「无敌」项（沉睡单位仍会被元素/真伤类路径擦到），且 `permissions().sleeping` 只用于索敌，不是组合免疫 |
| SHELTERING | 闭锁 | ❌ | 无（强制缴械 + 无敌 + 不可阻挡） |

现有实现把「组合」直接写成单个 kind，因此**组合免疫与单效果免疫的区别**没有建模：原文明确「持有组合不受针对单一效果的免疫与无视影响」，本项目做不到这个区分。

## 三、异常免疫 / 抗性（9 种抗性）

数据侧（`catalog.js` / `runtime-data.js`）齐备 11 个布尔抗性：`stunImmune` `silenceImmune` `sleepImmune` `frozenImmune` `levitateImmune` `disarmedCombatImmune` `fearedImmune` `palsyImmune` `attractImmune` `teleportImmune` `groundBoundImmune`。

接线侧只有 9 个进了 `immunities`，且映射有两处错位：

```js
// native-battle.js:22（干员）
immunities:{stun:a.stunImmune,silence:a.silenceImmune,frozen:a.frozenImmune,sleep:a.sleepImmune,
 levitate:a.levitateImmune,fear:a.fearedImmune,terror:a.fearedImmune,tremble:a.palsyImmune,root:a.attractImmune}
// native-battle.js:270（敌人）
immunities:{...,fear:a.fearedImmune,terror:a.terrorImmune,tremble:a.palsyImmune,root:a.attractImmune}
```

1. **战栗抗性与恐惧抗性混用**：`tremble` 查 `palsyImmune`。但战栗（DISARMED_COMBAT）的原文抗性变量是 `disarmedCombatImmune`，`palsyImmune` 属于麻痹。干员侧 `disarmedCombatImmune` 根本没进 `immunities`。
2. **terror 的免疫源两侧不一致，且敌人侧读的是不存在的字段**：干员用 `fearedImmune`，敌人写 `a.terrorImmune`，而 `data` 里**根本没有 `terrorImmune` 这个字段**（只有 `fearedImmune`）。所以 `a.terrorImmune` 恒为 `undefined`，敌人身上的恐惧免疫对 terror 完全失效。原文没有独立恐怖抗性变量，两侧应统一到 `fearedImmune`。
3. 未接线的 4 个：`disarmedCombatImmune`（只出现在数据文件里，代码无消费方）；`teleportImmune`、`groundBoundImmune` 只在数据目录里躺着；`attractImmune` 接到了 `root`（束缚）——**这是错的**，诱导免疫不该免疫束缚。束缚对应的是 `unmovable`，数据里没有这个布尔，应当来自敌人的异常免疫配置。

## 四、可抵抗状态（抵抗）

| 项 | 状态 | 缺口 |
| --- | --- | --- |
| 可抵抗状态生效时间倍率 ×0.5 | 🟡 | `applyStatus` 支持 `statusResistance`（`status.js:6`），且 `one_minus_status_resistance` 已被干员天赋接入；但没有独立的「抵抗」状态，抵抗效果只能一次性写进单位字段 |
| 定时触发效果在抵抗下更频繁触发 | ❌ | 原文「每秒受伤」在抵抗下变「每 0.5 秒受伤」。本项目 dot/zone 的 `interval` 与状态时长互不相干，做不到 |
| 麻痹等状态每 5 秒流失 1 层 | ❌ | 麻痹本身未实现 |
| 固定间隔不受抵抗影响 | ❌ | 没有 `固定` 标记的概念 |

同时注意：本项目绝大多数 `applyStatus` 调用点显式传 `resistible:false`（技能直接施加的状态大多如此），所以即便单位有 `statusResistance`，实际生效的主要只有敌人打干员的那几条路径。

## 五、表现层与账本缺口

- **状态图标**：`native-fx.js:477` 只画 `stun/sleep/silence/fear/terror/tremble/root`；`cold/frozen` 走冰色叠加。`fragile`、`attackDown`、`defDown`、`resDown`、`attackSpeedDown`、`sluggish`、`disarm`、`levitate`、`burn`、`resist` 都没有头像角标，玩家看不到自己被上了什么。
- **停顿（sluggish）是自定义概念**：原作对应「移动速度降低」的 Buff（如 80%），本项目实现为移动速度 ×0.2（`native-combat.js:237`），且**不参与抵抗、不受免疫**。这是本模式 37 条文本涉及的高频状态，口径需要单独确认。
- **`wakeOnHit` 是死代码**：`status.js:20` 依赖 `target.wakeOnDamage`，全仓库没有任何地方设置该字段，所以「沉睡被攻击唤醒」这类规则不会触发（如果原作有此规则，需要显式接线）。
- **`statusAttributeChanges` 漏项**：`attackSpeedDown` 不进 `statusAttributeChanges`，只能靠逐名代码直接改 `attackSpeedMod`（`native-operator-effects.js:337`），属于旁路实现。
- **状态时长语义**：`statusResistance` 只乘一次时长，没有「同名取最高」「最终乘算」等原作细则。

## 六、按优先级的补齐建议

**P0（本模式内容确实需要，且现在语义是错的）**

1. `CONTROL.silence` 补 `'skill'`，让沉默真正阻止技能；同时给静默（SKILL_NOT_ACTIVATABLE）留常量位。
2. 修正 `immunities` 映射：`tremble → disarmedCombatImmune`、`terror → fearedImmune`（两侧统一）、`root` 不再吃 `attractImmune`，另起束缚免疫字段。
3. 实现战栗的真实语义（仅 COMBAT 状态机下阻止普攻），而不是当作全封锁。
4. `teleportActor` / `moveActor` 增加 `teleportImmune` / 失衡免疫与重量判定。
5. 实现麻痹（PALSY）+ 麻痹震颤（PALSYING）：普攻瞬间插 0.5s 打断；数据已经有 `palsyImmune` 等着接。

**P1（本模式内容用到，属于表现或细则）**

6. 状态图标补全（fragile / 各类属性下降 / sluggish / disarm / levitate）。
7. 明确停顿口径：是否参与抵抗、是否吃免疫，写进 COMBAT_RULES。
8. 隐匿免疫细化：迷彩因隐匿免疫失效但仍可被检测。
9. 免疫字段补 `disarmedCombatImmune`，并让 `statusAttributeChanges` 收编 `attackSpeedDown`。

**P2（本模式内容没有引用，可延后）**

10. 诱导（ATTRACTED）、恐惧控制器、离地、禁锢、无法撤退、塔不可选中、BUFF 抵挡系列、浮空强化、自缚/自惧、小睡、闭锁、元素免疫细则、状态免疫与技能强启。

> 说明：P2 的判断依据是「本模式 112 名干员的技能/天赋文本与 215 个敌人引用没有出现这些词」。一旦引入新干员或新敌人，需要重新扫描文本再定档。
