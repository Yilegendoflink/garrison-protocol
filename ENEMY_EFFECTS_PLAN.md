# 敌人特殊效果分批实现计划

目标：把 215 名敌人的专属能力按「同一类机制一批」的方式补齐，每批都能独立验收、独立回归。
本文档同时记录**第一批（持续伤害范围）的落地结果**和后续批次的范围与顺序。

配套文档：`docs/ENEMY_BEHAVIOR_DEVELOPMENT.md`（移动/索敌/停移口径）、`ABNORMAL_STATUS_AUDIT.md`（异常状态缺口）。

## 分批判据

敌人专属能力不做「按敌人逐个实现」，而是按**机制族**分批：同一族的敌人共用一条数据通道、一套结算入口、一组测试。分族依据是原表 `talentBlackboard` / `skills[].prefabKey` / 技能描述里出现的机制词，以及波次编辑器中的 7 个词条（`native-wave-fill.js` 的 `TRAINING_TYPES`）。

| 词条 | 含义 | 敌人池 |
| --- | --- | --- |
| SPECIAL | 特异 | 输出/承伤突出 |
| FLY | 飞行 | 空中单位 |
| TIMES | 频次 | 需一定攻击次数击破 |
| ELEMENT | 元素 | 造成元素损伤 |
| **DOT** | **持续** | **擅长持续伤害 ← 第一批** |
| INVISIBLE | 隐匿 | 拥有隐匿 |
| REFLECTION | 折射 | 拥有折射 |

## 第一批：持续伤害范围（DOT）— 已落地

### 范围

DOT 词条池共 12 名敌人（`data/modes/alliance-lower/default-wave-table.json` 的 `types.DOT`，与其他词条池无重叠）：

| 敌人 | 机制 | 实现方式 | 状态 |
| --- | --- | --- | --- |
| 集团军重型火炮 | 攻击会留下燃烧区域 | `attackZone`：命中点区域 半径1 / 3秒 / 每秒150 | ✅ |
| 萨卡兹枯朽战车（含尖端） | 数次攻击后释放污染秽蚀 | `attackZone`：半径2.2 / 10秒 / 每秒50 | ✅ |
| 深溟巢涌者（含富营养） | 持续对周围造成法术伤害和神经损伤；抵抗且免疫停顿 | `selfField`：跟随自身 半径1.6 / 每秒 5% 攻击力神经损伤 + `statusResistance` 0.5 | ✅ |
| 萨卡兹枯朽战士（含组长） | 被击倒时释放污染秽蚀 | `deathZone`：死亡点 半径2 / 8秒 / 每秒50 | ✅ |
| 逐腐兽（含疯狂） | 攻击使目标持续受到法术伤害，接受治疗时解除 | `bleeding`：命中挂 dot 100/150 × 10 秒，治疗解除 | ✅ |
| 假想敌：蚀裂 | 被击倒后向击倒者发射毒雾 | `deathZone`：落点跟随击杀者 半径0.8 / 8秒 / 每秒 15% 攻击力 | ✅ |
| 单核掠食者 / 异光体掠食者 | 原表无技能预制体、无天赋数值 | 无可实现内容 | ⛔ 数据缺失 |

### 实现要点

- **数据来自原表，不猜数值**：全部字段从 `talentBlackboard` / `skills[].blackboard` 按「模板名.字段」取值，取不到就让该敌人没有这个能力。`inferAttackZone` / `inferSelfField` / `inferDeathZone` / `inferToxicZone` / `inferBleeding` / `inferStatusResistance`（`dist/native-combat.js`）负责推导。
- **推导结果随构建落盘**：`scripts/build-native.mjs` 把推导结果写进 `enemyBehavior`（`behaviorInferred:true`），因为客户端快照里原表的 `skills` 表会被裁掉，运行时无法再推导。手动关掉某个能力就在 `enemy-behavior-overrides.json` 里写空值。
- **统一结算入口**：三型区域都走 `logicEffects` 的 `kind:'field'`，由 `NativeBattle.tickEnemyGroundZones()` 每 `interval` 秒结算一次；伤害与元素损伤走 `hurt()` 和 `applyElementDamage()`，因此护盾、闪避、元素爆条都按常规处理。
- **只对真正会受伤的我方生效**：死亡区域在半径内没有我方时不落地（避免远处被击倒也撒一片）；常驻光环跟随自身，敌人退场即消失。
- **可见**：`dist/native-fx.js` 的 `drawZones` 现在同时绘制 `kind:'field'`，使用独立的「危险」配色与脉冲提示，玩家能看见自己站在污染里。

### 验收

`tests/native-enemy-ground-zone.test.mjs`（6 例）+ `tests/native-fx-zones.test.mjs`（区域绘制）覆盖：原表数值对齐、开火留区、常驻光环与抵抗、死亡区域半径门槛、流血与治疗解除、毒雾不是光环、区域可见与配色。

## 后续批次（建议顺序）

顺序按「本模式出怪频率 × 机制影响面」排，前面的批次都只动敌方侧，风险可控。

### 第二批：元素损伤（ELEMENT）

元素损伤基础设施（`applyElementDamage` / 爆条 / 损伤抗性）已经存在，缺的是逐敌人的施加路径与「元素损伤抗性」的完整读取。重点核对：损伤类型映射（侵蚀/凋亡/灼燃/神经）、`epDamageResistance` / `epResistance` 是否真的参与结算、爆条后的效果是否按原表执行。

### 第三批：频次（TIMES）

「需一定攻击次数击破」：护盾层数型（`initialShield` 已有）+ 次数型（受击 N 次后才掉血/变形态）。**已落地**：次数护盾（`barriers`，含 `types` 过滤）、碎片与再生的「特殊生命值机制」、「解压缩」（受击次数血条的碎片小怪）、以及 `Revive[Trigger]` 的形态切换。细节、数值来源与遗留项见 `DECOMPRESS_ENEMY_PLAN.md`。

### 第四批：隐匿（INVISIBLE）+ 折射（REFLECTION）

隐匿已有 `initialInvisible` / 攻击后显形；需要补「隐匿免疫（反隐）」与迷彩细则（见 `ABNORMAL_STATUS_AUDIT.md`）。折射目前只读了 `refracting.magic_resistance`，需要补折射伤害分配与阻挡判定。

### 第五批：飞行（FLY）+ 特异（SPECIAL）剩余项

飞行本体可用；这一批主要是特异池里尚未覆盖的专属技能（召唤、分裂、变身、传送、复活、多阶段），它们目前被 `complexity==='complex'` 挡在随机池外，只出现在手工波次表。逐个敌人实现后再把它们从「固定波次」提升到随机池。

### 第六批：地图与环境交互

改变路线、修改地块、地图变化、可移动战术机库一类的地图实体。需要在战斗状态里引入地块级状态，工作量最大，放在最后。

## 每批的验收口径

1. 数值必须能指回原表的某个字段；没有字段的能力宁可不做，并在文档里标记「数据缺失」。
2. 必须有固定种子的定向测试：触发条件、数值、半径/时长、结束后不再结算。
3. 不能改变既有敌人的行为（已有测试全绿）。
4. 玩家能看见：新区域/新状态要么有绘制，要么有事件提示，不能出现「看不见就掉血」。
5. 复杂敌人未通过固定波次验证前，不进入随机池。
