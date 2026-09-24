# 技能范围与 PRTS 数据核对（2026-09-22）

结论：**范围形状数据本身是可信的**（与 PRTS 快照逐格比对 62/71 完全一致，基础范围 131/131 一致），
玩家看到的「过大、圆形变方形」几乎全部来自**客户端怎么用这份数据**：手工圈的包围方格半径、
瞬时/被动技能的范围不参与判定、召唤物统一 3×3、要塞多补自身格、以及方向表镜像。

**状态：第二节 8 类缺口已全部修复（见第六节修复记录），回归在 `tests/native-skill-range.test.mjs`。**

---

## 一、数据核对（我们的范围表 vs PRTS wiki 快照 vs 当期游戏表）

| 来源 | 文件 | 条数 |
| --- | --- | --- |
| 本期模式范围表（客户端实际读的） | `data/gamedata/allianceLower/range_table.json` → `NATIVE_DATA.ranges` | 72 |
| PRTS wiki 抓取（微件:Range） | `data/prts/snapshots/2026-09-12-prts/ranges.json` | 77 |
| 当期游戏表（对照用） | `data/gamedata/current/range_table.json` | 73 |

* **逐格形状**：两边共有的 71 条里 **62 条完全一致**（坐标取 x=col、y=row，不做翻转）。
* **9 条无法比对**（PRTS 快照 `displayCells` 为空，抓取失败）：`1-5`、`2-7`、`3-16`、`4-3`、`4-4`、`4-5`、`4-6`、`4-7`、`4-13`。
  其中本期只有 `4-5`（灰毫）、`4-6`（灰毫／号角）被用到——这正是「要塞是否含自身格」无法用 wiki 二次确认的原因。
* `0-2` 我们有、PRTS 快照没有；PRTS 另有 6 个特殊 id（`2-5dx`、`3-6x`、`t-1`、`act38side`、`Empty`、`y-11`），本期无人使用。
* 与当期表相比，本期表只少 `y-11`（后续版本新增的范围），说明本期数据在锚点上是自洽的。
* **基础范围**：131 个预设档案（含 114 与精锐）的 `phase.rangeId` 与 PRTS 快照 **131/131 一致**，0 处不符。
* **技能范围**：325 个技能选择里 **80 个**带显式 `rangeId`（≠基础），全部能在本期范围表里查到；
  带 `duration>0` 的技能，客户端确实会用技能范围（`battle.range(u,true)` 实测逐条核对 ✓）。

> 结论：**不要在范围表上找 bug**。缺口在判定与表现层。

---

## 二、缺口清单

### A. 「圆形」被实现成方格（结构性，波及 20+ 个技能圈）

* 判定：`native-effects.js:774` `zoneActors()` 用 `chebyshev(中心,目标) <= radius` → **正方形**，半径 2 就是 5×5=25 格（真实圆形约 13 格，最多 +92%）。
* 表现：`native-fx.js:398-406` 也是按 `max(|dx|,|dy|) <= ceil(radius)` 铺方格；只有 `kind:'field'`（敌方留下圈）走椭圆分支（`:410-425`）。
* 而 `native-operator-effects.js:83-92` 的 `zoneVisual` 给这些圈声明的是 `shape:'circle'`（`saria-s3`／`pasngr-s3`／`blkkgt-s3`／`glady-s3`／`cetsyr-dust`／`etlchi-s1`／`tinman-alchemy`／`blaze2-s1`／`sntlla-s2`／`sbell2-s2`／`ines-shadow`／`qiubai-s1`／`agoat2-s1`／`horn-light`）——**声明了圆形，实现和画法都是方块**。
* 参考：敌方圈支持 `values.shape==='circle'`（`native-battle.js:499` 用 `Math.hypot`），我方 `kind:'zone'` 没有这个开关。

### B. 「攻击范围内」被写成「包围方格半径」（过大最刺眼的两处）

| 技能 | 真实范围（数据） | 客户端 | 倍率 |
| --- | --- | --- | --- |
| 莫斯提马 S2「荒时之锁」 | 基础 `3-6` = **9 格** | `native-operator-effects.js:352` 取 `battle.range(u,true)` 的最大切比雪夫距离当半径 → 5×5 = **25 格** | 2.8× |
| 塞雷娅 S3「钙质化」 | `x-3` = **25 格**（缺四角） | `:355` 同样取包围半径 3 → 7×7 = **49 格** | 1.96× |

实测（一次性探针脚本，未入库）：莫斯提马 S2 开启后，**斜后与正后 2 格**（`(±2,±2)`，真实 `3-6` 之外）的敌人照掉血（1310/次），远处对照 0；
焰尾 S2 开启后，`x-1` 独有的 `(0,-2)` 掉血 **0**、3×3 内的 `(1,1)` 掉 2888；塞雷娅 S1 开技后相邻友军回血 **0**。
两处描述都写「攻击范围内／附近」，本来应该直接拿 `battle.range(u, skill)` 的 `cells` 判定。

### C. 瞬时／AUTO／PASSIVE 技能的范围**从未参与判定**

`skillActive(u) = u.skillLeft>0 || u.ammo>0`（`native-battle.js:102`），`inside()` 的默认技能开关就是它（`:363`）。
`duration` 为 0 或 −1 且没有黑板 `duration` 的技能，开技那一帧 `skillLeft` 就是 0 → 全程按**基础范围**算。

走 `activate()` 瞬时块（`native-battle.js:681`，用 `this.targets(u)` / `healingTargets(u)`）的：

| 干员／技能 | 数据范围 | 客户端实际 | 备注 |
| --- | --- | --- | --- |
| 锏「纯粹的武力」 | `x-4` 9 格 | 基础 `1-1` 2 格 | AUTO，`blkkgtNext` 只改伤害 |
| 锏「归于宁静」 | `x-1` 13 格 | 基础 2 格／半径 2 圈 | 专属圈是 5×5 |
| 塞雷娅「急救」 | `x-4` 9 格 | 基础 `0-1` **自身格** | 实测：相邻友军回血 **0** |
| 塞雷娅「药物配置」 | `x-2` 21 格 | 基础 1 格 | 同上 |
| 古米「备用军粮」 | `x-4` 9 格 | 基础 1 格 | 走「下次攻击回复」通道 |
| 瑕光「光芒涌动」 | `x-4` 9 格 | 基础 2 格 | 同上 |
| 崖心「束缚链」 | `3-14` 10 格 | 基础 `3-2` 4 格 | 「前方大范围」变成 4 格 |
| 忍冬「坠刃拷问」 | `3-12` 8 格 | 基础 2 格 | 描述「对周围最多 6 名」 |
| 维娜·维多利亚「重铸晖光」 | `x-5` 5 格 | 命中点周围 3×3（9 格） | 锚点也换了 |
| 引星棘刺「我的海疆」 | `3-9` 19 格 | 半径 2 圈（25 格） | 过大 |
| 乌尔比安「必须促成的接触」 | `3-2` 4 格 | 基础 2 格 | AUTO |
| 缄默德克萨斯「阵雨连绵」「剑雨滂沱」 | `x-4` 9 格 | 基础 2 格 | PASSIVE，`skillActive` 恒假 |
| 焰尾「红松林」 | `x-1` 13 格 | 写死 `chebyshev<=1` = 9 格 | 实测 `x-1` 独有的 `(0,-2)` 打不到，只有 3×3 内生效 |

**已经做对的路子**（可作为修法模板）：通用分支命中「对周围所有敌人／攻击范围内所有敌人／立即治疗」时走
`allTargets/allAllies(...,true)`（`native-operator-effects.js:383-384`），会强制用技能范围——
德克萨斯 S2「剑雨」实测能打到 `x-1` 的侧后格 ✓；凛御银灰 S2「御敌的锋锐」`allTargets(battle,u,true)` ✓。

### D. 召唤物统一 3×3 方格

`native-effects.js:1439` 判定用 `chebyshev(召唤物,敌人) <= s.range || 1.1`，而 `spawnSummon` **从不写 `range`** → 所有召唤物都是 3×3：

| 召唤物 | token 真实范围 | 客户端 |
| --- | --- | --- |
| 狼群 / 流形 / 黄金盟誓 / 沙之碑 / 香槟炸弹 | `0-1`（自身格） | 3×3 → **过大** |
| “小自在” | `x-5`（十字 5 格） | 3×3 → 过大 |
| 海嗣 / 医疗探机 / 纸偶 | `x-4`（3×3） | 3×3 ✔ |

### E. 要塞（灰毫／号角）被多补了自身格

`native-battle.js:362` 末尾：`if(p.branch==='fortress' && !grids.some(row0col0)) grids.push({row:0,col:0})`。
本期范围表 `4-5`/`4-6` 与 PRTS 都不含 `(0,0)`（PRTS 对这两条恰好抓取为空，但客户端读的就是这张表）。
要塞不阻挡时敌人会路过自身格，这一格会变成「幽灵命中」。**口径待你确认**。

### F. 方向表镜像（4 处，上下朝向打到反方向）

坐标约定（UI 与 `session.js:53` 的 aim 一致）：**0=右、1=下、2=左、3=上**。
正确表是 `[[1,0],[0,1],[-1,0],[0,-1]]`（`garrison.js:4`、`native-effects.js:666/701` 都是对的）；
下面 4 处用了 `[[1,0],[0,-1],[-1,0],[0,1]]`，**1 和 3 互换**：

* `native-shift.js:10` — 推开／拉向的 `forward`（力度方向判定）
* `native-battle.js:389` — 远牙 S3「光羽箭」的「前方直线」筛选
* `native-operator-effects.js:303` — 乌尔比安船锚落点方向
* `native-operator-effects.js:334` — 锡人炼金单元投掷方向

范围本身的旋转（`rangeWithSkill` 的 `[x,y]=[-y,x]`）是**对的**，不受影响。

### G. 战前预览只画常态范围

`native-play.js:425`：备战期／拖动预览用 `profile(selected).range.grids`，只有战斗期（`phase==='battle'`）
才用 `g.battle.range(live, skillActive)`。所以选了「真银斩」这类扩大范围的技能时，备战期看到的还是小范围。
**口径需你确认**：原作部署预览是否应显示所选技能的范围（若应显示，这里要按 `skillChoices[skillIndex].skill.rangeId` 画）。

### H. 其它与范围相关的简化／漏项

* **隐德来希 S2「绯红壁合」**：描述「在自身及 1 名其他地面单位处召唤血镰」，`native-operator-effects.js:252` 只生成**一处**圈（选中的那名友军，自身没有）。
* **寒檀 S2「女巫之泪」**：描述「向攻击范围内的随机地块召唤冰凌，冰凌落地后对周围所有敌人…」，客户端只在**当前目标**周围放一个半径 1 的圈（`:267`），没有覆盖她扩大后的 `3-3` 范围。
* **引星棘刺 S1「度算浪波」**：描述「落点和周围 8 格」（= 3×3），`thorn2-zone` 用半径 2（5×5 = 25 格）。
* **纯烬艾雅法拉 S3「火山回响」**：描述「攻击范围扩大至整个战场」，数据 `rangeId` 为空；客户端靠专属处理（治疗只取 5 名），范围显示仍是常态 `3-17`。
* **注释与事实不符**：`native-effects.js:1142` 把 `char_4134_cetsyr` 写成「归溟幽灵鲨」，实际是**魔王**（归溟幽灵鲨 = `char_1023_ghost2`）。
* **PRTS 快照抓取缺口**：`ranges.json` 有 9 条 `displayCells` 为空（见第一节），需要重抓才能补齐交叉核对（含 `0-2`）。

---

## 三、已核对无误（避免过度修复）

* 72 条范围形状、131 个基础范围与 PRTS 逐格一致（9 条受快照抓取所限无法比对，已列出）。
* 80 个带显式 `rangeId` 的技能全部命中本期范围表；`duration>0` 的技能范围判定 ✓。
* 范围随 `dir` 的旋转、`0-1`（近战自身格）、`x-*`／`y-*`（本期模式专用范围）都正确。
* 技能范围「扩大／缩小」的判定（`skillWidensRange`／`wideSkillKind`）与特效 `rangeGeometry` 走的是同一份网格数据，方向正确。

---

## 四、核对口径备忘

* 「攻击范围」= `character_table[charId].phases[i].rangeId`（按当前精英阶段）× `range_table.json` 的 `grids`；`row` 正向为上，客户端映射 `y = -row`。
* 「技能范围」= `skill_table[skillId].levels[skillLevel-1].rangeId`，为空表示沿用基础范围（本期 7718 个等级为空，2620 个非空）。
* PRTS wiki 的范围来自 `微件:Range/<rangeId>`，本地快照 `data/prts/snapshots/2026-09-12-prts/ranges.json` 的 `displayCells` 是展示网格（`kind: origin|outline`）。

## 五、修法顺序（已全部实施，见第六节）

1. **给圈加形状**：`zoneActors` 支持 `shape:'circle'`（`Math.hypot`），`drawZones` 按同一形状画（圆盘／圆环，不铺方格）；`kind:'zone'` 与 `kind:'field'` 共用一套。
2. **「攻击范围内」类圈直接取 `battle.range(u, skill)` 的 `cells`**，不要用包围半径（莫斯提马 S2、塞雷娅 S3 及同类）。
3. **瞬时／被动技能的范围**：开技那一帧挂住技能范围；`pendingAttackHeal`／`siege2Next` 之类挂到「下一次攻击」的效果要带上 `rangeId`；PASSIVE 技能与「被动效果：攻击范围扩大」的技能范围常驻生效。
4. **召唤物写 `rangeId`**：`spawnSummon` 读 token 的 `rangeId` 网格，`tickSummons` 用 `summonInRange` 判定。
5. **要塞自身格**：删除客户端补格。
6. **统一方向表**为一个常量（`protocol.DIRECTIONS`），替换全部镜像用法。
7. **备战预览**改用所选技能的 `rangeId`。
8. 顺手修 `native-effects.js` 的干员名注释。

---

## 六、修复记录（2026-09-22，commit 见仓库历史）

| 缺口 | 修法 | 位置 |
| --- | --- | --- |
| A 圆形圈判成方格 | `zoneContains()` 支持 `shape:'circle'`（`Math.hypot`）；`drawZones` 对圆形圈画圆盘／圆环；半径 ≥2 的领域（异客 S3、锏 S3、伊内丝 S3、圣聆初雪 S2／积雪、魔王微尘、哥蕾蒂娅 S3、烛煌 S1、锡人炼金单元、号角照明弹）显式声明 `shape:'circle'` | `native-effects.js`、`native-fx.js`、`native-operator-effects.js` |
| B 「攻击范围内」用包围半径 | 新增 `rangeUid`：圈挂到施法者的**当前攻击范围**（塞雷娅 S3 的 x-3、莫斯提马 S2 的 3-6、纯烬艾雅法拉 S1 的 3-17 光环）；判定与绘制都按范围格 | `native-effects.js`（`zoneContains`）、`native-fx.js`、`native-operator-effects.js` |
| C 瞬时／被动技能范围不生效 | `activate()` 开技帧写 `u.skillRangeHold`（`NativeBattle.skillRangeId` 优先读它）；PASSIVE 与文案含「被动效果」的技能范围常驻；`pendingAttackHeal`／`siege2Next`／`blkkgtNext`／`mudrokS1` 带 `rangeId`，下一击按该范围选目标（塞雷娅 S1 现在能治到 3×3 内的残血友军） | `native-battle.js`、`native-operator-effects.js` |
| D 召唤物统一 3×3 | `spawnSummon` 取 token 的 `rangeId`；`summonInRange()` 按网格判定（被自己阻挡的目标照旧可打） | `native-effects.js` |
| E 要塞多补自身格 | 删除 `rangeWithSkill` 里的 `fortress` 补格；备战预览同步 | `native-battle.js`、`native-play.js` |
| F 方向表镜像 | `protocol.DIRECTIONS`／`directionOf()` 成为唯一朝向表，替换 7 处（推拉 forward 与锚点、远牙 S3 前方、乌尔比安船锚、锡人投掷、两件装备的方向判定） | `protocol.js`、`native-shift.js`、`native-battle.js`、`native-operator-effects.js`、`native-equipment.js` |
| G 备战预览只画常态范围 | 预览按 `skillChoices[skillIndex].skill.rangeId` 取网格；「攻击范围扩大至整个战场」整图高亮 | `native-play.js` |
| H 其它简化 | 隐德来希 S2 自身＋1 名地面单位**两处**血镰；寒檀 S2 冰凌每次结算挪到攻击范围内的随机格（并带 `cold`）；引星棘刺 S1 的炼金单元半径 2→1（落点周围 8 格）；魔王注释纠错 | `native-operator-effects.js`、`native-effects.js` |

回归：`tests/native-skill-range.test.mjs`（9 条，含「范围表与 PRTS 快照逐格一致」「基础范围 131/131」「方向表唯一」「预览按技能范围」四条门禁）。
未做：重抓 PRTS 快照里 `displayCells` 为空的 9 条（本期只用 4-5／4-6；这两条与**当期游戏表** `data/gamedata/current/range_table.json` 完全一致，
所以要塞口径按自家范围表判定，不需要 wiki 二次确认）。
