# 解压缩类敌人（频次词条）缺口分析与实现计划

> **当前状态（2026-09-21）**：次数血条、解压缩、断刃和再生已接入。解压缩使用0.7秒内独立随机延迟和边长1的连续随机位置；坠落退场不生成碎片；断刃耗尽清空攻击间隔；再生1秒过渡期间有失衡免疫。定向测试见 `tests/native-decompress-enemy.test.mjs`。
> 清明隐匿光环、烹泉死亡减速已在后续批次接入；燃烧芦苇等环境交互和完整坠落物理仍未验收。全局进度与测试结果见 [敌人行为审计](docs/ENEMY_BEHAVIOR_GAP_AUDIT.md)，不能用本切片推断全部敌人完成。

本文档保留初始分析、实施路线与文末的当前落地口径。范围：本模式下「死亡后生成碎片」与「死亡后再生」两族敌人，
它们按 `data/modes/alliance-lower/default-wave-table.json` 的 `types.TIMES`（频次）词条出怪。

配套文档：`docs/ENEMY_BEHAVIOR_DEVELOPMENT.md`（移动/索敌口径与 `enemy-behavior-overrides.json`）、
`ENEMY_EFFECTS_PLAN.md`（第三批 TIMES 的预留位）、`INVISIBILITY_PLAN.md`（隐匿）。

## 一、术语对齐（对照 PRTS）

### 1. 解压缩 = `DeadSpawn`

原表键：`DeadSpawn.enemy_key`（字符串，碎片敌人 key）、`DeadSpawn.cnt`（个数）、`DeadSpawn.cnt_add`（可选，按持有物扣减）。
效果文本统一为「因坠落以外的原因死亡后 0.7s 内的随机时间，在以自身为中心 **1.0 边长正方形**范围内随机位置，
**以自身路径召唤** N 个\[碎片]」。见 [磨砻](https://m.prts.wiki/w/%E7%A3%A8%E7%A0%BB)、[沉沙](https://m.prts.wiki/w/%E6%B2%89%E6%B2%99)。

### 2. 碎片 = 「特殊生命值机制」

PRTS [特殊机制](https://prts.wiki/index.php?title=%E7%89%B9%E6%AE%8A%E6%9C%BA%E5%88%B6&action=raw&section=9)原文：

> 该目标在成功受到伤害，应用生命值变化时令生命值**只降低 1 点**（不论伤害多少）。
> 部分具有此机制的单位**仅接受部分类型的伤害**，类型不符合的伤害不会降低生命值。
> ※此机制不会影响伤害本身，对于其他机制（如基于伤害的治疗、损伤）而言相当于"确实造成了 X 点伤害，只是对方生命值最后只降低了 1 点"。
> 敌方图鉴描述为：**需要 X 次伤害击倒**，其生命值即为所需伤害次数。

要点：**血条数值 = 需要击倒的次数**（所以碎片 `maxHp` 是 2/3/4/25/30/35/45 这种小数字，不是真实血量）；
伤害统计与「基于伤害的回复」仍按全额伤害算；元素损伤（灼燃等）是损伤不是伤害，**不**减少次数。
见 [青瓷茶器](https://m.prts.wiki/w/%E9%9D%92%E7%93%B7%E8%8C%B6%E5%99%A8)。

### 3. 再生 = `Revive`

原表键：`Revive[Trigger].prop_max_hp`（第二形态的临时最大生命值 = 需要击倒的次数）、`Revive[Trigger].interval`（秒）。
两条形态文本（[深池逐火战士](https://m.prts.wiki/w/%E6%B7%B1%E6%B1%A0%E9%80%90%E7%81%AB%E6%88%98%E5%A3%AB)、[假想敌：再生](https://m.prts.wiki/w/%E5%81%87%E6%83%B3%E6%95%8C%EF%BC%9A%E5%86%8D%E7%94%9F)）：

1. **被击倒后重生，持续 1s**：不移动，持有 无敌 + 不可阻挡 + 失衡免疫。
2. 随后进入第二形态：基础最大生命值**临时**变为 `prop_max_hp`，持**特殊生命值机制**；
   - 怨恨的余烬 / 暴怒的余烬 / 贪欲的火灰：**不进行攻击**，获得**隐匿**、缴械；
   - 再生状态（假想敌）：**不可阻挡**，进入时使半径 1.8 范围内的其他敌方单位（无视其可选性）获得 **5 层吸收物理/法术伤害的护盾**；
   - 持续 `interval` 秒未被击倒 → 变回初始形态并**恢复所有生命**。

注意两点易错处：
- **`Aura.` 前缀不等于「给别人的光环」**。逐火家族的 `aura.range_radius` / `aura.damage_resistance` / `aura.ep_damage_ratio`
  是**自身条件判定**（"周围半径 1.5 内存在燃烧的芦苇丛时…"）；而假想敌的 `Aura.max_damage_block_cnt` 才是真光环。
  只能按图鉴文本判，不能按 key 前缀判。
- **假想敌第二形态仍会攻击**（文本里只写了「不进行攻击」之外的属性，没有禁攻击），只有余烬/火灰不攻击。

## 二、本模式的实际范围

### 可达的 TIMES 词条池（10 名，与其它词条池无重叠）

| 敌人 | 机制 | 关键数据 |
| --- | --- | --- |
| 磨砻 / 明鉴 | DeadSpawn | 木制瑞印×2（2 次）/ 红木瑞印×2（3 次） |
| 俗心 / 雅气 | DeadSpawn | 小说卷轴×3（3 次）/ 诗画卷轴×3（4 次） |
| 身观 | DeadSpawn + 嘲讽 | 青铜镜×1（30 次），`tauntLevel:1`「容易被我方攻击」 |
| 沉沙 | DeadSpawn + 断刃 | 铜矛头 ×(4−已消耗，至少 1)（25 次）；攻击力 +70%（本模式 `Atkup.atk=0.7`） |
| 深池逐火战士 / 精锐战士 | Revive | 余烬 5 次 / 10s |
| 深池逐火护卫 | Revive | 火灰 10 次 / 10s |
| 假想敌：再生 | Revive | 再生状态 15 次 / 15s + 周围 1.8 内其他敌人 5 层护盾 |

碎片本身**不在任何词条池里**，只能由父体召唤（`enemy_1196/1198/1200/1204/1208/1210_*` 只在目录、不入池）。

### 目录内但目前任何词条池都不含的（机制一并实现，数据到位即可用）

| 父体 | 碎片 | 个数 | 备注 |
| --- | --- | --- | --- |
| 黄铜镜（`enemy_1199_sfjin_2`，不在目录） | — | — | 只有碎片黄铜镜（35 次）在目录 |
| 木制/红木镇纸（`enemy_1201_sfzhi*`，不在目录） | 木制/红木镇纸 | ×15 | 单次生成 15 个 |
| 烹泉 / 沏虹（目录内，不入池） | 青瓷茶器（4 次）/ 彩瓷茶器（6 次） | ×4 | 碎片**仅接受法术或真实伤害**；父体死亡另有范围法术伤害 + 我方攻速降低（可抵抗） |
| 新硎（目录内，不入池） | 铁矛头（30 次） | ×4（`cnt_add=-1`） | |
| 清明（目录内，不入池） | 铜灯盘（35 次） | ×1 | 父体每段时间使周围其他敌人暂时隐匿 |
| 铁灯盘（`enemy_1210_msfden_2`，不在目录） | — | — | 45 次 |

### 当前出怪实况（`filterRandomPoolTable` 的影响）

`dist/native-wave-random.js:96` 会把 `enemyBehavior.randomPoolEligible===false` 的敌人从词条池里**过滤掉**，
所以 4 名 Revive 敌人（complexity=complex）**目前根本不会出现**：

| 词条 | 原池 | 实际出怪 |
| --- | --- | --- |
| TIMES/1 前哨推进 | 磨砻、俗心、明鉴 | 3 名（不变） |
| TIMES/1 前哨增援 | 俗心、明鉴 | 2 名（不变） |
| TIMES/2 混合进攻 | +雅气、逐火战士 | 逐火战士被剔除 |
| TIMES/2 精锐增援 | 明鉴、雅气、逐火战士、精锐战士 | 只剩明鉴、雅气 |
| TIMES/3 高压攻势 | +身观、逐火护卫、沉沙、再生 | 只剩磨砻、俗心、明鉴、雅气、身观、沉沙 |
| TIMES/3 集中突破 | 雅气、逐火战士、精锐战士、身观、逐火护卫、沉沙、再生 | 只剩雅气、身观、沉沙 |

也就是说：**DeadSpawn 父体在出怪，但不会掉碎片（白给）；Revive 敌人完全没上过场。**
（各池过滤后都还剩至少 1 名，所以没有触发 `PLACEHOLDER_ENEMY` 占位。）

## 三、缺口清单

| # | 机制 | 现状 | 缺口 | 位置 |
| --- | --- | --- | --- | --- |
| 1 | 特殊生命值机制（次数血条） | 完全没有。伤害按数值扣血 | 碎片 `maxHp=2` 会被**一次攻击直接打死**，碎片机制等于不存在 | `dist/combat.js:27 applyDamage` |
| 2 | 类型限定（仅法术/真实） | 无 | 青瓷/彩瓷茶器需要按伤害类型过滤次数 | 同上 |
| 3 | DeadSpawn | 无。`enemyBehaviorProfile` 不读 `DeadSpawn.*` | 死亡后不生成碎片 | `dist/native-combat.js`（推导）、`dist/native-battle.js:293 spawn` |
| 4 | 死亡事件的触发点 | `resolveEnemyDeath` 只在干员攻击路径被调用一次（`dist/native-battle.js:359`） | **现存缺陷**：被 DoT / 死亡区域 / 其它非干员来源击杀时，死亡爆炸与死亡区域都不会触发（第二批已落地的能力对这批击杀失效）。DeadSpawn/再生必须挂在覆盖全部死因的位置 | `dist/native-effects.js:124 commitExit` / `:143 dispatch('enemy-death')` |
| 5 | Revive（再生） | 无。`runFatal`（`dist/native-effects.js:176`）只处理干员分支；通用钩子 `battle.fatalHook`（`:206`）当前**无人实现** | 敌人不会进入第二形态 | `dist/native-battle.js`（新增 `fatalHook`） |
| 6 | 沉沙的断刃 | 未实现。`Atkup.atk=0.7` 被 `lowHpAttackAdd` 读成「低血量加攻」（`dist/native-combat.js:189/227`），而 `lowHpRatio=0` → 完全不生效 | ①攻击力加成缺失；②没有断刃计数，`DeadSpawn.cnt_add=-1` 无从计算 | `dist/native-combat.js` |
| 7 | `Aura.` 前缀误用 | **现存缺陷**：`aura.damage_resistance` 被推导成「给周围敌人减伤的光环」（`dist/native-combat.js:186/224`），运行时在 `refreshEnemyAuras`（`dist/native-battle.js:295`）发放 | 逐火护卫把 **50% 减伤白送给周围所有敌人**（正确语义是"自身附近有燃烧芦苇丛时自身减伤"，而本模式没有该地形 → 应完全不生效） | `dist/native-combat.js:186` |
| 8 | 嘲讽等级 | `spawn` 不映射 `tauntLevel`（`dist/native-battle.js:293`），运行时用 `e.taunt` | 身观（本批）、伙友卫队/中坚盾卫（既有）的嘲讽全部缺失 | `dist/native-battle.js:293` |
| 9 | 余烬的隐匿/缴械 | 隐匿状态机已有（`targets()` 里 `e.invisible` + `cfg.canSeeHidden` + 被阻挡可打） | 需要在形态切换时设置/恢复；缴械在本引擎里对该形态无实际作用（它本来就不攻击、无技能），登记不实现 | `dist/native-battle.js:269` |
| 10 | 假想敌 5 层护盾 | 基础设施齐备：`barriers` 按**次数**抵挡且支持 `types` 过滤，`grantGuard`（`dist/native-effects.js:769`）已在用（泥岩/泥岩初动/瑕光S2/临光S2） | 只差「进入再生状态时给半径 1.8 内其他敌人 5 层 physical/arts 护盾」这一句 | `dist/native-effects.js:769` |
| 11 | 碎片的「不占待处理目标」判定 | `notCountInTotal` 为 null（非非首要目标） | 无需处理：碎片**计入**待处理目标，会阻止战斗结束，`leak=1` 会扣生命值 —— 与图鉴一致 | — |
| 12 | 燃烧的芦苇丛 | 本模式关卡数据里**没有**该地形（`source.json` 里 `芦苇`/`burningReed` 均无命中） | 逐火家族的「附近有芦苇丛时附加灼燃损伤 / 自身减伤」在本项目**不可达**，本批不做，登记待地形系统落地 | — |
| 13 | 清明 / 烹泉 的附加能力 | 未实现 | 使周围敌人暂时隐匿、死亡范围法术伤害+降攻速（可抵抗）——两者当前不入池，本批不做 | — |

数值口径提醒：假想敌：再生的**图鉴文案**（AC-3 覆盖版）写「傀儡需要 **30** 次伤害击倒」，
但同一条目 `Revive[Trigger].prop_max_hp=15`、PRTS 通常页也写 15。**以 blackboard 的 15 为准**，
文案差异登记为数据问题（疑似官方文案笔误或跨版本残留）。

## 四、分批实现计划

四批都只动敌方侧，互不依赖前三批的顺序（但建议按序做，后一批复用前一批的通道）。

### 第一批（P0）：特殊生命值机制

1. `dist/combat.js:applyDamage` 增加次数血条分支：目标带 `hitCountHp` 时，
   护盾/屏障结算完成后，`leftover>0` 且伤害类型满足 `hitCountTypes`（缺省不限）→ 生命值只减 1，否则不减。
   返回值语义保持不变（`total` 仍报全额伤害，`hp` 报实际掉血量），保证伤害统计、`potentialHpDamage`、
   基于伤害的治疗（如 `char_1026_gvial2`）走的还是全额。
2. 推导：在 `enemyBehaviorProfile` 里从 `ability[].text` 识别
   `/需要(\d+)次(法术或真实)?伤害击倒/` → `hitCountHp:true`、`hitCountTypes:['arts','true']`（有"法术或真实"时），
   构建时随 `behaviorInferred` 落盘；`spawn` 时复制到敌人实例（并让第二形态在运行时也能设置）。
3. 元素损伤不计入次数：`applyElementDamage` 不经过该分支（已是独立入口，加测试锁死）。
4. UI（可选）：碎片血条旁标剩余次数，或在敌人血条上叠加 `×N`；现有 `hp/maxHp` 比例条本身已经能表现次数递减
   （`dist/native-play.js:368`），不做也不影响可玩性。

验收：木制瑞印被 1 次 5000 伤害打掉 1 次不死的计数、青瓷茶器对物理免疫/对法术计数、灼燃损伤不计数、
全额伤害仍进统计。

### 第二批（P0）：DeadSpawn

1. 推导 `deadSpawn:{enemyKey,cnt,cntAdd}`（`DeadSpawn.enemy_key` 取 `valueStr`）写进 `enemyBehavior`。
2. 统一死亡入口：把死亡类效果（`deathExplosion` / `deathZone` / `deadSpawn`）从干员攻击路径搬到
   `dist/native-effects.js:commitExit` 的敌人分支里（在 `reason==='leak'` 早退之后、`dispatch('enemy-death')` 附近），
   通过 `battle.onEnemyDeath?.(target,{reason,killer,event})` 由 `NativeBattle` 实现。
   保留 `enemyDeathHandled` 幂等标记。**这一并修掉缺口 #4**（DoT 击杀不触发死亡效果）。
3. 位置生成：通过 `spawn(q,placement)` 支持连续坐标；以死亡点为中心，两个坐标各偏移 `random()-.5`，不能扩成相邻九格中心。`route/cmd` 继承父体，之后沿原路径推进；完整边界碰撞另属公共物理机制。
4. 触发条件：死亡来源统一进入 `commitExit`；`fall` 坠落与 `leak` 漏怪不生成。每个碎片以 `random()*.7` 独立排入 `pendingEnemySpawns`，队列存入战斗快照并计入清场门禁；随机延迟影响可攻击时机，不能仅当作表现层抖动。
5. 沉沙的断刃：`readDagger` 计数（初始 `DeadSpawn.cnt=4`），`Atkup.atk` 按「持有断刃时攻击力 ×(1+0.7)」
   实现（**不是**每次消耗叠加），每次成功攻击后消耗 1，耗尽后本次攻击结束即失去加成；
   DeadSpawn 个数 = `max(1, cnt + cntAdd*已消耗)`。同时移除 `Atkup.atk` 被 `lowHpAttackAdd` 误读的路径。
6. 断言：碎片计入待处理目标（战斗不会在碎片存活时结束）、漏怪扣 1 点生命值、父体只解压缩一次。

验收：6 名可达父体的碎片个数与次数、生成位置落在可行走格、路径能走到底、DoT 击杀照样生成、
坠落不生成、沉沙断刃消耗→碎片数递减、`s.kills` 与伤害统计不发生重复结算。

### 第三批（P0）：Revive（再生）

1. 推导 `revive:{hitCount:prop_max_hp, interval, formName, invisible, noAttack, grantGuard:{layers,radius}}`：
   - `formName` 从描述 `/变为([^，。]*?)(?:，|$)/` 取（怨恨的余烬 / 暴怒的余烬 / 贪欲的火灰 / 傀儡）；
   - `invisible` 从 `ability` 文本 `/变为隐匿/`；`noAttack` 从 `/不进行攻击/`（余烬/火灰为真，再生为假）；
   - `grantGuard.layers` 从 `Aura.max_damage_block_cnt`，半径取固定 1.8（图鉴数值，原表无对应 key）。
2. 在 `NativeBattle` 实现 `fatalHook(target,event)`：命中 `revive` 的敌人返回 `true` 阻止 `commitExit`，
   并就地切换形态（同一个 `uid`，不新建对象，避免仇恨/伤害统计断链）：
   - 阶段 A（1s）：`invulnerable=true`（`dealDamage` 对 `invulnerable` 直接返回 null，`targets()` 也会排除）、
     `unblockable=true`、`canAttack=false`、速度 0（复用 `stun`/`stopForAttack` 一样的"不移动"口径，建议加 `formHold` 标记）；
   - 阶段 B：`hp=maxHp=hitCount`、`hitCountHp=true`、`canAttack=noAttack?false:原值`、`unblockable=false`、
     `invisible=revive.invisible`，`reviveRevertAt=time+interval`；再生额外给半径 1.8 内**其他**敌人
     `grantGuard(..., {charges:5, types:['physical','arts']})`；
   - 到点未死 → 恢复初始形态：`hp=maxHp=原始最大生命值`、`hitCountHp=false`、`invisible=false`、
     `canAttack` 还原、`enemyDeathHandled` 复位（允许再次再生）。
3. 与其它系统的边界：
   - 阶段 A 的无敌不能吃掉敌人的受击事件（`dealDamage` 早退 → 干员这次的攻击表现为"未命中"，需要确认
     攻击是否应该改打别人；建议阶段 A 同时 `untargetable`，让索敌直接跳过，避免空转）。
   - 形态切换时的 `statuses` 保留还是清空：按原作「清空自身身上除白名单外所有 Buff」的重生定义，
     建议**清空控制类状态**（晕眩/冻结/束缚/沉默）但保留伤害类 dot？——本期建议保守：控制类清空，dot 保留，并在文档登记。
   - 缴械：该形态不攻击且无技能，登记为"无实际效果"。
4. `enemy-behavior-overrides.json` 逐条把 4 名敌人 `randomPoolEligible` 打开（先过定向测试再开），
   否则它们在 `filterRandomPoolTable` 里仍然上不了场。
5. 顺带修缺口 #7：`aura.*` 一律不参与 `behavior.aura` 推导（只保留 `defup.*`），
   消除逐火护卫的"周围敌人 50% 减伤"；并把 `aura.range_radius` 不当作光环半径。

验收：三条形态时序（击倒→1s 无敌不可阻挡→次数血条形态→10/15s 回满血）、
再生状态给周围敌人 5 层护盾且被物理/法术各消耗 1 层、真实伤害不被护盾挡、
余烬的隐匿在未被阻挡时不可被索敌、被阻挡时可以被打、可反复再生、`s.kills` 只在真正死亡时 +1。

### 第四批（P1）：清扫与放量

1. 缺口 #8：`spawn` 映射 `tauntLevel → taunt`（同时修正伙友卫队、中坚盾卫）。
2. 碎片与再生的**表现层**：配合逻辑生成时间的出场表现、形态切换特效、失败/成功提示；
   余烬的隐匿用 `INVISIBILITY_PLAN.md` 里约定的"暗灰色流动马赛克"。
   （形态切换特效已于 2026-09-19 补上，具体口径见下方「再生形态的立绘与表现」；解压缩抖动仍未做。）
3. 不可达敌人的附加能力（清明隐匿光环、烹泉死亡减速、镇纸×15）登记在案，等它们进入词条池或地形系统落地再做。
4. 若日后加入燃烧的芦苇丛地形，再补逐火家族的 `aura.ep_damage_ratio` / `aura.damage_resistance`。

## 五、每批的验收口径（沿用 `ENEMY_EFFECTS_PLAN.md`）

1. 数值必须能指回原表字段（`DeadSpawn.*` / `Revive[Trigger].*` / 描述里的"需要 N 次"），
   推不出来的宁可不做并登记；`Aura.max_damage_block_cnt` 的半径 1.8 取自图鉴文本，需在代码注释里标注来源。
2. 必须有固定种子的定向测试：触发条件、个数/次数、半径、时长、结束后不再结算、可重复触发。
3. 不改变既有敌人行为（现有 440 例测试全绿）。
4. 玩家能看见：解压缩与形态切换必须有事件/特效，不能"看不见就多了一堆怪"。
5. 复杂敌人通过定向测试后才在 `enemy-behavior-overrides.json` 里放开随机池资格。

## 六、待确认问题

1. **再生是否无限次**：图鉴未标"仅一次"。逐火家族会在 10s 后自动回满血，若玩家打不掉余烬就可能无限循环，
   波次永远结束不了。建议先按原作（无限次）实现，若实测体感太差再讨论。
2. **阶段 A 的无敌期**：本引擎 `dealDamage` 对 `invulnerable` 目标直接返回 null（不是 0 伤害），
   干员这次攻击会"消失"。建议同时置 `untargetable` 让索敌跳过，但这会与"无敌但可被选中"的原作表现不同。
3. **形态切换是否清空持续伤害 debuff**：见第三批第 3 条。
4. **假想敌文案 30 vs blackboard 15**：以 15 实现，文案差异登记。
5. **碎片是否要在地图上显示剩余次数**：影响可读性，不影响规则。

## 七、落地结果

按四批全部实现（第四批只做了嘲讽项与表现层）。文件与口径：

| 项 | 实现位置 | 口径 |
| --- | --- | --- |
| 特殊生命值机制 | `dist/combat.js:applyDamage` 的次数血条分支 | 屏障/护盾结算完成后，类型符合且有余量时生命值只降 1；`total` 仍报实际击破量，元素损伤不经过这里 |
| 次数血条推导 | `dist/native-combat.js`（`hitCountHp` / `hitCountTypes`） | 从图鉴文本 `/需要(\d+)次(法术或真实)?伤害击倒/` 推，且仅 `applyWay==='NONE'` |
| 碎片体型 | `spriteScale`（碎片 0.6，其余 1）+ `dist/native-play.js` 的画布尺寸 | 生成时静态决定，形态切换不改；`hitCountHp` 是运行时状态，不能拿来当缩放依据 |
| 次数血条不吃缩放 | `dist/native-battle.js:spawn` 的 `countHp` | 次数取原表 `maxHp`，**不乘** `combatScale`，否则 0.7 倍会把「2 次」变成 1.4 |
| DeadSpawn | `enemyBehavior.deadSpawn` + `NativeBattle.deadSpawnFragments` | `DeadSpawn.enemy_key` 取 `valueStr`；`cnt_add=-1` 按已消耗断刃扣减，至少 1 个 |
| 碎片位置 | `NativeBattle.fragmentSpot` | 死亡位置周围边长1正方形内的连续随机坐标，每轴偏移范围为[-0.5,0.5) |
| 统一死亡入口 | `dist/native-effects.js:commitExit` → `battle.onEnemyDeath` | 死亡爆炸／死亡区域／解压缩共用，覆盖干员击杀、持续伤害、额外伤害与生命流失；漏怪（`reason==='leak'`）不算死亡 |
| 生成缓冲 | `queueEnemySpawn` / `flushEnemySpawns` | 不在遍历敌人数组时改动数组；每帧敌人状态结算后与战斗结束判定前各刷一次，保证「父体是最后一个敌人」时波次不会提前结束 |
| 断刃 | `enemyBehavior.daggers` + `resolveEnemyStrike` | `Atkup.atk` / `AtkUp.atk` 两种写法都认；持有期间攻击力 ×(1+加值)，每次成功攻击消耗 1 个，耗尽后回落并清空攻击间隔 |
| Revive | `enemyBehavior.revive` + `NativeBattle.fatalHook` / `tickEnemyRevive` | 就地切形态（同一个 uid）：1s 无敌+不可阻挡+不移动+失衡免疫 → 第二形态（次数血条 = `prop_max_hp`，恢复过渡前的失衡免疫标记）→ `interval` 秒未死则回满血并可再次再生 |
| 余烬隐匿 | `status.js` 的 `formInvisible` | `e.invisible` 由状态表推导，形态自带的隐匿必须单独标记，否则会被 `tickStatuses` 每帧清掉 |
| 再生护盾 | `enterReviveForm` → `grantGuard` | 半径 1.8 内其他敌人 5 层 `['physical','arts']` 次数护盾；护盾用尽即从数组移除 |
| aura 前缀修正 | `dist/native-combat.js` 的 `aura` 推导 | 只认 `defup.*`；`aura.*` 是自身条件判定，逐火护卫的 50% 减伤不再白送周围敌人 |
| 嘲讽映射 | `spawn` 的 `taunt:a.tauntLevel` | 同时修好身观、伙友卫队、中坚盾卫 |
| 随机池放开 | `enemy-behavior-overrides.json` | 4 名再生敌人过了定向测试后放开，TIMES 1/2/3 的池子恢复原样 |

### 再生形态的立绘与表现（2026-09-19 补，用户口径「按 A 来」）

**结论：形态没有独立立绘。** 原表只有 `Revive[Trigger].prop_max_hp` / `interval`，形态名只写在图鉴
文案里（`formName` 就是从描述正则取的）；PRTS 没有「怨恨的余烬／暴怒的余烬／贪欲的火灰／傀儡」的
敌人页面，`File:` 命名空间里也没有同名文件；每个敌人的模型走 `<敌人页>/spine` 数据页，
`深池逐火战士/spine` 与 `假想敌：再生/spine` 都**只有一个 asset**（`enemy_1288_duskls` /
`enemy_9010_acpupp`），把这两个模型的 atlas 纹理拉下来核对也是**只有本体部件**
（`C_Arm_L`／`C_Weapon`／`F_Body`…），没有余烬／傀儡专用图块。也就是说原作是**同一套模型换动作
（+缩放/变色）**渲染的，「对应头像」这类素材在官方资源里并不存在。

所以形态视觉＝**本体头像 + 形态专属缩放 + 形态色调**，走数据登记而不是运行时推导：

| 项 | 位置 | 口径 |
| --- | --- | --- |
| 形态视觉数据 | `enemy-behavior-overrides.json` 的 `revive.sprite` | `{avatar,scale,tint}`；`avatar:null`＝沿用本体头像；4 名再生敌人当前都是 `scale:0.6`，余烬／火灰 `tint:'ember'`、傀儡 `tint:'puppet'` |
| 取值规则 | `protocol.enemySprite(enemy)` | 形态期（`revivePhase==='form'`）返回 `{key:avatar||id,scale,tint}`，其余一律 `{key:id,scale:spriteScale,tint:null}`；**判定用 `revivePhase`，不是 `hitCountHp`** |
| 色调画法 | `native-fx.FORM_TINT_STYLE` + `formTintedImage` | 离屏画布 `source-atop` 压一层色，结果对象补 `complete/naturalWidth` 以便顶替 `Image` 传给 `drawConcealOverlay`（隐匿马赛克取同一张图）；`reduceFx` 时不压色 |
| 渲染入口 | `native-play.js` 敌人绘制 | 只有这一处：`img(sprite.key)` + `z.tw*.55*sprite.scale`；**不要写回 `e.spriteScale`**（那是生成时字段） |
| 形态表现 | `native-fx.drawEnemyPhase` | 消费 `enemy-phase`（`rebirth`／`revive-form`／`revive-revert`）：收缩灰烬环 + 形态名与剩余次数浮字；`reduceFx` 下只留环与文字 |
| 门禁 | `tests/native-decompress-enemy.test.mjs` | ①每个带 `revive` 的敌人必须登记 `revive.sprite`；②`avatar` 非空时必须在 `data.assets` 里（否则退化成橙色圆圈）；③`tint` 必须在 `FORM_SPRITE_TINTS` 且 `FORM_TINT_STYLE` 里有画法；④形态切换/回退/存档往返后 `enemySprite` 的取值正确 |

若日后拿到形态立绘（或用户提供图片），只需把 PNG 加进 `assets/prts` 清单，并把对应敌人的
`sprite.avatar` 指向那个素材 id 即可，渲染层不用改。

### 与原分析不一致的两处（以本节为准）

- **沉沙的 `Atkup.atk` 不是被「低血量加攻」误读**：`lowHpAttackAdd` 只读 `atkup.atk` / `AtkUp.atk`，
  沉沙用的是 `Atkup.atk`（大小写不同，两个都没命中）→ 完全没被读取；新硎用 `AtkUp.atk` 会被读到，
  但没有 `atkup.hp_ratio` 所以也不会生效。结论仍是"断刃未实现"，只是机制描述更准确。
- **碎片次数会被战斗难度缩放**：原分析漏了 `combatScale`。0.7 倍血量会把「2 次击倒」变成 1.4，
  所以 `spawn` 对次数血条敌人不乘血量缩放。

### 顺带修掉的既有缺陷

- **udflow（引星棘刺）一技能穿刺在命中 3 名以上敌人时会直接抛结算异常**：
  穿刺循环里每个目标共用同一个 `effectId`，第二个目标就触发 `consume` 的 duplicate 判定
  （`战斗结算异常：{"type":"duplicate","effectId":"udflow-pierce:4:69"}`）。已把目标 uid 并入 `effectId`。
  这个缺陷与本批无关（`dist/native-operator-effects.js` 未改动过），是本批压测时暴露出来的。
