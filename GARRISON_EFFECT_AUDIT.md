# 卫戍效果审计（全员）

审计日期：2026-09-19（对照 `data/modes/alliance-lower/source.json` 快照 `86da4cfa…` 与 PRTS「卫戍协议：盟约 下半/PRTS盟约记录」干员数据库）。

口径：

- **卫戍效果 = 干员特质**：数据在 `season.garrisonDataDict`，每名干员的卡（`charChessDataDict[chessId].garrisonIds`）挂 1~2 条，普通（`_a`）与精锐（`_b`）各一条。本文只审计这 112 名可见干员实际引用的条目（240 条 garrison / 252 行卡面）。
- **触发时间点**取自原表 `eventType`，并与 PRTS 干员数据库里写在描述前的尖括号标签互相印证（`<获得时>`＝`SERVER_GAIN`、`<进入休整期时>`＝`SERVER_PREP_START`、`<休整期结束时>`＝`SERVER_PREP_FIN`、`<刷新时>`＝`SERVER_REFRESH_SHOP`、`<售出时>`＝`SERVER_CHESS_SOLD`、`<战斗中>`/`<部署时>`/`<战斗开始时>`＝`IN_BATTLE`）。
- 状态口径：✅ 描述对应的数值/目标/上限都能落到代码；⚠️ 入口在但条件或时序与原表不一致；❌ 没有对应实现，等同于没生效。
- 对照实现：`dist/garrison.js`（整备期 handlers）、`dist/native-economy.js`（触发点与 `addLayers`）、`dist/native-battle.js`（作战能力 `stats()` 与 `event()`）、`dist/native-effects.js`（特质转发与部署钩子）。

## 一、触发时间点口径

| 原表 eventType | PRTS 标签 | 中文时间点 | 引擎触发点 | 备注 |
| --- | --- | --- | --- | --- |
| `SERVER_GAIN` | `<获得时>` | 拿到这张卡的那一瞬间 | `native-economy.js:58` `gain()` → `triggerGarrisons('SERVER_GAIN')` | 「无需激活盟约」的条目走 `addLayers(..., false)`；「投资人」盟约激活时整段重复 2~3 次（`native-economy.js:49`） |
| `SERVER_PREP_START` | `<进入休整期时>` | 每回合进入休整期、准备阶段开始 | `native-economy.js:88` `startPreparation()`，由 `nextRound()`（`:95`）调用 | 遍历 `s.units`（含整备区手牌），按 y→x 排序；`conditionkey='character_target_inboard'` 的条目在手牌里不触发 |
| `SERVER_PREP_FIN` | `<休整期结束时>` | 休整期结束、开战前 | `native-economy.js:91` `beginBattle()` | 先于部署/战斗开始结算 |
| `SERVER_REFRESH_SHOP` | `<刷新时>` | 本回合主动刷新商店 | `native-economy.js:78` `refresh()` | 先 `roundRefreshCount++` 再触发，所以「首次刷新」用 `refresh_cnt===1` 判定 |
| `SERVER_CHESS_SOLD` | `<售出时>` | 出售该干员时 | `native-economy.js:80` `sell()`（`super.sell` 之后） | 噬魂兽乐队的「出售换商店」提前返回时不触发 |
| `SERVER_PRICE` | 无标签 | 计算购买价格时 | `native-economy.js:65` `price()` | 直接取 handler 的返回值 |
| `IN_BATTLE` | `<战斗中>` / `<部署时>` / `<战斗开始时>` | 作战能力：开战/部署时绑定，战斗中按事件结算 | 常驻加成 `native-battle.js:181`；特质转发 `native-effects.js:498`（`bondBattleStart`）；部署卫戍 `native-effects.js:844`；战斗中事件 `native-battle.js:411` `event(u,event)` | `event()` 只认 `kill`(selfkillenemy) / `skill` / `deploy`(born\|deploy\|onstart) / `selfdead` / `ammo`(consume_ammo) 五种时机 |

## 二、逐干员清单

对照口径：本地可见集 = `charShopChessDatas[x].isHidden===false && chessType!=='DIY'`，共 **112 名**。
PRTS「卫戍协议：盟约 下半/PRTS盟约记录」干员数据库（section 8）共 115 条：112 名与本集重合，
多出的 3 条是 **蜜蜡**、**瑰盐**、**盟约·辅助干员**——本地都有卡但 `isHidden:true`，不在本期 112 人内。

时机对照结论：**92 条带尖括号时机标签的干员里 90 条与本地 `eventType` 一一对应**，剩 2 条正是上面不在本期的蜜蜡与瑰盐。
PRTS 把「两个时机」写在同一行的（砾 `<部署时><被击倒时>`、寒檀 `<进入休整期时><休整期结束时>`、锏 `<获得时><部署时>`、
荒芜拉普兰德 普通/精锐不同时机），本地原表都拆成了两条 `garrisonIds` 并各自触发，没有只实现一半的情况。
数值与上限（`每场作战至多 N 层`／`每回合至多 N 层`／`同一行 3 名干员`／各档数值）逐条与 PRTS 一致；
差异集中在「本地 `garrisonDesc` 不含 PRTS 的灰色注记（如※仅在每次部署时判定）」与「原表把一个效果拆成多条条目」。

<!-- TABLE-START -->

### 获得时（`SERVER_GAIN`，`native-economy.js:58` gain → triggerGarrisons）

| 干员 | 卫戍效果（普通 / 精锐） | 触发时间点 | 实现位置 | 状态 / 缺口 |
| --- | --- | --- | --- | --- |
| 艾丝黛尔 | 自身所属盟约层数+2（无需激活盟约） ／ 自身所属盟约层数+4（无需激活盟约） | 获得时 | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜无额外条件 | ✅ |
| 灰毫 | 当前激活且层数最多的盟约层数+3 ／ 当前激活且层数最多的盟约层数+6 | 获得时 | garrison.js `SERVER_ADD_BOND_ACTIVATED_MOST_LAYER`｜无额外条件 | ⚠️ 「层数最多」并列时随机取一个（无原表依据）
| 锏 | 自身所属盟约层数+8（无需激活盟约） ／ 自身所属盟约层数+16（无需激活盟约） | 获得时 | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜无额外条件 | ✅ |
| 角峰 | 自身所属盟约层数+2（无需激活盟约） ／ 自身所属盟约层数+4（无需激活盟约） | 获得时 | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜无额外条件 | ✅ |
| 惊蛰 | 获得等于当前调度中心等级的【炎】层数（无需激活盟约） ／ 获得等于两倍的当前调度中心等级的【炎】层数（无需激活盟约） | 获得时 | garrison.js `SERVER_ADD_BOND_METHOD`｜无额外条件 | ✅ |
| 卡涅利安 | 获得1件“迅捷作战粮” ／ 获得2件“迅捷作战粮” | 获得时 | garrison.js `SERVER_GAIN_EQUIP`｜无额外条件 | ✅ |
| 灵知 | 自身所属盟约层数+5（无需激活盟约） ／ 自身所属盟约层数+10（无需激活盟约） | 获得时 | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜无额外条件 | ✅ |
| 录武官 | 【炎】层数+6、【奇迹】层数+3（无需激活盟约） ／ 【炎】层数+12、【奇迹】层数+6（无需激活盟约） | 获得时 | garrison.js `SERVER_ADD_MULTIPLE_BOND`｜无额外条件 | ✅ |
| 洛洛 | 随机制造1件洛洛的定制品 ／ 随机制造2件洛洛的定制品 | 获得时 | garrison.js `SERVER_POOL_EQUIP`｜无额外条件 | ⚠️ 直接进手牌，没有「候选三选一」（口径待确认）
| 缪尔赛思 | 获得1个“变形同构体” ／ 获得2个“变形同构体” | 获得时 | garrison.js `SERVER_GAIN_EQUIP`｜无额外条件 | ✅ |
| 能天使 | 使下个休整期额外获得1资金 ／ 使下个休整期额外获得2资金 | 获得时 | garrison.js `SERVER_ONCE_GOLD`｜无额外条件 | ✅ |
| 普罗旺斯 | 获得1次免费刷新 ／ 获得2次免费刷新 | 获得时 | garrison.js `SERVER_GAIN_FREE_REFRESH_COUNT`｜无额外条件 | ✅ |
| 忍冬 | 自身所属盟约层数+6（无需激活盟约） ／ 自身所属盟约层数+12（无需激活盟约） | 获得时 | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜无额外条件 | ✅ |
| 深靛 | 自身所属盟约层数+2（无需激活盟约） ／ 自身所属盟约层数+4（无需激活盟约） | 获得时 | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜无额外条件 | ✅ |
| 诗怀雅 | 获得1个“盟约之币” ／ 获得2个“盟约之币” | 获得时 | garrison.js `SERVER_GAIN_EQUIP`｜无额外条件 | ✅ |
| 新约能天使 | 使下个休整期额外获得2资金 ／ 使下个休整期额外获得4资金 | 获得时 | garrison.js `SERVER_ONCE_GOLD`｜无额外条件 | ✅ |
| 星熊 | 自身所属盟约层数+8（无需激活盟约） ／ 自身所属盟约层数+16（无需激活盟约） | 获得时 | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜无额外条件 | ✅ |
| 雪猎 | 自身所属盟约层数+5（无需激活盟约） ／ 自身所属盟约层数+10（无需激活盟约） | 获得时 | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜无额外条件 | ✅ |
| 焰尾 | 获得1个野鬃或灰毫，小概率获得远牙 ／ 获得2个野鬃或灰毫，小概率获得远牙 | 获得时 | garrison.js `SERVER_POOL_CHAR`｜无额外条件 | ⚠️ 直接进手牌，没有「候选三选一」（口径待确认）
| 耶拉 | 获得1件“谢拉格不融冰” ／ 获得2件“谢拉格不融冰” | 获得时 | garrison.js `SERVER_GAIN_EQUIP`｜无额外条件 | ✅ |
| 野鬃 | 自身所属盟约层数+2（无需激活盟约） ／ 自身所属盟约层数+4（无需激活盟约） | 获得时 | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜无额外条件 | ✅ |
| 烛煌 | 【炎】【维多利亚】层数+5（无需激活盟约） ／ 【炎】【维多利亚】层数+10（无需激活盟约） | 获得时 | garrison.js `SERVER_ADD_BOND`｜无额外条件 | ✅ |

### 进入休整期时 / 准备阶段开始（`SERVER_PREP_START`，`native-economy.js:88` startPreparation）

| 干员 | 卫戍效果（普通 / 精锐） | 触发时间点 | 实现位置 | 状态 / 缺口 |
| --- | --- | --- | --- | --- |
| 白面鸮 | 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 | 进入休整期时（准备阶段开始） | garrison.js `SERVER_FRONT_SAME_EFFECT_PREP_START`｜无额外条件 | ✅ |
| 蒂比 | 使自身已激活的盟约层数+2 ／ 使自身已激活的盟约层数+4 | 进入休整期时（准备阶段开始） | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜需在场（runGarrison 判 position） | ✅ |
| 歌蕾蒂娅 | 若同一行有3名干员，获得1个斯卡蒂、幽灵鲨或深巡 ／ 若同一行有3名干员，获得1个斯卡蒂、幽灵鲨或深巡，重复2次 | 进入休整期时（准备阶段开始） | garrison.js `SERVER_POOL_CHAR`｜需同一行 3 人 | ⚠️ 直接进手牌，没有「候选三选一」（口径待确认）
| 寒檀 | 使已激活的【远见】层数+4 ／ 使已激活的【远见】层数+8 | 进入休整期时（准备阶段开始） | garrison.js `SERVER_ADD_BOND`｜需在场（runGarrison 判 position） | ✅ |
| 赫默 | 使自身已激活的盟约层数+2 ／ 使自身已激活的盟约层数+4 | 进入休整期时（准备阶段开始） | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜需在场（runGarrison 判 position） | ✅ |
| 缄默德克萨斯 | 获得1次免费刷新 ／ 获得2次免费刷新 | 进入休整期时（准备阶段开始） | garrison.js `SERVER_GAIN_FREE_REFRESH_COUNT`｜需在场（runGarrison 判 position） | ✅ |
| 凯瑟琳 | 若当前为奇数回合，获得1件随机装备 ／ 若当前为奇数回合，获得2件随机装备 | 进入休整期时（准备阶段开始） | garrison.js `SERVER_GAIN_RANDOM_EQUIP_CHESS_IN_POOL`｜需在场（runGarrison 判 position） | ✅ |
| 空弦 | 使自身及身前一格干员的已激活盟约分别各层数+3 ／ 使自身及身前一格干员的已激活盟约分别各层数+6 | 进入休整期时（准备阶段开始） | garrison.js `SERVER_ADD_BOND_POSITION`｜需在场（runGarrison 判 position） | ✅ |
| 铃兰 | 触发身前一格的其他干员的“获得时”类效果 ／ 触发身前两格的其他干员的“获得时”类效果 | 进入休整期时（准备阶段开始） | garrison.js `SERVER_TRIGGER_ANOTHER`｜需在场（runGarrison 判 position） | ✅ |
| 佩佩 | 获得1件“盟约之币”或“萨尔贡浓茶”，有小概率发现“黄沙罗盘” ／ 获得2件“盟约之币”或“萨尔贡浓茶”，有概率发现“黄沙罗盘” | 进入休整期时（准备阶段开始） | garrison.js `SERVER_POOL_EQUIP`｜需在场（runGarrison 判 position） | ⚠️ 直接进手牌，没有「候选三选一」（口径待确认）
| 余 | 若同一行有3名干员，随机获得1名当前人数最多盟约的干员 ／ 随机获得1名当前人数最多盟约的干员 | 进入休整期时（准备阶段开始） | garrison.js `SERVER_MOST_BOND`｜需同一行 3 人 | ⚠️ 多写了 `excludeCharId`（自身除外），描述无此限定

### 休整期结束时 / 开战前（`SERVER_PREP_FIN`，`native-economy.js:91` beginBattle）

| 干员 | 卫戍效果（普通 / 精锐） | 触发时间点 | 实现位置 | 状态 / 缺口 |
| --- | --- | --- | --- | --- |
| 阿罗玛 | 本回合每刷新过1次，使已激活的【叙拉古】【奥术】层数+2（至多6层） ／ 本回合每刷新过1次，使已激活的【叙拉古】【奥术】层数+4（每回合至多12层） | 休整期结束时（开战前） | garrison.js `SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER`｜需在场（runGarrison 判 position） | ❌ 「每回合至多 N 层」未实现（`garrison.js:32` 只当单次上限，实测可无限叠）
| 安洁莉娜 | 本回合每刷新过1次，使已激活的【叙拉古】层数+4（每回合至多12层） ／ 本回合每刷新过1次，使已激活的【叙拉古】层数+8（每回合至多24层） | 休整期结束时（开战前） | garrison.js `SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER`｜需在场（runGarrison 判 position） | ❌ 「每回合至多 N 层」未实现（`garrison.js:32` 只当单次上限，实测可无限叠）
| 薄绿 | 场上每有1名不同阶的【维多利亚】干员，使已激活的【维多利亚】层数+2 ／ 场上每有1名不同阶的【维多利亚】干员，使已激活的【维多利亚】层数+4 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_METHOD`｜需在场（runGarrison 判 position） | ✅ |
| 波登可 | 当前激活且层数最多的盟约层数+1，此干员在整备区时也有效 ／ 当前激活且层数最多的盟约层数+2，此干员在整备区时也有效 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_ACTIVATED_MOST_LAYER`｜无额外条件 | ⚠️ 「层数最多」并列时随机取一个（无原表依据）
| 刺玫 | 使已激活的【维多利亚】层数+1 ／ 使已激活的【维多利亚】层数+2 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND`｜需在场（runGarrison 判 position） | ✅ |
| 调香师 | 当前激活且层数最多的盟约层数+2，此干员在整备区时也有效 ／ 当前激活且层数最多的盟约层数+4，此干员在整备区时也有效 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_ACTIVATED_MOST_LAYER`｜无额外条件 | ⚠️ 「层数最多」并列时随机取一个（无原表依据）
| 断崖 | 使自身及身后一格干员的已激活盟约分别各层数+3 ／ 使自身及身后一格干员的已激活盟约分别各层数+6 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_POSITION`｜需在场（runGarrison 判 position） | ✅ |
| 寒檀 | 使已激活的【远见】层数+4 ／ 使已激活的【远见】层数+8 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND`｜需在场（runGarrison 判 position） | ✅ |
| 号角 | 当前已激活且层数最多的盟约每有1名不同阶干员在场，层数+2 ／ 当前已激活且层数最多的盟约每有1名不同阶干员在场，层数+4 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER`｜需在场（runGarrison 判 position） | ⚠️ 「不同阶干员」只数该盟约成员；并列随机
| 莱恩哈特 | 使自身已激活的盟约层数+5 ／ 使自身已激活的盟约层数+10 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜需在场（runGarrison 判 position） | ✅ |
| 雷蛇 | 使已激活的【不屈】层数+1 ／ 使已激活的【不屈】层数+2 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND`｜需在场（runGarrison 判 position） | ✅ |
| 琳琅诗怀雅 | 使下个休整期额外获得1资金（若已激活【炎】/【投资人】此特质在整备区也有效） ／ 使下个休整期额外获得2资金（若已激活【炎】/【投资人】此特质在整备区也有效） | 休整期结束时（开战前） | garrison.js `SERVER_ONCE_GOLD_WITH_BOND_CONDITION`｜无额外条件 | ✅ |
| 流明 | 整备区中每名干员所在的已激活盟约分别层数+2 ／ 整备区中每名干员所在的已激活盟约分别层数+4 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_IN_HAND`｜需在场（runGarrison 判 position） | ✅ |
| 妮芙 | 整备区每有1个干员，使已激活的【迅捷】层数+2 ／ 整备区每有1个干员，使已激活的【迅捷】层数+4 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_METHOD`｜需在场（runGarrison 判 position） | ✅ |
| 塞雷娅 | 身前一格干员若为“休整期结束时”特质，本干员的特质与其相同 | 休整期结束时（开战前） | garrison.js `SERVER_FRONT_SAME_EFFECT_PREP_FIN`｜无额外条件 | ✅ |
| 山 | 本回合每获得过1名干员，使已激活的【投资人】层数+1 ／ 本回合每获得过1名干员，使已激活的【投资人】层数+2 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_METHOD`｜需在场（runGarrison 判 position） | ✅ |
| 蛇屠箱 | 同一行每有1名干员，使已激活的【坚守】层数+1 ／ 同一行每有1名干员，使已激活的【坚守】层数+2 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_METHOD`｜需在场（runGarrison 判 position） | ✅ |
| 溯光星源 | 本回合每花费3资金，使已激活的【灵巧】【奥术】层数+2 ／ 本回合每花费3资金，使已激活的【灵巧】【奥术】层数+4 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_ROUND_COIN_COST`｜需在场（runGarrison 判 position） | ✅ |
| 维娜·维多利亚 | 场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+3/【奇迹】层数+2 ／ 场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+6/【奇迹】层数+4 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_METHOD`｜需在场（runGarrison 判 position） | ✅ |
| 维娜·维多利亚 | 场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+3/【奇迹】层数+2 ／ 场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+6/【奇迹】层数+4 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_METHOD`｜需在场（runGarrison 判 position） | ✅ |
| 夕 | 当前休整期每获得过一名干员，使已激活的【炎】【奥术】层数+2 ／ 当前休整期每获得过一名干员，使已激活的【炎】【奥术】层数+4 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_METHOD`｜需在场（runGarrison 判 position） | ✅ |
| 小满 | 本回合每获得过1名干员，使已激活的【炎】层数+1 ／ 本回合每获得过1名干员，使已激活的【炎】层数+2 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_METHOD`｜需在场（runGarrison 判 position） | ✅ |
| 伊内丝 | 使自身已激活的盟约层数+5 ／ 使自身已激活的盟约层数+10 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_CHESS_ALL`｜需在场（runGarrison 判 position） | ✅ |
| 引星棘刺 | 使自身及身前一格干员的已激活盟约分别各层数+4 ／ 使自身及身前一格干员的已激活盟约分别各层数+8 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND_POSITION`｜需在场（runGarrison 判 position） | ✅ |
| 折桠 | 使已激活的【坚守】层数+4 ／ 使已激活的【坚守】层数+8 | 休整期结束时（开战前） | garrison.js `SERVER_ADD_BOND`｜需在场（runGarrison 判 position） | ✅ |

### 刷新商店时（`SERVER_REFRESH_SHOP`，`native-economy.js:78` refresh）

| 干员 | 卫戍效果（普通 / 精锐） | 触发时间点 | 实现位置 | 状态 / 缺口 |
| --- | --- | --- | --- | --- |
| 拉普兰德 | 若为本回合首次主动刷新，使已激活的【叙拉古】层数+4，此干员在整备区时也有效 ／ 若为本回合首次主动刷新，使已激活的【叙拉古】层数+8，此干员在整备区时也有效 | 本回合刷新商店时 | garrison.js `SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT`｜无额外条件 | ✅ |

### 出售时（`SERVER_CHESS_SOLD`，`native-economy.js:80` sell）

| 干员 | 卫戍效果（普通 / 精锐） | 触发时间点 | 实现位置 | 状态 / 缺口 |
| --- | --- | --- | --- | --- |
| 德克萨斯 | 获得1次免费刷新 ／ 获得2次免费刷新 | 出售该干员时 | garrison.js `SERVER_GAIN_FREE_REFRESH_COUNT`｜无额外条件 | ⚠️ 噬魂兽出售分支提前 `return` 时漏触发
| 格雷伊 | 进入下个休整期额外获得1资金 ／ 进入下个休整期额外获得2资金 | 出售该干员时 | garrison.js `SERVER_ONCE_GOLD`｜无额外条件 | ⚠️ 噬魂兽出售分支提前 `return` 时漏触发
| 泥岩 | 进入下个休整期额外获得2资金 ／ 进入下个休整期额外获得4资金 | 出售该干员时 | garrison.js `SERVER_ONCE_GOLD`｜无额外条件 | ⚠️ 噬魂兽出售分支提前 `return` 时漏触发
| 松果 | 进行一次I阶干员的免费特殊招募 / 本干员合成为精锐状态后，上述特殊招募变为V阶干员 ／ 进行一次V阶干员的免费特殊招募 | 出售该干员时 | garrison.js SERVER_SELL_CHESS_GAIN_SPECIAL_GOODS｜无额外条件 | ⚠️ 走 rewardFromPool 三选一；但池名靠 shop_(\d) 正则解释，未在 NAMED_POOLS 显式建表 |

### 购买价格（`SERVER_PRICE`，`native-economy.js:65` price）

| 干员 | 卫戍效果（普通 / 精锐） | 触发时间点 | 实现位置 | 状态 / 缺口 |
| --- | --- | --- | --- | --- |
| 至简 | 购买价格为1 | 计算购买价格时 | garrison.js `SERVER_CHESS_PRICE`｜无额外条件 | ✅ |

### 作战能力（`IN_BATTLE`：部署/开战时绑定 `native-battle.js:181`、`native-effects.js:498/844`，战斗中事件走 `native-battle.js:411`）

| 干员 | 卫戍效果（普通 / 精锐） | 触发时间点 | 实现位置 | 状态 / 缺口 |
| --- | --- | --- | --- | --- |
| 百炼嘉维尔 | 开启技能时，使已激活的【萨尔贡】层数+9 ／ 开启技能时，使已激活的【萨尔贡】层数+18 | 作战能力（战斗中） | native-battle.js:411 skill 分支 | ✅ |
| 仇白 | 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升1% ／ 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升2% | 作战能力（战斗中） | 无对应代码（全仓只出现数据） | ❌ |
| 初雪 | 每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+1 ／ 每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+2 | 作战能力（战斗中） | 无对应代码（没有「敌人进入冻结」事件） | ❌ |
| 纯烬艾雅法拉 | 开启技能时，当前已激活且层数最多的盟约层数+3 ／ 开启技能时，当前已激活且层数最多的盟约层数+6 | 作战能力（战斗中） | native-battle.js:411 无 bond_id 时回退 `ownBonds(u)`，未取「层数最多的已激活盟约」，也未处理 by_charcount_samerow | ❌ |
| 伺夜 | 造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+2、【奇迹】层数+1 ／ 造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+4、【奇迹】层数+2 | 作战能力（战斗中） | native-battle.js:411 kill 分支（check_cnt/max_add_count_per_battle） | ✅ |
| 伺夜 | 【152】造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+2、【奇迹】层数+1 ／ 【152】造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+4、【奇迹】层数+2 | 作战能力（战斗中） | native-battle.js:411 kill 分支（check_cnt/max_add_count_per_battle） | ✅ |
| 伺夜 | 造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） | 作战能力（战斗中） | native-battle.js:428 弱点伤害分支 | ✅ |
| 菲莱 | 开启技能时，使已激活的【萨尔贡】层数+6 ／ 开启技能时，使已激活的【萨尔贡】层数+12 | 作战能力（战斗中） | native-battle.js:411 skill 分支 | ✅ |
| 风笛 | 前3次击倒敌人时，使已激活的【维多利亚】【远见】【不屈】层数+2 ／ 前3次击倒敌人时，使已激活的【维多利亚】【远见】【不屈】层数+4 | 作战能力（战斗中） | native-battle.js:411 kill 分支（check_cnt/max_add_count_per_battle） | ✅ |
| 风丸 | 只需2个相同的本干员即可合成精锐 | 作战能力（战斗中） | 数据自身编码（风丸 upgradeNum=2） | ✅ |
| 古米 | 技力自然恢复速度+0.15/秒 ／ 技力自然恢复速度+0.3/秒 | 作战能力（战斗中） | native-battle.js:181 `sp_recovery_per_sec` | ✅ |
| 归溟幽灵鲨 | 自身被击倒或替身与本体进行切换时，使已激活的【阿戈尔】层数+5、【不屈】层数+5 ／ 自身被击倒或替身与本体进行切换时，使已激活的【阿戈尔】层数+10、【不屈】层数+10 | 作战能力（战斗中） | native-battle.js:411 selfdead 分支；native-effects.js:154 只在 reason=knockdown 触发 | ⚠️ |
| 哈洛德 | 攻击力和生命值+20%；核心盟约每叠加3层，本干员攻击力和生命值+1% ／ 攻击力和生命值+40%；核心盟约每叠加3层，本干员攻击力和生命值+2% | 作战能力（战斗中） | native-battle.js:181 只读单键 `l[bond_id]`，多盟约 `bond_id` 取不到层数 | ❌ |
| 哈洛德 | 攻击力和生命值+20% ／ 攻击力和生命值+40% | 作战能力（战斗中） | native-battle.js:181 `mul(atk/maxHp)` | ✅ |
| 海霓 | 首次击倒敌人或我方干员时，使已激活的【阿戈尔】【奥术】层数+3 ／ 首次击倒敌人或我方干员时，使已激活的【阿戈尔】【奥术】层数+6 | 作战能力（战斗中） | native-battle.js:411 kill 分支（check_cnt/max_add_count_per_battle） | ✅ |
| 寒芒克洛丝 | 使身前一格干员获得特质“开启技能时使已激活【精准】层数+1”（每场战斗至多10层） ／ 使身前一格干员获得特质“开启技能时使已激活【精准】层数+2”（每场战斗至多20层） | 作战能力（战斗中） | native-effects.js:498 转发生效，赠予 garrison_96_a（✅：native-battle.js:411 skill 分支） | ✅ |
| 华法琳 | 使身前一格干员获得特质“开启技能时使自身所属已激活盟约层数+1”（每场战斗至多7层） ／ 使身前一格干员获得特质“开启技能时使自身所属已激活盟约层数+2”（每场战斗至多14层） | 作战能力（战斗中） | native-effects.js:498 转发生效，赠予 garrison_95_a（✅：native-battle.js:411 skill 分支） | ✅ |
| 荒芜拉普兰德 | 击倒敌人时，使已激活的【叙拉古】层数+2 / 将荒芜拉普兰德合成为精锐即可在战斗中使所有【叙拉古】干员获得该效果 ／ 使所有【叙拉古】干员获得特质“击倒敌人时，使已激活的【叙拉古】层数+2” | 作战能力（战斗中） | native-battle.js:411 kill 分支（check_cnt/max_add_count_per_battle） | ✅ |
| 锏 | 自身所属的盟约层数+8 / 使自身已激活的盟约层数+8（至多24层） ／ 自身所属的盟约层数+16 / 使自身已激活的盟约层数+16（至多48层） | 作战能力（战斗中） | native-battle.js:417 部署时 `this.event(u,'deploy')` | ✅ |
| 蕾缪安 | 自身每消耗10发子弹，若同一行有3名干员，使已激活的【拉特兰】【精准】层数+2 ／ 自身每消耗10发子弹，若同一行有3名干员，使已激活的【拉特兰】【精准】层数+4 | 作战能力（战斗中） | native-battle.js:411 不判定 conditionkey（同一行 3 名干员） | ⚠️ |
| 砾 | 使已激活的【卡西米尔】层数+1 / 使已激活的【不屈】层数+2 ／ 使已激活的【卡西米尔】层数+2 / 使已激活的【不屈】层数+4 | 作战能力（战斗中） | native-battle.js:411 selfdead 分支；native-effects.js:154 只在 reason=knockdown 触发 | ⚠️ 「被击倒时」只在 knockdown 触发（漏怪/技能退场不触发）；部署那一半由 garrison_143 覆盖 |
| 砾 | 使已激活的【卡西米尔】层数+1 ／ 使已激活的【卡西米尔】层数+2 | 作战能力（战斗中） | native-battle.js:417 部署时 `this.event(u,'deploy')` | ✅ |
| 凛御银灰 | 使身前一格【谢拉格】干员获得特质“范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+1” ／ 使身前一格【谢拉格】干员获得特质“范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+2” | 作战能力（战斗中） | native-effects.js:498 转发生效，赠予 garrison_29_a（❌：无对应代码（没有「敌人进入冻结」事件）） | ❌ |
| 流星 | 攻击力和生命值+25%，造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） ／ 攻击力和生命值+50%，造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） | 作战能力（战斗中） | native-battle.js:181 `mul(atk/maxHp)` | ✅ |
| 流星 | 造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） | 作战能力（战斗中） | native-battle.js:428 弱点伤害分支 | ✅ |
| 玛恩纳 | 【卡西米尔】每叠加5层，本干员部署后100秒内基础攻击力+10、基础生命值+50 ／ 【卡西米尔】每叠加5层，本干员部署后100秒内基础攻击力+20、基础生命值+100 | 作战能力（战斗中） | native-effects.js:844 部署卫戍 garrisonDeployBuff | ✅ |
| 迷迭香 | 攻击力和生命值+20%；核心盟约每叠加3层，本干员攻击力和生命值+1% ／ 攻击力和生命值+40%；核心盟约每叠加3层，本干员攻击力和生命值+2% | 作战能力（战斗中） | native-battle.js:181 只读单键 `l[bond_id]`，多盟约 `bond_id` 取不到层数 | ❌ |
| 迷迭香 | 攻击力和生命值+20% ／ 攻击力和生命值+40% | 作战能力（战斗中） | native-battle.js:181 `mul(atk/maxHp)` | ✅ |
| 魔王 | 战斗中当本干员身前一格的干员因特质使层数提升时，使其额外层数+1 ／ 战斗中当本干员身前一格的干员因特质使层数提升时，使其额外层数+2 | 作战能力（战斗中） | 无对应代码（身前一格特质叠层时额外+N 未实现） | ❌ |
| 莫斯提马 | 自身周围4格的干员每消耗6发弹药，使已激活的【拉特兰】层数+1 ／ 自身周围4格的干员每消耗6发弹药，使已激活的【拉特兰】层数+2 | 作战能力（战斗中） | native-battle.js:487 只在消耗者自身触发 `ammo`，没有「周围4格干员消耗」的转发 | ❌ |
| 泡泡 | 【萨尔贡】【坚守】每叠加3层，本干员防御力+1% ／ 【萨尔贡】【坚守】每叠加3层，本干员防御力+2% | 作战能力（战斗中） | native-battle.js:181 只读单键 `l[bond_id]`，多盟约 `bond_id` 取不到层数 | ❌ |
| 莎草 | 首次开启技能时，使已激活的【萨尔贡】层数+5 ／ 首次开启技能时，使已激活的【萨尔贡】层数+10 | 作战能力（战斗中） | native-battle.js:411 skill 分支 | ✅ |
| 深巡 | 攻击海怪敌人时攻击力提升至150% ／ 攻击海怪敌人时攻击力提升至200% | 作战能力（战斗中） | 无对应代码（check_tag 未使用） | ❌ |
| 圣聆初雪 | 【谢拉格】【奥术】每叠加3层，本干员攻击力+1% ／ 【谢拉格】【奥术】每叠加3层，本干员攻击力+2% | 作战能力（战斗中） | native-battle.js:181 只读单键 `l[bond_id]`，多盟约 `bond_id` 取不到层数 | ❌ |
| 圣约送葬人 | 自身每消耗7发子弹，使已激活的【拉特兰】层数+7、【远见】层数+3（每场战斗分别至多触发7次） ／ 自身每消耗7发子弹，使已激活的【拉特兰】层数+14、【远见】层数+6（每场战斗至多触发7次） | 作战能力（战斗中） | native-battle.js:487 `this.event(u,'ammo')` | ✅ |
| 圣约送葬人 | 【23】自身每消耗7发子弹，使已激活的【拉特兰】层数+7、【远见】层数+3（【远见】每场战斗至多21层） ／ 【23】自身每消耗7发子弹，使已激活的【拉特兰】层数+14、【远见】层数+6（【远见】每场战斗至多42层） | 作战能力（战斗中） | native-battle.js:487 `this.event(u,'ammo')` | ✅ |
| 史尔特尔 | 使已激活的【突袭】层数+8（每场作战至多50层） ／ 使已激活的【突袭】层数+16（每场作战至多100层） | 作战能力（战斗中） | native-battle.js:417 部署时 `this.event(u,'deploy')` | ✅ |
| 水月 | 【阿戈尔】每叠加3层，本干员攻击力+1% ／ 【阿戈尔】每叠加3层，本干员攻击力+2% | 作战能力（战斗中） | native-battle.js:181 只实现 attack_speed，未读 atk | ❌ |
| 斯卡蒂 | 每击倒2名单位时，使已激活的【阿戈尔】【坚守】【突袭】层数+1 ／ 每击倒2名敌人时，使已激活的【阿戈尔】【坚守】【突袭】层数+2 | 作战能力（战斗中） | native-battle.js:411 kill 分支（check_cnt/max_add_count_per_battle） | ✅ |
| 送葬人 | 首次击倒敌人时，使已激活的【精准】【拉特兰】层数+3 ／ 首次击倒敌人时，使已激活的【精准】【拉特兰】层数+6 | 作战能力（战斗中） | native-battle.js:411 kill 分支（check_cnt/max_add_count_per_battle） | ✅ |
| 塑心 | 开启技能时，同一行每有1名干员，当前已激活且层数最多的盟约层数+1（每场作战至多10层） ／ 开启技能时，同一行每有1名干员，当前已激活且层数最多的盟约层数+2（每场作战至多20层） | 作战能力（战斗中） | native-battle.js:411 无 bond_id 时回退 `ownBonds(u)`，未取「层数最多的已激活盟约」，也未处理 by_charcount_samerow | ❌ |
| 缇缇 | 每当范围内有敌人或干员进入沉睡或晕眩时，使已激活的【萨尔贡】【精准】层数+1（每场战斗至多24层） ／ 每当范围内有敌人或干员进入沉睡或晕眩时，使已激活的【萨尔贡】【精准】层数+2（每场战斗至多48层） | 作战能力（战斗中） | 无对应代码（没有「范围内进入沉睡/晕眩」事件） | ❌ |
| 乌尔比安 | 【阿戈尔】每叠加2层，本干员攻击力+1% ／ 【阿戈尔】每叠加2层，本干员攻击力+2% | 作战能力（战斗中） | native-battle.js:181 只实现 attack_speed，未读 atk | ❌ |
| 锡人 | 攻击力和生命值+20%；【投资人】【迅捷】每叠加3层，本干员攻击力和生命值+1% ／ 攻击力和生命值+40%；【投资人】【迅捷】每叠加3层，本干员攻击力和生命值+2% | 作战能力（战斗中） | native-battle.js:181 只读单键 `l[bond_id]`，多盟约 `bond_id` 取不到层数 | ❌ |
| 锡人 | 攻击力和生命值+20% ／ 攻击力和生命值+40% | 作战能力（战斗中） | native-battle.js:181 `mul(atk/maxHp)` | ✅ |
| 瑕光 | 使自身已激活的盟约层数+4（每场作战至多12层） ／ 使自身已激活的盟约层数+8（每场作战至多24层） | 作战能力（战斗中） | native-battle.js:417 部署时 `this.event(u,'deploy')` | ✅ |
| 信仰搅拌机 | 【拉特兰】【坚守】每叠加3层，本干员防御力+1% ／ 【拉特兰】【坚守】每叠加3层，本干员防御力+2% | 作战能力（战斗中） | native-battle.js:181 只读单键 `l[bond_id]`，多盟约 `bond_id` 取不到层数 | ❌ |
| 休谟斯 | 每击倒2名敌人时，使已激活的【突袭】层数+1 ／ 每击倒2名敌人，使已激活的【突袭】层数+2 | 作战能力（战斗中） | native-battle.js:411 kill 分支（check_cnt/max_add_count_per_battle） | ✅ |
| 宴 | 造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） | 作战能力（战斗中） | native-battle.js:428 弱点伤害分支 | ✅ |
| 焰影苇草 | 【维多利亚】每叠加3层，本干员攻击速度+1 ／ 【维多利亚】每叠加3层，本干员攻击速度+2 | 作战能力（战斗中） | native-battle.js:181 attack_speed×⌊层数/divide_num⌋ | ✅ |
| 耀骑士临光 | 使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，本干员再部署时间-1.5%，攻击速度+0.5” ／ 使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，本干员再部署时间-3%，攻击速度+1” | 作战能力（战斗中） | native-effects.js:498 转发生效，赠予 garrison_144_a（✅：native-battle.js:181 `base.respawnTime*=1+respawn_time×⌊层数/divide_num⌋`） | ✅ |
| 耀骑士临光 | 【145】【卡西米尔】每叠加3层，本干员再部署时间-1.5%，攻击速度+0.5 ／ 【卡西米尔】每叠加3层，本干员再部署时间-3%，攻击速度+1 | 作战能力（战斗中） | native-battle.js:181 `base.respawnTime*=1+respawn_time×⌊层数/divide_num⌋` | ✅ |
| 耀骑士临光 | 【145】【卡西米尔】每叠加3层，本干员攻击速度+0.5 ／ 【145】【卡西米尔】每叠加3层，本干员攻击速度+1 | 作战能力（战斗中） | native-battle.js:181 attack_speed×⌊层数/divide_num⌋ | ✅ |
| 耀骑士临光 | 【145】使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，攻击速度+0.5” ／ 【145】使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，攻击速度+1” | 作战能力（战斗中） | native-effects.js:498 转发生效，赠予 garrison_159_a（✅：native-battle.js:181 attack_speed×⌊层数/divide_num⌋） | ✅ |
| 异客 | 【萨尔贡】【迅捷】【精准】每叠加3层，本干员攻击力+2% ／ 【萨尔贡】【迅捷】【精准】每叠加3层，本干员攻击力+4% | 作战能力（战斗中） | native-battle.js:181 只读单键 `l[bond_id]`，多盟约 `bond_id` 取不到层数 | ❌ |
| 银灰 | 每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+1 ／ 每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+2 | 作战能力（战斗中） | 无对应代码（没有「敌人进入冻结」事件） | ❌ |
| 隐德来希 | 核心盟约每叠加3层，本干员攻击力和生命值+1% ／ 核心盟约每叠加3层，本干员攻击力和生命值+2% | 作战能力（战斗中） | native-battle.js:181 只读单键 `l[bond_id]`，多盟约 `bond_id` 取不到层数 | ❌ |
| 隐现 | 【拉特兰】每叠加5层，本干员攻击速度+1 ／ 【拉特兰】每叠加5层，本干员攻击速度+2 | 作战能力（战斗中） | native-battle.js:181 attack_speed×⌊层数/divide_num⌋ | ✅ |
| 幽灵鲨 | 自身被击倒时，使已激活的【阿戈尔】层数+3 ／ 自身被击倒时，使已激活的【阿戈尔】层数+6 | 作战能力（战斗中） | native-battle.js:411 selfdead 分支；native-effects.js:154 只在 reason=knockdown 触发 | ⚠️ |
| 远牙 | 使同一行最右边一名干员获得特质“使已激活的【卡西米尔】【精准】层数+4（每场作战至多24层）” ／ 使同一行最右边一名干员获得特质“使已激活的【卡西米尔】【精准】层数+8（每场作战至多48层）” | 作战能力（战斗中） | native-effects.js:498 转发生效，赠予 garrison_108_a（✅：native-battle.js:417 部署时 `this.event(u,'deploy')`） | ✅ |
| 跃跃 | 攻击无人机敌人时攻击力提升至150% ／ 攻击无人机敌人时攻击力提升至200% | 作战能力（战斗中） | 无对应代码（check_tag 未使用） | ❌ |
| 浊心斯卡蒂 | 【阿戈尔】每叠加10层，本干员每秒回复50生命，自然技力回复速度+0.15/秒 ／ 【阿戈尔】每叠加10层，本干员每秒回复100生命，自然技力回复速度+0.3/秒 | 作战能力（战斗中） | native-battle.js:181 只实现 attack_speed，未读 hp_recovery_per_sec | ❌ |
<!-- TABLE-END -->

## 三、缺口清单

先说结论：**整备期（`SERVER_*`）那半边的 handler 全部接上、触发点也都真的会发生，数值与 PRTS 逐条一致**——缺口只有「每回合上限没实现」一处硬 bug 和若干口径题；
**真正大面积失效的是作战能力（`IN_BATTLE`）**：代码里执行卫戍的只有四处——`native-battle.js:181`（`stats()` 里的常驻加成）、
`native-battle.js:428`（`chaos` 弱点伤害）、`native-effects.js:844`（玛恩纳部署卫戍）、`native-effects.js:498` + `native-battle.js:411`（特质转发与战斗中事件叠层）；
`IN_BATTLE` 里约四分之三的条目属于「键存在但字段被忽略」「整类触发时机没有代码」「给了特质却没有生效入口」三类。

### P0-A：整备期（一处硬 bug）

**0. `SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER` 的「每回合至多 N 层」完全没有上限（阿罗玛、安洁莉娜，4 条）。**
期望（原表）：阿罗玛「本回合每刷新过1次，使已激活的【叙拉古】【奥术】层数+2（至多6层）」，精锐「+4（每回合至多12层）」；安洁莉娜「+4（每回合至多12层）」／「+8（每回合至多24层）」。
证据：`garrison.js:32`
`SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER:(c,u,p)=>add(c,split(p.bond),Math.min(p.max_layer,c.s.roundRefreshCount*p.multiplier))`
——`max_layer` 只约束「这一次加多少」，而 handler 在每回合 `beginBattle`（`native-economy.js:91`）触发一次、`roundRefreshCount` 只增不减，所以刷新次数 ≥3 之后每次都加满 `max_layer`，累计无上限。实测 `roundRefreshCount=10` → `arcaneShip` 累计 **+60**（期望 ≤6/12/24）。
修复方向：改成「本回合该来源的累计配额」（`claimed` 记账 + `nextRound` 清零）。

### P0-B：作战能力（整族失效）

### P0：整族失效

**1. `act1autochess_gar_eff_attrByBond` 只实现了 `attack_speed`，`atk`／`max_hp`／`def`／`hp_recovery_per_sec` 全被忽略（22 条）。**
期望（原表）：水月「【阿戈尔】每叠加3层，本干员攻击力+1%」、泡泡「【萨尔贡】【坚守】每叠加3层，本干员防御力+1%」、
浊心斯卡蒂「【阿戈尔】每叠加10层，本干员每秒回复50生命，自然技力回复速度+0.15/秒」。
证据：`native-battle.js:181` 的 `attrByBond` 分支只有 `as+=Number(b.attack_speed||0)*stacks`，没有任何 `b.atk`／`b.max_hp`／`b.def`／`b.hp_recovery_per_sec` 引用；
`hpRecoveryPerSec` 全仓只有消费方（`native-battle.js:468` 的 `recoverHP`），没有卫戍写入方。
实测（30 层）：水月 `egirShip=30` 时 `stats().parts` 无卫戍项；泡泡 `sargonShip=30` 时 def 470→470；浊心斯卡蒂 `egirShip=117` 时 `spRecoveryPerSec=1.15` 但 `hpRecoveryPerSec=0`。
受影响：水月、乌尔比安、哈洛德、锡人、迷迭香、隐德来希、圣聆初雪、异客（atk 或 atk+max_hp）、泡泡、信仰搅拌机（def）、浊心斯卡蒂（回血）。

**2. 多值 `bond_id`（逗号串）取不到层数，整条归零。**
`yanShip,kjeragShip,sargonShip,lateranoShip,victoriaShip,egirShip,kazimierzShip,siracusaShip`（哈洛德／隐德来希／迷迭香的「核心盟约」）、
`sargonShip,steadShip`、`kjeragShip,arcaneShip`、`sargonShip,swiftShip,preciShip`、`investShip,swiftShip` 等。
证据：`native-battle.js:181` 与 `native-effects.js:844` 都写 `l[b.bond_id]`，而 `layers` 的键是单个盟约 id，逗号串恒 `undefined`。
即使补齐第 1 条，这一族仍然要先把 `bond_id` 拆开（按哪条口径见 §四）。

**3. 三类「战斗中进入某状态」的触发时机完全没有代码。**
- 敌人进入冻结（初雪、银灰，以及凛御银灰转发出去的 `garrison_29`）：`act1autochess_gar_event_enemy_abflag_inrange`（`check_ab_flag=16`、`prob=0.5`）全仓零命中；`event()` 只认 `kill/skill/deploy/selfdead/ammo`。
- 敌人或干员进入沉睡／晕眩（缇缇）：`act2autochess_gar_event_allyenemy_sleepstun_inrange` 全仓零命中。现成的挂载点是 `native-battle.js:463` 已经派发的 `status-applied`。
- 身前一格因特质叠层时追加层数（魔王）：`act1autochess_gar_event_addition_cnt` 无实现，而且它 `effectType:'GAIN_BUFF'`，连 `event()` 的 `effectType!=='ADD_BOND'` 门槛都过不去（双重失效）。

**4. 另外两个能力键没有消费点。**
- `act1autochess_gar_eff_attack_enemy`（深巡「攻击海怪敌人时攻击力提升至150%」、跃跃「攻击无人机敌人时…」）：`check_tag` 从未被读取，`hit()` 里没有按敌方 tag 的伤害缩放。
- `act2autochess_gar_eff_ab_damageScaleByBond`（仇白「【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升1%」）：全仓零命中。

### P1：条件与目标对不上

**5. `bond_type` 的三种语义被压成一种（`bond_by_id`）。**
- `bond_actived_maxstack`（塑心、纯烬艾雅法拉）：描述是「当前已激活且**层数最多的盟约**层数+N」，实现因为这两条 `blackboard` 没有 `bond_id`，回退成 `ownBonds(u)` → 给该干员每个所属盟约各加；`bond_add_type:'by_charcount_samerow'` 与 `bond_add_count_multi` **从未被读取**，所以「同一行每有 1 名干员 +N」变成了固定值。实测塑心开技后 `siracusaShip` 层数一点没动。
- `bond_self`（瑕光、锏第 2 条、华法琳转发出的 `garrison_95`）：描述是「自身**已激活**的盟约层数+N」，实现循环了全部所属盟约（把「无需激活」的那半句也算了进去）；锏同时写着「自身所属盟约层数+8」与「自身已激活盟约层数+8（至多24层）」，被合并成一次。
- `by_charlevel` 读的是 `p.rank`（`native-battle.js:411`），而 `rank` 在 `u.source.rank`——本期数据没用到，属于潜在雷。

**6. `give_garrison_to_all` 与 `check_bond_id` 失效。**
荒芜拉普兰德（精锐）「使所有【叙拉古】干员获得特质『击倒敌人时，使已激活的【叙拉古】层数+2』」整条不生效（实测同队其他干员 `extraGarrisonIds` 为空）；
凛御银灰「使身前一格【谢拉格】干员获得特质…」不校验 `check_bond_id`，会把特质给任意身前一格。
证据：`native-effects.js:498` 靠解析描述文本（`desc.includes('所有')`／`同一行最右边`／`自身`+`身前一格`）判定目标，`check_bond_id` 全仓未被读取。

**7. 转发来的特质没有「每场作战至多 N 层」。**
远牙给同排最右的 `garrison_108_a`「每场作战至多24层」实测可无限重复叠；克洛丝／华法琳的 `garrison_96`／`95` 只能靠 `event()` 里按 `u.counters[gid+':'+event]` 的箱子上限兜底，而 `max_add_count_per_battle` 在转发与 `onOperatorDeploy` 路径上完全不参与。

**8. 耀骑士临光自己拿到重复卫戍。**
她的卡同时持有 `garrison_144_a`／`159_a`（特质本体）和 `145_a`／`160_a`（`give_garrison_to_front`），而描述是「使**自身和身前一格**干员获得特质」→ `addExtraGarrison`（`native-effects.js:497`）只对 extra 数组去重，不查本身已有的 garrison，`profile()`（`native-battle.js:49`）再把两者拼接 → 同一条特质计两次（实测再部署时间 70→59.9，约等于层数翻倍）。

**9. 范围与条件字段被忽略。**
莫斯提马「自身**周围4格**的干员每消耗6发弹药…」变成了「自身每消耗6发」（`at_root`／`range_id` 未读，`native-battle.js:487` 的 `ammo` 事件只由消耗者自己发出）；
蕾缪安「若同一行有3名干员」的条件永远成立（`conditionkey` 在战斗内路径零命中，只有整备期的 `runGarrison` 判定它）。

**10. 「仅在每次部署时判定盟约层数」没有落实。**
PRTS 在隐现、哈洛德、泡泡、锡人、水月、信仰搅拌机、乌尔比安、隐德来希、圣聆初雪、浊心斯卡蒂、异客、焰影苇草、迷迭香 13 人的作战能力下都写了这条注记，本地 `stats()` 是**每帧按当前层数重算**（`native-battle.js:467/480` 每帧调 `stats()`，`layers` 是 `economy.s.bondLayers` 的引用），战斗中途涨层会立刻改变属性；反而是 PRTS 没有这条注记的玛恩纳做了部署快照（`native-effects.js:844` → `native-battle.js:179` 的 `garrisonDeployBuff`）。

**11. 计数口径：写了「单位」或「我方干员」的没有算我方。**
斯卡蒂「每击倒2名**单位**时」、海霓「首次击倒敌人**或我方干员**时」都只在敌方死亡分支触发（`native-effects.js:139-141`）。
归溟幽灵鲨「自身被击倒**或替身与本体进行切换**时」的替身切换没有触发点（`reason==='knockdown'` 才发 `selfdead`）。

**12. 属性来源 UI 看不到卫戍。**
`native-battle.js:181` 的 `as+=`、`base.respawnTime*=`、`base.spRecoveryPerSec+=` 都没走 `note()`，干员档案的「属性来源」只显示 `char_attribute_mul` 那一项。

### P1-整备期：口径与边界

**16. 松果的「免费特殊招募」池名没有显式建表，靠裸正则解释。**
`garrison.js:45` 取 `p['pool'+c.s.level]`（调度中心等级）→ `pool_chess_shop_{N}_reward`，而 `NAMED_POOLS`（`native-session.js:25-33`）里没有这一族，行为靠 `drawFromPool` 的 `/shop_(\d)/` 兜（`native-session.js:66-78`）。数据里 `pool1…pool6` 全部指向同一个池名，所以「精锐后变 V 阶」其实是另一条规则 `garrison_116_b` 在起作用，当前结果正确，但违反 AGENTS.md「具名卡池要显式建表」，池名一改就会静默退化成「按调度中心等级抽任意池」。

**17. 池类效果（歌蕾蒂娅、焰尾、佩佩、洛洛）是「直接进手牌」，没有「候选」这一步。**
`SERVER_POOL_CHAR`／`SERVER_POOL_EQUIP`（`garrison.js:37-38`）走 `draw()` → `gain()`／`gainItem()`；只有松果那条走 `rewardFromPool`（三选一）。描述里的「获得1个野鬃或灰毫」可以直接发放，但松果写的是「免费特殊招募」、池名又带 `reward`，`tests/native-protocol.test.mjs:32` 目前站在「直接发放」一侧——需要裁决（见 §四-11）。

**18. 「层数最多的盟约」并列时随机取一个。**
`garrison.js:10` 的 `mostLayers` 用 `c.pick(...)`，实测两个 5 层盟约 40 次取样各 20 次。原表没有「并列」口径。
**19. 号角的「不同阶干员在场」只统计该盟约成员**（`garrison.js:30` 的 `.filter(v=>own(c,v).includes(id))`），若应为全棋盘需去掉该过滤。
**20. `sell()` 的噬魂兽分支提前 `return` 会吞掉 `SERVER_CHESS_SOLD`**（`native-economy.js:80` 中段），受害的是格雷伊、泥岩、德克萨斯、松果这类「出售时」效果。
**21. 余的 `SERVER_MOST_BOND` 写了 `excludeCharId`（自身除外）**，而描述没有这句；同一 handler 的孤儿规则 `garrison_87_*` 才是明写「（自身除外）」的那条，疑似错配。
**22. 触发顺序不统一**：`startPreparation`（`SERVER_PREP_START`）按 y→x 排序，`beginBattle`（`SERVER_PREP_FIN`）按 `s.units` 数组序；互相加层/链式触发时结果可能不同。

### P2：数据与测试

**13. 本地未引用但同样缺实现的卫戍（将来放开卡池会踩到）**：`garrison_27`（冻结时回血）、`garrison_20`（身前一格消耗弹药）、`garrison_44`（开技同行3人）、`garrison_89`（同列4人）、`garrison_117_a`（身前一格叙拉古「所有盟约+2」）、`garrison_06`（流形复制）、`garrison_134`（三合一给骑士戒律，`effectType:'NONE'`）等。
另有 33 条非战斗规则挂在任何 `charChessDataDict` 都没引用的孤儿 garrison 上，其中 `SERVER_ADD_BOND_ACTIVATED_RANDOM`、`SERVER_ADD_BOND_FRONT_ALL_LAYER`、`SERVER_GAIN_CHAR` 三个 handler **没有任何可见干员覆盖**。
**14. 测试空档**：`tests/native-effects.test.mjs` 里没有任何卫戍断言；`tests/native-bonds.test.mjs:74-88` 只覆盖了 `onstart` 型与 `give_garrison_to_most_right`。建议加一条元测试——「输入里出现的每个 `IN_BATTLE` `blackboard.key` 必须被 `stats()`／`event()`／专门 hook 的名单覆盖」，防止以后新增卫戍静默失效。
**15. 两个干员不在本期 112 人内**（`isHidden`）：蜜蜡（`SERVER_GAIN` 给迅捷作战粮）、瑰盐（`SERVER_CHESS_SOLD` 触发「休整期结束时」特质，本地连 `garrisonDataDict` 条目都没有）。另外 PRTS 的「盟约·辅助干员」在本地也是隐藏行。

## 四、待确认口径

1. **多值 `bond_id` 怎么算层数**：求和、取最大，还是只算其中已激活的那些？（「核心盟约每叠加3层」）
2. **`bond_self` 的分配方式**：「+4」是每个已激活盟约各 +4，还是总量 +4 平摊？锏的两半句是否独立生效（合计 +16）？
3. **`bond_actived_maxstack` 的「层数最多」**：只统计已激活的盟约？并列时怎么选（id 顺序／随机／全部生效）？
4. **「每击倒 N 名单位」是否包含我方干员**（斯卡蒂写「单位」、休谟斯写「敌人」、海霓写「敌人或我方干员」）。
5. **`check_bond_id` 的校验强度**：凛御银灰身前一格不是谢拉格时，是不发还是照发？
6. **「每场作战至多 N 层」的计数起点**：每波战斗还是整场对局？现在 `u.counters` 跨重新部署累计、跨波次不清零（`deploy()` 的复位列表里没有它），恰好等于「整场对局」。
7. **重复卫戍是否应该去重**（耀骑士临光）。
8. **「仅在每次部署时判定」要不要真的做成部署快照**（涉及 13 人）。
9. **`effectType:'NONE'` 的占位条目**（风丸的三合一、流形的复制、骑士戒律）是否需要另找落点——风丸那条其实已经由数据侧的 `upgradeNum=2` 实现，另两条目前没有任何实现。
10. **`garrison_117_a` 的数据自相矛盾**：描述写「所有盟约+2」，`give_garrison_id` 指向的 `garrison_118_a` 只有 `siracusaShip`。
11. **池类效果要不要「候选三选一」**：歌蕾蒂娅／焰尾／佩佩／洛洛现在是直接进手牌，松果走三选一；`pool_chess_shop_N_reward` 这个池名和「免费特殊招募」的措辞更像候选发放，但改它要连测试一起改。
12. **「同一行每有1名干员」「若同一行有3名干员」是否含自身**（蛇屠箱、歌蕾蒂娅；当前都含）。
13. **`无需激活盟约` 期间累积的层数**，在盟约日后激活时是否应计入层数奖励（现在会）。
14. **`SERVER_*` 的结算顺序**是否需要统一（`PREP_START` 按 y→x、`PREP_FIN` 按数组序）。
15. **佩佩池的「小概率」= 20%**（`native-session.js:28` 注释自标待确认），与焰尾的远牙 20% 是否同一档。
16. **投资人盟约让 `SERVER_GAIN` 重复 2~3 次**（`native-economy.js:49`）没有原表依据，属项目自定，是否保留。
