# 第二批：隐匿（INVISIBLE）适配计划

> **落地状态（2026-09-18）**：马赛克表现、我方隐匿的索敌落地、「被阻挡即脱离隐匿」、反隐的时间窗模型
> （银灰鹰眼视觉 / 伊内丝影哨 + 撤退后留哨）、清明 `InvisibleShield`、忍冬的条件式迷彩、
> `drawStatuses` 的隐匿图标都已完成，逐条见文末「落地结果」。
> 仍未做：迷彩的完整细则（§七），它不影响本批已经落地的选择判定。

目标：把隐匿做成**一套统一的可选性规则**，让敌人的隐匿、我方干员／召唤物获得的隐匿都真正生效；反隐（隐匿免疫）按原表逐个接入；隐匿单位在场上带**暗灰色流动马赛克**特效。

范围包含波次编辑器的 `INVISIBLE` 词条，以及原表里带 `InvisibleCombat` / `InvisibleShield` 预制体、天赋黑名单写着「隐匿」或「被阻挡前无法被攻击」的敌人。

## 一、现状与缺口

| # | 现状 | 缺口 |
| --- | --- | --- |
| 1 | 敌方隐匿是**两个互不相通的开关**：`enemy.invisible`（由 `initialInvisible` 初始化、被 `revealed` 压制）和状态 `kind:'invisible'`（`status.js` 写 `target.invisible`） | 没有单一语义。`InvisibleCombat` 打完后 `enemy.invisible=false` 但状态还在；状态到期又不会把开关拨回去 |
| 2 | 干员隐匿**完全没有索敌效果** | `native-battle.js:395` 敌方选目标时只看 `permissions(u).sleeping`，从不看 `u.invisible`。干员拿到隐匿等于什么都没发生（干员侧 `u.invisible` 也没有从状态里派生出来的路径） |
| 3 | 反隐有四种写法：`revealed` 永久置位、逐名代码直接置位、`revealed=true` 不区分来源与时长 | 没有「反隐源 + 范围 + 时长」的概念；源离场后揭示不会撤销；「隐匿免疫」这个 flag 本身没建模 |
| 4 | 表现层只给 `cold/frozen` 做了 `drawFrostOverlay` | 隐匿单位没有任何提示，玩家看不见谁在隐匿；也没有马赛克特效 |
| 5 | 原表预制体 `InvisibleShield` 不在 `supportedSkillPrefabs` 里 | 清明（`enemy_1209_sfden`，每 15 秒给周围敌人 5 秒隐匿）被标成 `complex`、锁在手工波次外，技能本身没实现 |

## 二、我方隐匿的来源：盟约

**我方隐匿几乎全部来自盟约，不是干员技能。** 本模式 112 名干员里没有任何一名的技能或天赋写着「获得隐匿」；唯一的我方隐匿来源是盟约：

| 盟约 | 触发 | 提供给谁 | 隐匿时长 | 附带效果 |
| --- | --- | --- | --- | --- |
| **叙拉古**（`siracusaShip`，激活数 3，隐匿门槛 6 名不同叙拉古干员） | 我方叙拉古干员**部署后** | 每名符合的叙拉古干员自身 | `32 + 0.4 × 层数` 秒 | 隐匿期间及脱离隐匿 10 秒内，攻击有 3% 概率造成 `5000 + 50 × 层数` 真实伤害并恐惧 3 秒；另有攻速 `+25 + 0.8 × 层数` |

数值取自 `bondInfoDict.siracusaShip` 的 `env_gbuff_new` 黑板（`base_duration` / `duration_per_stack` / `power_bond_char_cnt` / `end_duration` / `prob` / `base_damage` / `damage_per_stack` / `fear`）。

模式内可见的叙拉古干员 **10 名**：德克萨斯、拉普兰德、忍冬、伺夜、香草、凛冬、安洁莉娜、异客、焰尾、灵知（按 `charId` 去重）。凑满 6 名不同身份即可触发。

### 现状

`dist/native-effects.js:475` 已经在部署时发 `applyStatus(u,'invisible',duration)`，并把窗口写进 `u.siracusaInvisibleUntil` / `u.siracusaExposureUntil`，攻击真伤与恐惧也在 `hurt` 链路里接了。**所以状态是挂上的——但敌人索敌完全不读它**（缺口 2），再叠加没有马赛克（缺口 4），实际表现就是「叙拉古盟约的隐匿形同不存在」。这也意味着本批的收益集中在「让已有的盟约 buff 落地」，而不是新增内容。

### 本批对盟约要做的事

- **M1**：敌人的普通攻击、远程索敌、`DeathEye` 这类锁定技能，全部改走统一判定；隐匿中的叙拉古干员不再被选为目标（正在阻挡某敌人的单位仍是合法目标）。
- **M2**：叙拉古隐匿的**时长确实吃层数**（`32 + 0.4×层数`）。现状用 `bondParam` 读取，需要补一条「层数变化后重新部署是否刷新」的定向测试，确认与 `duration_per_stack` 一致。
- **M3**：`siracusaExposureUntil` 的 10 秒窗口只影响真伤概率，不影响可见性——即隐匿结束后单位立刻恢复可选。这条要在测试里固化，避免以后把窗口误当成「延长隐匿」。
- **M4**：盟约给出的隐匿必须有马赛克（见 D 组），否则玩家无法判断自己的干员是否还在隐匿、真伤窗口有没有结束。
- **M5**：给这套机制留一个**通用入口**：盟约之外若以后有干员／召唤物获得隐匿（`applyStatus(target,'invisible')` 或 `target.invisible=true`），判定与特效都不需要再改代码。这是本批「我方也能获得隐匿」的落点。

## 三、按 PRTS 口径要实现的语义

来源：[异常效果 · 隐匿（INVISIBLE）](https://prts.wiki/w/%E5%BC%82%E5%B8%B8%E6%95%88%E6%9E%9C)、[反隐（隐匿免疫）](https://prts.wiki/w/%E5%BC%82%E5%B8%B8%E6%95%88%E6%9E%9C)。隐匿属于「无法选择类异常效果」，不是位移或受伤规则：

- **不能被不同阵营选中**：索敌直接视为范围内不存在该单位。
- **不阻止阻挡**：隐匿单位照常被阻挡，也照常阻挡别人（对应「在被阻挡前无法被攻击」的敌人：被挡住就变成可选）。
- **与伤害无关**：隐匿不减免伤害、不免疫状态；已经锁定的攻击不会因目标中途获得隐匿而取消。
- **反隐 = 隐匿免疫**：让隐匿**暂时无法生效**，但不清除携带隐匿的 Buff；反隐源消失后隐匿重新起效。
- **迷彩是另一套**：迷彩不阻止光环／格子判定，且受「隐匿免疫」影响的方式与隐匿不同。本批先把迷彩按现状保留，细则放进缺口清单，不在本批扩范围。
- **重复获得隐匿**：刷新持续时间，不叠加。

## 四、任务拆解

### A. 统一「隐匿中」判定（`dist/status.js` + `dist/native-battle.js` + `dist/native-effects.js`）

1. 在 `status.js` 增加 `concealed(target)`：同时看状态里的 `invisible`／`camouflage` 与单位自身的 `invisible` 开关，扣除反隐来源。**盟约发出的 `applyStatus(u,'invisible')` 与新入口共用这一条判定，M1 与 A 是同一件事。**
2. 删掉 `native-battle.js` 里 `enemy.invisible` 与 `invisibleRecoverAt` 的自管逻辑，改为 `InvisibleCombat` 通过 `applyStatus` / 移除状态表达「打完后显形、停手 6 秒后重新隐匿」。
3. 敌人、干员、召唤物统一走一个 `isSelectable(target,{by})`：
   - 敌人选我方目标：`!concealed(u) || u 正在阻挡该敌人`。**这一条是叙拉古盟约隐匿生效的关键**，也是唯一需要改动敌方索敌的地方。
   - 干员选敌人目标：`!concealed(e) || e.block === u.uid || 该干员有反隐`（`targeting.js` 与 `native-battle.js:250` 的 `targets()` 两条路径都要改，避免 legacy 与新引擎口径分叉）。

### B. 盟约隐匿的落地与固化（`dist/native-effects.js` + 测试）

4. 叙拉古隐匿时长核到层数（`base_duration + duration_per_stack × 层数`），补「层数变化后重新部署」的定向测试（M2）。
5. 固化「`end_duration` 窗口只影响真伤概率、不延长隐匿」的口径（M3）：隐匿到期的同一帧单位即恢复可选。
6. 复核真伤与恐惧的触发条件确实以「隐匿中或脱离隐匿 10 秒内」为准，而不是只看 `siracusaInvisibleUntil`（M4 前置）。

### C. 反隐源模型（`dist/native-battle.js` + `dist/native-operator-effects.js`）

7. 新增 `revealSources`：`{sourceUid, x, y, radius, endsAt, persistent}`，由反隐天赋／技能注册，每帧重算被揭示的敌人。
8. 已确认的两名反隐干员：**银灰**（鹰眼视觉，攻击范围内敌人隐匿失效）、**伊内丝**（影哨，攻击范围内隐匿失效且移速 -30%，**撤退后原地留下影哨持续生效**）。伊内丝影哨按 `persistent + 坐标锚点` 实现，替换现有的逐帧置位写法。
9. `revealed` 改为从反隐源派生；`revealed=true` 的旧写法保留为「本帧强制可见」的兼容入口，逐步替换。
10. 被反隐的敌人若同时「被阻挡才可选」，反隐应独立于阻挡生效（原表反隐直接令隐匿失效）。

### D. 敌方隐匿技能（`dist/native-battle.js` + `dist/native-combat.js`）

11. `InvisibleShield`（清明）：`supportedSkillPrefabs` 加入该预制体；每 `cooldown` 秒对半径内**其他敌方单位**施加隐匿，时长取技能黑板 `duration`（当前数据为 5 秒）；自身不获得。**实现并验过后解除 `complexity` 限制**。**已落地**：这是独立计时的自施法技能（`tickEnemyInvisibleShield`），不挂在「攻击附带特殊效果」分支上——清明在行进途中不开火，挂攻击就会漏触发。半径原表没有独立字段，取敌人自身 `rangeRadius`（2 格）。
    落地时发现计划里「纳入 INVISIBLE 随机池 + 补费用档位」这条前提是错的：原表 `season.enemyInfoDict` 里清明**不属于任何词条**（它只出现在固定关卡 `h07_03`），而 `tests/native-wave-defaults.test.mjs` 强制「池成员必须属于该词条的 enemyInfoDict」。因此改为：保留行为覆盖里的 `randomPoolEligible:true`（编制台手工加池、固定波次都因此不再被 `filterRandomPoolTable` 剔掉），默认随机池不动、采集数据不改。
12. `InvisibleCombat`（山海众头目／秘使）：攻击后显形，攻击力倍率按黑板 `atk_scale`（当前 2.0）；停止攻击 6 秒后重新隐匿。现实现的 `invisibleRecoverAt` 固定 6 秒，改造时保留这个常量并写进注释。
13. 常驻隐匿的「被阻挡前无法被攻击」敌人（隐形弩手／隐形术师／潜伏者／山海众等）保持 `initialInvisible`，由 A 的统一判定保证「被阻挡即可选」。

### D. 马赛克表现（`dist/native-fx.js` + `dist/native-play.js` + `dist/native.css` 如需）

16. 新增 `drawConcealOverlay(c, actor, box, opts)`，与 `drawFrostOverlay` 同形参：只读单位状态，不改战斗状态。
17. 画法：
    - 单位头像先降采样到约 10×10 的离屏画布（隐形术师一类没有头像时退化为纯色块），映射到**暗灰色阶**（保留明暗轮廓，去色）。分辨率与灰滤镜、块透明度统一由 `CONCEAL_STYLE` 常量表控制，见落地结果。
    - 按 `time` 对马赛克块做错位／交叉偏移，形成「流动」感；叠加一层极淡的暗灰底噪。
    - 被反隐时不画；`reduceFx`（动效少）时为静态马赛克，不流动。
    - 结果按 `(imageKey, reduceFx)` 缓存离屏画布，避免每帧重采样像素。
18. 调用点：干员绘制、召唤物绘制、敌人绘制三处，紧挨现有 `drawFrostOverlay`。
19. `drawStatuses` 的图标白名单加入 `invisible`／`camouflage`（`native-fx.js:477`），让「能被玩家反隐发现」这件事有可读提示。**已落地**：两者都是虚线方框（迷彩多一道对角），马赛克仍由 `drawConcealOverlay` 画在身上，图标只负责说明「为什么打不到」。

### E. 测试（新增 `tests/native-invisibility.test.mjs`，扩展 `tests/native-fx-zones` 或另开一个绘制测试）

20. **叙拉古盟约**：6 名不同叙拉古干员时每名部署后获得隐匿；敌人索敌跳过它；正在阻挡敌人的那名叙拉古干员仍会被该敌人攻击（本批的头号用例）。
21. 盟约隐匿时长随层数变化；`end_duration` 到期后单位立刻恢复可选，但真伤窗口仍在。
22. 敌人隐匿时干员索敌排除；被己方阻挡后可选。
23. 召唤物隐匿时敌人不选它。
24. 反隐源：进入范围即揭示、离开范围或源撤退后恢复隐匿、伊内丝影哨在撤退后仍生效。
25. 清明：只给周围其他敌人、不含自身、时长 5 秒、冷却 15 秒、到期恢复。
26. 山海众：攻击后显形，6 秒不攻击后重新隐匿。
27. 马赛克：隐匿单位绘制调用返回 true 且取自暗灰色板；被反隐后不再绘制；`reduceFx` 下不流动。

## 五、验收口径

- 数值与时长必须指回原表字段（叙拉古盟约黑板的 `base_duration` / `duration_per_stack` / `end_duration`、`InvisibleShield.duration`、`InvisibleCombat.atk_scale`、天赋文本里的「6 秒」按现有常量并注明来源）。
- **叙拉古盟约的隐匿必须在实机里真的挡住敌人**：6 名叙拉古干员上场后，敌人的普通攻击与远程索敌都不再指向隐匿中的干员，直到他们部署后的隐匿到期。
- 固定种子下「隐匿 → 被阻挡 → 可选」的转换可重复。
- 不改动既有敌人行为：全量测试保持通过。
- 玩家能看见：隐匿单位必须有马赛克，且被反隐时特效消失。

## 六、已确认的口径

1. **干员／召唤物隐匿＝完全无法被选中**（已确认）：按 PRTS 的「不能被不同阵营选中」实现，远程与近战敌人一视同仁地不选它；正在阻挡该敌人的单位仍是合法目标。这不是「只免疫远程」。
2. **清明实现后放开随机池**（已确认，落地时按原表数据修正）：`InvisibleShield` 做完并验过后，解除它的 `complexity` 限制、在行为覆盖里显式 `randomPoolEligible:true`。原计划「纳入 INVISIBLE 词条 + 默认波次表补费用档位」被落地核对推翻：原表 `enemyInfoDict` 里清明不属于任何词条，池成员的词条归属由 `tests/native-wave-defaults.test.mjs` 强制，不能为了让它进池去改采集数据。

## 七、本批不做、留档的部分

- 迷彩（CAMOUFLAGE）的完整细则：不阻止光环／格子判定、与隐匿免疫的交互方式与隐匿不同。
  本批只保证**发放时机**正确（`applyStatus(kind:'camouflage')` 与隐匿同一条选择判定），细则仍留档。
- 「隐匿与阻挡时解除」的通用机制（原表注明该机制通常由其他 Buff 实现，不属于隐匿本身）。
- 隐匿单位对**光环类**技能是否可见：与原作一致地不受隐匿制约（光环不做选择判定），本批沿用现状、只在测试里固化。

## 八、落地结果

| 项 | 实现位置 | 口径 |
| --- | --- | --- |
| 形态自带的隐匿 | `native-battle.js` spawn 的 `formInvisible` | `invisible` 每帧由状态表重算，`initialInvisible` 敌人第 2 帧就会显形（实测山海众头目）；补 `formInvisible` 后 12 名自带隐匿的敌人才真正生效 |
| 攻击显形后重新隐匿 | `resolveEnemyStrike` / 敌人循环 | 山海众（`InvisibleCombat`）攻击时置 `formInvisible=false` 并记 `invisibleRecoverAt=+6s`，到点恢复；此前这段逻辑因上面的显形问题从未触发过 |
| 被阻挡即脱离隐匿 | `targets()`、`autoSkillWouldHit()`、法尔科内 S2 分支 | 敌人侧：`e.block!=null` 时对所有人都可选（原来只有阻挡者能打） |
| 我方隐匿 | 敌方 AI 的远程目标过滤 | `alive.filter(u=>!u.invisible&&...)`；正在阻挡该敌人的单位仍是合法目标（与敌人侧对称），光环/AoE 不受隐匿制约 |
| 反隐模型 | `native-effects.js` 的 `revealEnemy` + `syncReveals` | 反隐源只写 `e.revealUntil`，每帧末尾统一收敛成 `e.revealed`；来源消失后窗口走完自动恢复隐匿（原实现是永久置位，走出去也不撤销） |
| 银灰【鹰眼视觉】 | `periodicMods` | 攻击范围内（含技能改范围）敌人隐匿失效 |
| 伊内丝【影哨】 | `periodicMods` + `placeInesSentry` | 攻击范围内隐匿失效且移速 -30%；撤退后在原地留 1 个影哨继续生效（半径取她撤退时攻击范围的最大切比雪夫跨度） |
| 马赛克 | `drawConcealOverlay`（native-fx） | 我方／召唤物／敌人三处；灰滤镜 + 马赛克（有头像时缩到 10×10 再关插值放大），被反隐时不画，`reduceFx` 下不流动。**强度只在 `CONCEAL_STYLE` 里调**（wash 0.22 / detail 10 / block 5 / 块 α 0.28·0.22 / band 0.10）：早先的 6×6 + 0.45 灰滤镜糊到认不出人，用户要求调低，现在只做提示不做遮挡；改完要 `node scripts/build-browser.mjs` 重编 bundle |
| 清明 `InvisibleShield` | `tickEnemyInvisibleShield`（native-battle）+ `supportedSkillPrefabs` | 独立计时：`initCooldown` 5 秒首放、之后每 `cooldown` 15 秒一次，给半径 2 格（敌人自身 `rangeRadius`，原表无独立半径字段）内的**其他**敌人 5 秒隐匿（技能黑板 `duration`；天赋黑板的 `InvisibleShield.duration=3` 不是这个技能的时长），自身不获得。已解除 `complexity` 并在 `enemy-behavior-overrides.json` 显式 `randomPoolEligible:true`；原表 `enemyInfoDict` 里它不属于任何词条（只出现在固定关卡 `h07_03`），所以默认随机池没收它，编制台手工加池与固定波次可用 |
| 迷彩的发放时机 | `native-operator-effects.js`（`operatorSkillStart` / `enemy-death` / `skill-end`） | 通用分支只处理「技能开始即获得」，且跳过带「技能结束时」的文本；忍冬 S3【隐狐之艺】改成条件式：技能期间击倒过敌人才在技能结束拿到迷彩，下一次开技时由 `removeStatus` 摘掉（原实现是开技即给 10 秒，时序与条件都不对）。寒芒克洛丝的迷彩在本期卡池里取不到（她的运行时档案只有 S2【封喉】），因此没有额外分支 |
| 头顶状态图标 | `drawStatuses` / `mark`（native-fx） | `invisible`／`camouflage` 进白名单，画虚线方框（迷彩多一道对角），没有状态就不画 |

测试：`tests/native-invisibility.test.mjs`（10 例，含山海众显形周期、敌方远程不选隐匿干员、银灰/伊内丝反隐与哨位、
清明 InvisibleShield 的半径/时长/冷却/不含自身、忍冬条件式迷彩、隐匿图标、清明的随机池归属）
与 `tests/native-bonds.test.mjs` 的叙拉古用例（盟约隐匿真的挡住敌人）。
