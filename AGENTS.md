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
- **部署位（高台／地面）**：备战期 `NativeSession.canDeploy` 与位移落点 `native-effects.canRelocateTo` 共用同一条规则——地形按格子的 `heightType`／`buildableType`（`NONE` 不可部署），近战干员默认不能上 `HIGHLAND`，**但 PRTS 分支特性写「可以放置于远程位」的分支例外**：推击手／钩索师（歌蕾蒂娅、崖心、见行者等）既能下地面也能上高台，标记在 `BRANCH_POLICIES[branch].highland`＋`allowsHighlandPlacement()`，依据是 `data/prts/branch-rules.json` 的 `baseTrait`（只有这两个分支有）。本模式的 HIGHLAND 分 `HIGHLAND/RANGED`（可部署的高台，仅 m03/m06/act2 m01-02 少数几格）与 `HIGHLAND/NONE`（不可部署），所以远程干员依然允许落在地面格。**站上高台的干员不阻挡**：`resolveBlocks` 的容量函数对 `heightType==='HIGHLAND'` 的单位返回 0（高台只打不挡）。改部署规则时三个入口一起改（`canDeploy`／`canRelocateTo`／`resolveBlocks`），回归 `tests/native-deployment-placement.test.mjs`。
- **地块视觉：隔离平台必须画成「地面＋围栏」，不能抬成高台**：`tile_fence_bound` 的低地可部署格是隔离平台（地面敌人路线不经过，`passableMask` 是 `FLY_ONLY`），本质仍是地面。`protocol.tileLiftAmount` 只抬 `heightType==='HIGHLAND' && buildableType!=='NONE'`（围栏格一律不抬，格子上的单位也随之下移半格抬升量），`drawTerrain` 用 `protocol.isolatedPlatform` 判定走「地面填充 + 暖色围栏立柱 + 「隔离」角标」样式，图例多一项 `terrain-isolated`。把围栏格重新抬起来就会和真高台混在一起（用户 2026-09-19 报过）。回归：`tests/native-terrain-visual.test.mjs`。
- **难度选择的海猫模式**：`mode_cat_all` 只是 lobby 下拉里的选项，底层仍跑 `mode_single_normal`（`state.draft.cat` → `s.cat`）。它把 `s.funds` 顶到 `INFINITE_FUNDS`（`Number.MAX_SAFE_INTEGER`）让 `spend`/`upgrade`/`refresh` 的原判定全部通过；界面上一律用 `fundsMarkup()` 显示彩色 `ALL`，不要直接印 `s.funds`。**只要 `s.cat` 为真，资金就必须永远等于哨兵值**：所有资金写入只有两个入口——`PreparationState.setFunds(value)`（重置成某个值）与 `addFunds(delta)`（入账／出账），二者在 cat 模式下都不做真实加减。新增任何改资金的代码都不许直接写 `s.funds=`／`s.funds+=`，否则 `beginBattle` 的 `funds=0`、`nextRound` 的 `funds=baseFunding(round)`（都走 `setFunds`）会把无限打回普通数值——那正是「和资金类效果互动后不再是无限」的成因；`coin_carry_over` 这类算 `funds` 的策略因此也不会把值越界成 `Infinity`（存档校验要有限值）。读档时 `NativeSession.restore` 会把 cat 存档的资金重新拉回哨兵值，修掉旧存档里被写坏的数。cat 标记必须保持 `undefined` 或 `true`（存档校验只接受这两个值），别写成 `false`。回归：`tests/native-cat-funds.test.mjs`。
- **敌方小怪体型**：解压缩出来的碎片（器皿／镜／茶器／矛头一类，即 `enemyBehavior.hitCountHp` 的敌人）画面上按 `e.spriteScale`（0.6）缩小，免得和精英怪一样大。缩放必须在生成时定死：`hitCountHp` 是运行时状态，余烬／再生形态也会置真，不能拿它当缩放依据。
- **次数血条不吃战斗缩放**：`combatScale` 只作用于常规血量，`hitCountHp` 敌人的生命值就是「需要击倒的伤害次数」，生成时取原表数值、不乘倍率，否则 0.7 倍会把「2 次」变成 1.4。
- **盟约面板的「当前动态数值」必须数据驱动**：走 `protocol.bondCurrentPreviewHtml`／`bondScaledParams`，按原表的 `descParamBaseList`／`descParamPerStackList` **逐项**算出当前值并显示公式（例：叙拉古「攻速与隐匿状态的持续时间 → 46 秒（32 + 0.4 × 35层）」、谢拉格「寒风施加寒冷的持续时间 → 24 秒」）。不要再在 `native-play` 里手写 switch 数值——漏项就是这么来的（叙拉古的持续时间、谢拉格寒风时长都曾漏过）；只有「阈值／累计」类备注（资金奖励、触发次数、扩大范围阈值、闲置强化）还留在协议层的那几个特判里。`tests/native-bond-preview.test.mjs` 有一条门禁：原表声明了几项就必须渲染几项。
- **手机端盟约面板**：横屏手机 UI（`html.native-landscape-ui`）左侧的盟约竖列是 flex column，卡片必须写 `flex:0 0 auto`（`native.css` 该段内的 `.native-bonds button`）：盟约一多时靠面板自身的 `overflow-y:auto` 整体上下滚动。漏掉它 flex 会把 20 多条盟约压进可视高度，卡片从 41px 挤到 34px 以下、名字和层数叠在一格里（真浏览器复测：`node scripts/regression-browser.mjs mobile-bonds`，静态口径回归：`tests/native-mobile-layout.test.mjs`）。窄屏竖排的横向条（`@media(max-width:600px)`）仍靠 `min-width:80px` 保底宽度横向滚动，不要改成压扁。

## 敌人能力口径

- **死亡类能力只有一个入口**：死亡爆炸、死亡区域、解压缩都走 `native-effects` 的 `commitExit` → `battle.onEnemyDeath`，不要再挂在干员攻击路径上（那样被持续伤害击杀就漏触发）。生成的敌人先入队（`queueEnemySpawn`），在敌人状态结算后与战斗结束判定前各刷一次，别在遍历 `s.enemies` 时直接 push。
- **反推原表字段**：`DeadSpawn.*`、`Revive[Trigger].*`、`Atkup.atk`／`AtkUp.atk`、`shield.dynamic` 等一律从 `talentBlackboard` 取，取不到就不给这个能力，并在 `enemy-behavior-overrides.json` 里显式关闭。`aura.*` 前缀是**自身条件判定**，不是发给周围敌人的光环（真光环是 `defup.*`）。
- **放开随机池要走流程**：复杂敌人先在 `enemy-behavior-overrides.json` 里 `randomPoolEligible:false`，补完专属实现并写了定向测试后再逐条放开；`filterRandomPoolTable` 会把不合格的敌人从词条池里剔掉，没放开就等于没上场。
- **具名卡池要在 `native-session.js` 显式建表**：`drawFromPool` 只认池名，而原表（`pool_chess_glady`、`pool_char_pinus`、`pool_equip_*`）只给名字不给成员，不建表就等于按商店规则从整池抽。成员只能从效果文案或装备字段推：`members`（可带权重）、`bond`（该盟约的装备）、`any`（文案没限定，等于任意）；推不出来的宁可不做也不要编，并在表里注明依据。
- **隐匿只有一条判定**：`invisible` = 状态表（`invisible`/`camouflage`）或形态自带的 `formInvisible`，`revealed` = 反隐时间窗（`revealUntil`，每帧由 `syncReveals` 收敛）。被阻挡（`e.block!=null`）视为脱离隐匿（表现层同口径：`concealActive` 在 `actor.block!=null` 时返回 false，马赛克与头顶隐匿图标一并消失）。改索敌时三处一起改：`targets()`、`autoSkillWouldHit()`、敌方 AI 的远程选目标；反隐由 `revealEnemy` 续期，不要写回永久置位的 `e.revealed=true`。敌方隐匿技能只有两条实现路径：`InvisibleCombat` 挂在 `resolveEnemyStrike`（攻击显形），清明 `InvisibleShield` 走独立计时的 `tickEnemyInvisibleShield`（跟攻击解耦）；技能文案里带「技能结束时」的是条件式发放（忍冬 S3 迷彩），通用「开技即获得」分支必须跳过它。
- **死亡留下的持续伤害圈（DOT）口径已定**：`trigger` 为 `death`／`death-target` 的地面区域**照原表**——污染秽蚀是固定伤害（`PollutedDie.polluted_damage_low`，枯朽战士／组长 50 点 / 1 秒），毒雾是**产生者攻击力的百分比**（`1.damage_atk_scale`，蚀裂 15% / 1 秒）。照原表就不能让 `native-combat.js` 再写 `tuneDeathZone` 那类定值改写。**产生者的攻击力必须留档**：死亡圈的产生者随死亡离场，`addEnemyGroundZone` 在创建时把 `source.atk` 记进 `fx.sourceAtk`，`tickEnemyGroundZones` 优先用活着产生者的当前攻击力、否则用留档值（否则「攻击力的 15%」恒为 0——这就是当初误判成「死亡圈不掉血」的原因）。`attackZone`（火炮 150/1s、战车 50/1s）与 `selfField`（巢涌者神经损伤）照旧。**圈重叠取最高**：`NativeBattle.applyEnemyZoneDamage` 用按「排定结算时刻（`fx.nextAt`）」记账的时间窗，弱的不叠加、强的只补差额；窗口取该区域 `interval` 的 0.9 倍（下限 0.45 秒，0.9 是给反复累加留的浮点余量，免得同一片圈的下一次结算被自己吞掉），窗口戳不能用当前帧时间，否则大步补拍会被压成一拍。数字改动要同时跑 `tests/native-enemy-ground-zone.test.mjs`（含全表门禁：每个死亡圈必须且只能有一种伤害口径，以及「攻击力翻倍、每秒掉血翻倍」）。**`kind:'field'` 只能由 `native-battle.tickEnemyGroundZones` 结算**：`native-effects.tickLogic` 的通用周期调度必须跳过 field（`settlePeriodic` 没有 field 分支），否则它会先把 `nextAt` 推走却什么都不做，圈就永远等不到自己的结算点——圈画得出来、一点血都不掉（2026-09-19 报的「死后 DOT 圈无效」就是这个）。所以这块的回归必须走真实 `step()`，直接调 `tickEnemyGroundZones()` 是测不出来的。
- **卫戍效果（干员特质）的口径已定，照 `GARRISON_EFFECT_AUDIT.md` 走**：触发时间点 = 原表 `eventType`（`SERVER_GAIN` 获得时 / `SERVER_PREP_START` 进入休整期 / `SERVER_PREP_FIN` 休整期结束 / `SERVER_REFRESH_SHOP` 刷新 / `SERVER_CHESS_SOLD` 出售 / `SERVER_PRICE` 价格 / `IN_BATTLE` 作战能力）。多盟约「每叠加 N 层」= **每个盟约分别 ⌊层数/divide_num⌋ 后相加**；「核心盟约每叠加 N 层」= **8 个核心盟约的层数合计**（与该干员自身所属盟约无关）；`bond_self` = 每个已激活盟约各 +N；`bond_actived_maxstack` = 只取已激活中层数最多的那一个、并列随机；击倒计数**不含我方干员**；「每场作战至多 N 层」**按每波**重置（计数箱挂 `battle.garrisonCounters`，不要再写回 `u.counters`）。送特质（`give_garrison_to_*`）必须按 `check_bond_id` 校验，不匹配不发，每波开战前清空 `extraGarrisonIds` 并与目标已有的 garrison 去重。**卫戍文本必须带触发时机前缀**：走 `protocol.garrisonText`（有 `<获得时>` 这类原表标签就用标签，没有的按 `eventType`／能力键补），干员档案用 `<b class="native-garrison-when">` 渲染——直接 `plain(garrisonDesc)` 会把时机标签当富文本吃掉。**原表富文本统一走 `protocol.richText`**：`<@ba.vup>`／`<$ba.stun>`／`<@autochess.gray>`／`</>` 这类样式标签丢掉，`<铜灯盘>`／`<替身>`／`<寻呼模块>`／`<炎>` 这类**内容**标签里的文字必须保留（原表还有 `<在场<@autochess.dgreen>6</>名不同【炎】干员>` 这种嵌套，按尖括号配对扫描）。展示路径都用它：`native-play` 的 `plain`、`native-skill-text` 的 `plainText`、`native-wave-editor` 的敌人描述、`build-native` 烘进 `enemyIndex` 的 `desc`、**`build-protocol`（策略／敌人／盟约／装备的 `description`）与 `build-catalog`（干员技能描述）**；`replace(/<[^>]+>/g,'')` 只允许留在解析逻辑里（行为推断、文案取值、特质转发判定）。构建脚本里再写 `replace(/<[^>]+>/g,'')` 就会把「寻呼模块」「替身」这类引用名永久烘没（策略资料库曾整批丢字）。新增作战能力键必须同时更新 `GARRISON_EFFECT_AUDIT.md` 与 `tests/native-garrison-effects.test.mjs` 的键登记表（那里有一条门禁测试，未登记直接挂）。

资料：`data/prts/` 参考底库；`data/normalized/` 规范化；`data/modes/alliance-lower/` 本期包（历史提交 `86da4cfa…`）。客户端规模仍是 112 可见预设、266 养成状态、23 盟约、40 策略、215 敌人引用、376 头像。

无第三方 JS。开发 Node.js 22+；Pages 用 24。`npm run build` 只编译。`npm test` 跑 `tests/*.test.mjs`。

## 技能表现与投掷物口径

- **装备的战斗期效果集中在 `native-equipment.js`**：数据取 `u.source.equipment` → `trapChessDataDict[chessId].effectId` → `effectBuffInfoDataDict[effectId]` 的每一行，行里的符文名（黑板 `key` 的 `valueStr`，如 `act1autochess_equip_acarm045_global_buff`）是效果标识，**数值一律从黑板读**。接线点：`native-effects.dispatch` 统一转成装备事件（deploy／skill-start／skill-end／ammo／before-damage／after-damage／after-heal…）、`native-effects.tickLogic` 末尾的 `equipmentTick(battle,dt,ctx)` 跑逐帧效果（回血、成长、范围内压制、秒伤）、`native-battle.stats()` 挂统计类修正（嘲讽、再部署、生命、叠层攻击/攻速、友军攻速光环、浓缩嗅盐的逐帧 `immunities` 开关）、`native-battle.hit()` 挂命中修正（`equipWeakness` 弱点伤害、`equipMagicPenetration` 法抗穿透）、`runFatal` 里挂保命（坚固维式重锤的不死、M3茧甲的复活、骑士戒律成对的不撤退）。成对联动按行的 `equip_chess_id`／`other_equip` 的 chessId 前缀判定（`chess_item_x_y_z` 对 `_a`/`_b` 都算）。**盟约条件必须走 `isCovenant`（`economy.ownBonds(u.source)`／`battle.owns`）**：`NativeBattle` 上没有 `ownBonds`，写成 `battle.ownBonds?.(u)` 会让「若携带者为【X】盟约干员」整类效果恒不触发（铳骑之威、海沟实验体都这么漏过一轮）。盟约 id 是 `egirShip`（不是 `aegirShip`）一类，别凭印象写。改装备效果前先看 `EQUIPMENT_EFFECT_AUDIT.md` 的落地进度，别再按 key 是否出现来判断「已实现」。
- **装备效果按 key／符文逐条实现，没实现的必须登记**：原表每件装备只有一个效果 key（`trapChessDataDict[chessId].effectId` → `effectBuffInfoDataDict[id][].key`），通用数值走 `stats()` 里的 `char_attribute_mul`／`env_gbuff*` 通道，其余要在 `native-session`（备战期：销毁、发钱、发干员、升层、下回合晋升…）或 `native-battle`／`native-effects`（战斗期：属性、触发）里按 key 实现。**规则只写在描述里的必须照描述实现**，例：拟态物质 `use_equip_reward_char_chess`（黑板为空）＝「装备时销毁，若已拥有至少2名该初始干员，则再获得1名该初始干员；否则随机获得1名同盟约初始干员」，初始干员用 `chessNormalIdLookupDict` 归一化后计数（精锐形态也算同一名）。**通用通道会误吃叠层值**：`env_gbuff*` 行里的 `atk/max_hp/def/attack_speed/…` 一律当常驻属性加，而炎国短刀（atk=0.05）、有限加速器（attack_speed=1）、天师古鼎（attack_speed=25）、蒸汽之心（attack_speed=30）、骑士戒律（atk=1）这些字段其实是叠层／条件值——它们的符文名登记在 `equipGenericExcluded`，由 `native-equipment` 自己算，新增这类效果时记得一起登记。`tests/native-equipment-effects.test.mjs` 有两条门禁：外层效果 key **和 `env_gbuff` 行里的内层符文名**都必须「被逻辑引用」或「登记为待补齐」（催泪瓦斯的 `prob` 就是只查外层 key 漏掉的）。当前唯一待补齐：`act1autochess_equip_acarm058_global_buff`（催泪瓦斯的「麻痹」是层数制状态，本客户端没有层数与触发消费者，原表也不给时长）。
- **对空只有一个开关**：`NativeBattle.behavior(u).antiAir`（`native-branches.js` 的 `branchBehavior`）——普通攻击索敌（`targets()`）、技能预判、溅射/连锁的 `packet.antiAir` 都读它。分支默认值与 PRTS「分支特性信息/data」（`data/prts/branch-rules.json` 的 `runtime.antiAir`）逐条一致，别再手动改分支表；**技能级的例外写 `SKILL_ANTIAIR`**（同一文件）：依据是 PRTS 干员页技能备注的「※可对空／※不可对空」，本地快照在 `data/prts/snapshots/*/operators.json` 的 `skills[i].sourceTemplate.fields.备注`。`activate()` 开技时把覆盖记到 `u.skillAir`（带 `skillCount` 校验）：持续技在生效期内生效，瞬时／被动技没有生效期、伤害就在开启那一帧结算，所以窗口只到当前时刻。已登记：德克萨斯「剑雨」、焰尾「红松林」、忍冬「坠刃拷问」、塞雷娅「钙质化」、玛恩纳「未照耀的荣光」、缄默德克萨斯「剑雨滂沱」、锏「归于宁静」、泥岩「秽壤的血脉」、号角「照明榴弹」可对空，银灰「雪境生存法则」缩小范围后不可对空。反例也要照顾：PRTS 写「不可对空」的圈用 `values.groundOnly`（烛煌「灼烧地段」、锡人炼金单元的「地面敌人」），焰影苇草 S2 的火球与隐德来希 S3 的心烛候选各自带 `!e.flying` 过滤。回归：`tests/native-air-targeting.test.mjs`（PRTS 备注门禁 + 覆盖门禁 + 开关/索敌/伤害）。
- **带 `carrier` 的 `kind:'zone'` 是投掷物**（锡人 S1「老科利」/S2「大拉里」的炼金单元）：`native-effects.tickLogic` 每帧按 `carrier.speed` 把它移向 `carrier.toX/toY`，抵达后 `carrier.arrived=true` 停驻，到 `endsAt` 才消失；每秒结算读的就是 `fx.x/fx.y`，所以移动必须在结算之前推进。落点取 `battle.targets(u)[0]` 所在格，没有目标时按 `u.dir` 落在 `projectile_range` 处。`refKind:'live'`＝召唤物随主人退场一起消失。原表没有单元自身的半径与飞行速度字段，**半径 1.5、1 格/秒是用户 2026-09-19 口径**，`values.groundOnly` 只吃地面敌人（原表文案写「地面敌人」）。`drawZones` 在飞行途中额外画本体＋落点虚线圈，抵达后只留本体；位置只由逻辑层写。回归：`tests/native-alchemy-unit.test.mjs`、`tests/native-fx-zones.test.mjs`。

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
