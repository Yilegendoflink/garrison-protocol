# 地图特殊地块与地图装置审计（2026-09-22）

用户口径：「参考 PRTS wiki 的地图数据，补全地图上的特殊地块效果（泥地、源石地板、吹风等等），同时补全对应视觉效果。」

本文记录**数据来源、逐项数值、实现位置、仍未闭环的部分**，改动前先读这一页。
数值一律以「原表黑板 → PRTS 页面」为准，客户端不另写一套（与本仓库其它模块同一条规矩）。

## 一、数据来源

| 来源 | 用途 | 链接／文件 |
| --- | --- | --- |
| PRTS《卫戍协议：盟约 下半/战场一览》oldid 387659 | 本期（下半）逐张战场的特殊地形／地图装置／环境调控装置文字 | <https://prts.wiki/w/卫戍协议：盟约_下半/战场一览> |
| PRTS《卫戍协议：盟约/战场一览》oldid 376452 | 上半战场 #04–#07（本客户端也复用了其中几张图） | <https://prts.wiki/w/卫戍协议：盟约/战场一览> |
| PRTS《源石流发生装置》oldid 398626 | 气流的完整机制（含等级 1／2 的顺风加成差异、直接／最终乘算备注） | <https://prts.wiki/w/源石流发生装置> |
| Terra Wiki《Mire》《Active Originium》《Deep Water Zone》 | 沼泽／活性源石／深水的通用机制（数值仍以本项目原表黑板为准） | <https://arknights.wiki.gg/wiki/Mire> 等 |
| 关卡原表 `data/modes/alliance-lower/levels/level_act*.json` | 地块 `tileKey`／黑板、装置 `tokenInsts`（位置＋朝向）、控制器技能黑板 | 由 `scripts/build-protocol.mjs`／`build-native.mjs` 提取 |

本期 11 张战场里出现过的特殊地块只有 5 种：`tile_infection`（活性源石）、`tile_mire`（沼泽地段）、
`tile_smog`（排气格栅）、`tile_deepsea`（深水区）、`tile_fence_bound`（隔离平台，纯视觉/通行）。
判定一律按 `tileKey`，登记在 `dist/native-environment.js` 的 `TERRAIN_TILES`；新增地块必须同时补登记与逻辑
（`tests/native-terrain-effects.test.mjs` 有门禁）。

## 二、逐项数值与实现

| 战场 | 原表／PRTS 口径 | 客户端实现 |
| --- | --- | --- |
| #04 活性源石（`tile_infection`，m04 8 格） | 「部署于其上的我军和经过的敌军在 5 分钟内每秒受到 70 真实伤害，攻击力提升 20%，攻击速度增加 20」＝原地块黑板 `damage:70 / atk:0.2 / attack_speed:20 / duration:300` | `map.environment.originium` + `tickActiveOriginium`：站在格上的我方与敌方每秒 70 真实伤害（`environmental` 标记），攻击力 ×1.2、攻速 +20。窗口按 `duration` 从开战计时（单场战斗远短于 300 秒，等价于「站在上面就有」） |
| #05 源石流发生装置（`trap_013_blower`，a2m01 8 台） | 「向前方 3 格吹出气流；与气流同向/逆向部署的干员攻击 +30%/−30%；逆向移动的敌人移速 −50%，同向 +50%（等级 2；等级 1 为 +80%）」＝黑板 `blower_s_character[equal/vertical/opposite].atk`、`blower_s_enemy[equal/opposite].move_speed` | `map.environment.blower`（数值）＋ `map.windSources`（位置，**不按裁切过滤**）→ `blowerCells` 按朝向展开 3 格；`tickBlower` 给干员写 `windAtkRatio`（同向 +0.3／逆向 −0.3／垂直 0，**召唤物不吃**）、给敌人写 `windMoveScale`（±50%／垂直 1） |
| #06 沼泽控制（`trap_098_mire` ＋ `tile_mire`，a2m02） | 「位于<沼泽地段>的单位每 3 秒获得一个沼泽 Buff：攻击速度 −5%、移动速度 −5%，最多叠加 10 层；离开立刻清空」＝黑板 `attack_speed:-0.05 / move_speed:-0.05 / max_stack_cnt:10 / value:3` | `map.environment.mire` + `tickMire`：站在 `tile_mire` 上每 3 秒 +1 层（上限 10），写 `envAttackSpeedScale = 1 − 0.05×层`（我方与敌方）与移速比例（敌方）；离开即清零 |
| #07 排气格栅（`tile_smog`，a2m03） | 「置于其中的干员不会成为敌军远程攻击的目标」 | `onVentTile` 挂在 `native-enemy-attacks.enemyAttackTargets` 的**远程**候选过滤里（近战阻挡目标照旧可打；召唤物不算干员，不享受保护） |
| #05/#08 深水区（`tile_deepsea`，m05 / a2m04） | 涨潮控制：「敌方单位每秒受到 40 点伤害，攻击速度降低 60%，移动速度降低至 60%」；Terra Wiki：**不可部署**（要靠特制水上平台） | 伤害/减速原本就有（`tickDeepWater`）；本次补上**不可部署**：`build-protocol` 把 `tile_deepsea` 的 `buildableType` 定为 `NONE`，平台格（`trap_040_canoe`）在同一步里改回 `ALL` |
| 共通：阻隔工事／封印的地面／射击台／土石结构／特制水上平台／树丛 | 阻隔工事＝改变敌人路线（阻挡会被破坏）；封印的地面＝土石结构在第 14 回合前的替代；射击台＝可部署高台干员；土石结构＝挡沙尘暴；特制水上平台＝可在水上部署；树丛＝不受伤、遮挡我方视野、每 15 秒向周围 4 格草毯生长 | 阻隔工事／封印的地面＝`obstacle`（不可通行/不可部署）；射击台＝`HIGHLAND/RANGED` 可部署；土石结构＝沙尘暴掩体（已有）；水上平台＝可部署水面格；**树丛的「遮挡视野」与生长仍未实现**（见第四节） |

数值桥接（构建期）：`scripts/build-native.mjs` 把上表写进 `map.environment`（`originium`／`mire`／`blower`，
`deepWater`／`sandStorm` 是更早的一批）；`scripts/build-protocol.mjs` 负责地块可部署性与 `windSources`。
运行期合成在 `native-environment.syncEnvModifiers`：`envAtkRatio`（ratio，`base×(1+x)`）、`envAttackSpeed`（加算）、
`envAttackSpeedScale`（乘算）、`envMoveScale`（乘算）。数值消费者只有四处：
`native-battle.stats`（我方＋召唤物）、`native-battle.enemyAttackTiming`、以及敌方移动的三处
（`native-combat.advanceEnemy`、`native-enemy-fear`、`native-enemy-traits` 的冲锋计值）。

## 三、这次特别核到的两件事（不要再改回去）

1. **气流源必须用不裁切的位置表**：a2m01 有 8 台装置，其中**真正吹进战场的是裁切框外第 13 行的那 4 台**
   （裁切框是第 6–12 行），框内的 2 台朝框外吹。所以 `build-protocol` 额外输出 `map.windSources`
   （全部未隐藏的 `trap_013_blower`，坐标仍按裁切换算），`blowerCells` 只保留落在棋盘内的格子。
   按可见 `devices` 取会整块漏掉，看上去就像「这张图没有风」。
2. **朝向字符串只有一份表**：`protocol.DIRECTION_NAMES`／`directionIndex`（`RIGHT/DOWN/LEFT/UP → 0/1/2/3`，
   与 `DIRECTIONS` 的 `0=右、1=下、2=左、3=上` 同一份）。沙尘暴掩体判定也改成走它（原文用字符串比较），
   语义不变：`DOWN` = 屏幕向下（+y），掩体必须在**迎风侧**。

## 四、仍未闭环（诚实清单）

- **树丛（`trap_218_fttree`，m07）**：只画了模型，没有实现「遮挡我方视野」与「每 15 秒向周围 4 格草毯生长」
  （草毯地块在本期原表里没有独立 `tileKey`）。它不是可砍伐巨蕈，别拿巨蕈的机制顶。
- **气流攻击力的乘算口径**：PRTS 备注「提升为直接乘算、降低为最终乘算」。本客户端把两者都放进 `stats()`
  的 ratio 桶（与沙尘暴 −50% 同一条通道），只有在同时存在加算与乘算攻击力修正时才能看出差别，暂未单独建模。
- **土石结构／射击台／封印的地面的可部署性**：土石结构所在格目前仍按原地块（`tile_road`，可部署）处理；
  原表中它是占位装置（第 14 回合前由封印的地面替代）。本期战斗只有 8 回合，先按现状态保留。
- **地图装置没有独立立绘**：所有装置都是画布上现画的图形（见下），没有从图集取图。
- **上半 #07 树丛图（m07）与下半 #07 排气格栅图（a2m03）不是同一张**：#07 号在上下半期各指不同战场，
  判定按 `tileKey` 而不是按编号。

## 五、视觉清单（`native-play.js`）

- 地块：`drawWaterTile`（深水：蓝色渐变＋两道光纹）、`drawMireTile`（沼泽：暗绿＋涟漪＋气泡）、
  `drawOriginiumTile`（活性源石：暗紫底＋橙色晶簇＋呼吸光晕）、`drawVentTile`（排气格栅：金属栅条＋流光）。
- 装置：`drawDeviceGlyph` 画源石流发生装置（风叶＋朝向箭头）、特制水上平台（木板）、土石结构（岩堆）、
  封印的地面（封条叉）、射击台（四角括号）、树丛（树冠）。
- 气流：`drawWindCells` 在气流格上画流动的人字箭头（方向＝装置朝向）。
- 单位角标：`drawTerrainBadges`（源石／沼泽×N／气流±X%／格栅）——让「地块效果到底生效没有」一眼可见。
- 图例：`terrainLegend(map)` 按当前地图**真实出现**的地块与装置追加图例项（深水区（不可部署）／沼泽地段／
  活性源石／排气格栅／源石流气流／特制水上平台／土石结构／封印的地面／射击台／树丛），
  配色与画布一致，样式在 `dist/native.css` 的 `.native-terrain-legend .terrain-*`。

## 六、回归

`tests/native-terrain-effects.test.mjs`（7 条）：

1. 每张战场的地块/环境配置与 PRTS 及原表黑板逐项对齐（含「有气流的地图只有 a2m01」）；
2. 深水不可部署、水上平台可部署（`buildableType` 与 `canDeploy` 双口径）；
3. 活性源石：每秒 70 真实伤害、攻击力 +20%、攻速 +20，对照组不受影响，离开立刻失效；
4. 沼泽地段：3 秒一层、上限 10 层、攻速按层下降、离开立刻清空；
5. 排气格栅：格栅上的干员不在敌军远程候选里，别的干员照旧会被选；
6. 源石流发生装置：干员同向 +30%／逆向 −30%／垂直 0，敌人 ±50%／垂直无修正，气流格确实落在棋盘内；
7. 接线与视觉门禁：四种地块有画法、六个装置有画法、图例接线、CSS 色块、环境 tick 在真实 `step` 里跑、
   移动/攻速消费者只读 `env*` 字段、敌方远程索敌排除格栅。

`tests/native-terrain-visual.test.mjs`（隔离平台仍是地面）与 `tests/native-deployment-placement.test.mjs`
（高台/地面部署规则）继续有效；深水不可部署只影响 `tile_deepsea`，平台格与其它地块不受影响。
