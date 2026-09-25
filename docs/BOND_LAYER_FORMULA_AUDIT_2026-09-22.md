# 盟约「受层数影响」数值公式审计与修复（2026-09-22）

用户口径：「检查当前各盟约的随层数增长的效果的计算公式来源」→「按你的方案修复」。

## 一、结论

- **公式模型有唯一原表依据**：原表 `bondInfoDict[].descParamBaseList` / `descParamPerStackList` 就是「哪些键受层数影响」的声明，
  两项按下标配对，取值一律是 `base + per × 当前层数`（线性、从 0 层起算；原表没有任何阈值／非线性字段）。
- **数值只有一个来源**：`data/modes/alliance-lower/source.json` → `.season.bondInfoDict` + `.season.effectBuffInfoDataDict`
  （`data/prts/` 里**没有**盟约页快照，所以盟约数字不像技能范围那样有第二个来源可交叉验证）。
- **修复前的问题不是「公式不对」，而是「公式抄成了常量」**：17 个有层数公式的盟约里有 11 个把数值写死在代码里，
  改原表不会生效，面板还可能显示一个战斗不读的值。修复后 17 个全部读原表，并加了键登记表与门禁测试。

## 二、唯一读取口径（修复后）

| 环节 | 位置 | 说明 |
| --- | --- | --- |
| 盟约黑板 | `protocol.bondBlackboard(data,bondId)` | 有 `env_gbuff_new` 行的盟约以该行为准；奇迹／远见／投资人没有这一行，退回「全部行合并」（它们没有层数参数，专用行由 `native-economy` 显式读） |
| 指定行黑板 | `protocol.bondEffectBlackboard(data,bondId,key)` | 例：助力的 `bond_activated_add_layer`、投资人的 `bond_layer_char_garrison_bonus` |
| 取值 | `protocol.bondValue(b,key,fallback)` | **兜底值只在原表缺字段时用**，不得替代原表数值 |
| 层数公式 | `protocol.bondLayerValue(b,baseKey,perKey,layers,baseFallback,perFallback)` | `base + per × 层` |
| 面板 | `protocol.bondScaledParams` / `bondCurrentPreviewHtml` | 原表声明几项渲染几项；额外项登记在 `BOND_PANEL_EXTRA` |
| 战斗 | `native-battle.params()` → `bondBlackboard`；`native-effects.bondParam()` → `params()` 或 `bondBlackboard` | 面板与战斗现在读同一行 |

## 三、逐盟约（35 层时的面板显示值）与修复前来源

| 盟约 | 原表 base / per（值） | 修复前 | 修复后 |
| --- | --- | --- | --- |
| 炎 | base_atk 0.23 / atk_per_stack 0.009（+54.5%） | ✅ 读原表 | 不变 |
| 阿戈尔 | base_max_hp 0.35 / max_hp_per_stack 0.01（+70%） | ✅ 读原表；`≥5 人`、`前 3 名` 写死 | 两个阈值读 `power_bond_char_cnt` / `max_free_respawn_cnt` |
| 坚守 | base_max_hp 0.25/0.012（+67%）、base_damage_value 850/10（1200） | ✅ 读原表；分摊 40%、脆弱 5 秒、`≥3 人` 写死 | 读 `damage_resistance` / `weak[limit]` / `power_bond_char_cnt` |
| 助力 | base_def 0.15/0.012（+57%） | ✅ 读原表；再部署 `×0.7`、加层 `+2/+4` 写死 | 读 `respawn_time`；加层读 `bond_activated_add_layer` 的 `layer`/`count`/`more_layer` |
| 精准 | base_atk 0.1/0.012（+52%） | ✅ 读原表；穿透 0.3、`≥3 人` 写死 | 读 `power_def_penetrate` / `power_magic_resist_penetrate` / `power_bond_char_cnt`（防御与法抗分开传，`damage()` 按伤害类型取用） |
| 叙拉古 | base_attack_speed 25/0.8（+53）、base_duration 32/0.4（46 秒）、base_damage 5000/50（6750） | ✅ 读原表；**3% 概率用自造曲线 `.00139×(pity+1)`、719 保底** | 概率读原表 `prob`，按下面「保底口径」换算 |
| 突袭 | base_atk 0.25/0.01（+60%）、base_max_hp 0.25/0.01 | ✅ 读原表；`≥50 层 +50 攻速`、buff 10 秒写死；**面板不显示生命值** | 读 `power_bond_stack_cnt` / `power_attack_speed` / `no_attack_duration`；面板补「最大生命值提升」（`BOND_PANEL_EXTRA`） |
| 萨尔贡 | base_time 5/0.22（12.7 秒） | ✅ 读原表；`≥6 人`、娜仁图亚分支 `band_narant`+60 秒写死 | 读 `power_bond_char_cnt` / `valid_in_band` / `base_power_time` / `power_time_per_stack` |
| 拉特兰 | base_ammo_percent 0.05/0.015（+57.5%） | ✅ 读原表；`≥6 人` 写死 | 读 `power_bond_char_cnt` |
| 奇迹 | baseprob 0.18 / prob 0.003（+28.5%） | ✅ 读原表 | 不变（`probk` 仍待确认） |
| 不屈 | base_prob 0.18/0.004（+32%） | ✅ 读原表；`≥3 人` 写死 | 读 `power_bond_char_cnt` |
| 迅捷 | base_prob 0.2/0.0035（+32.25%） | ✅ 读原表（含 40 层档） | 统一走 `bondValue` |
| 谢拉格 | base_ex_damage_scale 1.35/0.01（+170%）、寒风 base_time 20/0.1（23.5 秒） | 寒风 ✅ 读原表；**伤害 1.25 / 1.35+0.01×层 写死** | 伤害读 `base_damage_scale` / `base_ex_damage_scale` / `ex_damage_scale_per_stack` |
| 维多利亚 | base_damage_scale 1.25/0.008（+153%） | **写死 1.25+0.008×层**；`≥6 人` 装备加攻 0.5/0.8 写死 | 读 `base_damage_scale` / `damage_scale_per_stack`；装备加攻读 `atk_normal_equip` + `atk_golden_equip`（进阶＝基础＋额外）与 `power_bond_char_cnt` |
| 卡西米尔 | base_max_atk_when_born 0.5/0.01（+85%） | **写死 0.5+0.01×层**，每次部署 +0.2 写死；`≥6 人` 写死 | 读 `base_max_atk_when_born` / `max_atk_when_born_per_stack` / `atk_when_born` / `power_bond_char_cnt` |
| 灵巧 | base_attack_speed 10/1（+45） | **写死 10+层**；40 层阈值读原表 | 读 `base_attack_speed` / `attack_speed_per_stack`（半径 1.01/1.42 是「周围 4／8 格」的客户端几何口径） |
| 奥术 | base_damage_scale_show 0.2/0.01（+55%）、_show_ex 0.68/0.014（+117%） | **全部写死**（含 3 秒、50%、`≥3 人`） | 读 `base_damage_scale_show(_ex)` / `damage_scale_per_stack(_show_ex)` / `weak_duration` / `hp_ratio` / `power_bond_char_cnt` |
| 远见 | 无层数参数（每 10 层 2 资金；80/150 层永久折扣） | 阈值读原表；**折扣金额写死 −1** | 金额读 `discount`（档位 1＝仅远见、2＝全部干员，客户端编码作用范围） |
| 投资人 | 无层数参数（`获得时` 触发 2 次；100 层起 3 次） | **整行没读**：`100`/`2`/`3` 全写死 | `event`/`count` 读 `bond_layer_char_garrison_bonus` 行；`100` 只写在文案里 → `BOND_TEXT_CONSTANTS.investShip` |
| 调和 | count=1（核心盟约激活人数 +1） | 加了写死的 +1 | 读 `other_bond_add_trigger_cnt` 的 `count` |

不参与层数：协防干员／独行／绝技（`noStack`）——它们的 1.2/1.4/×0.8、.6/.6/+15 技力、.3/×0.7/`≥5 人` 也一并改成读原表
（`damage_scale_normal`/`damage_scale_extra`/`damage_resistance`、`atk`/`max_hp`/`sp`、`power_atk`/`sp_ratio`/`ex_char_cnt`）。

## 四、行为修正与新口径

1. **叙拉古「3% 概率造成真实伤害」的保底口径**：原表只给 `prob=0.03`，不给保底曲线。
   客户端保留「线性递增保底」（避免连不出），但步长改为由概率反解：`c = π·prob²/2`，
   于是 `E[命中次数] ≈ sqrt(π/(2c)) = 1/prob`（保底上限 `ceil(1/c)`），改原表 prob 时曲线跟着变。
   实测 20 万次模拟命中率 3.0%（`tests/native-bond-formula.test.mjs`）。旧写死的 `.00139` / `719` 已删除。
2. **突袭面板补「最大生命值提升」**：原表 `descParamBaseList` 只声明了 `base_atk`，但文案写「攻击力和生命值提升（受层数影响）」、
   战斗也一直按 `base_max_hp + max_hp_per_stack × 层` 生效。额外项登记在 `protocol.BOND_PANEL_EXTRA`，
   面板门禁（`native-bond-preview`）按它放宽项数并逐项核对。
3. **萨尔贡增益范围按文案拆开**：攻速增益只要盟约激活（≥3 人）；攻击力增益仍要求 ≥6 人（在 `native-battle.stats` 判定）。
   修复过程中一度把两者一起卡在 ≥6 人，被 `native-bonds` 的用例挡下。

## 五、登记表与门禁

- `dist/native-bond-keys.js`：原表每个盟约黑板的每个键都必须登记 `{src,note}`，
  `src ∈ formula / activation / meta / zero / client / text / pending`；
  只写在文案里的数字进 `BOND_TEXT_CONSTANTS`；待确认项进 `BOND_KEY_PENDING`。
- `tests/native-bond-formula.test.mjs`（17 条）：
  ① 键全部登记、无死条目、`zero` 必须真是 0、`pending/text/client` 必须有说明；
  ② `descParamPerStackList` 声明的项必须 `formula`，且 `formula` 的键名必须真的出现在逻辑模块里（抄常量会挂）；
  ③ 待确认名单冻结；④ 面板项数＝原表声明＋登记额外项，突袭必须有生命值行；
  ⑤ 面板与战斗读同一行黑板且公式文本＝`base + per × 层`；⑥ 叙拉古概率来自原表、期望≈prob；
  ⑦ 旧常量源码门禁（`.00139`、`1.25+.008`、`1.35+.01`、`.68+.014`、`10+(l.skillfulShip`、`base.respawnTime*=.7`、
  `variants.size>=3?4:2`、`count>=100?3:2` 等不得复活）；⑧ 改原表即改数值的行为断言
  （灵巧攻速、突袭 50 层攻速与生命值、谢拉格寒冷倍率、奥术脆弱、助力加层、投资人次数、远见折扣、叙拉古隐匿时长）。

## 六、纠错记录（重要）

审计第一版曾把「突袭 ≥50 层全体攻速 +50」判成**未实现**——理由是 `power_attack_speed` 这个键名只在面板里出现。
实际上 `native-battle.stats` 里一直有 `if(this.on('raidShip')&&(l.raidShip||0)>=50){as+=50;...}`，
当时的扫描脚本按「行里含 layers/stack/params 等关键词」过滤，漏掉了这一行。**结论修正为「已实现但硬编码」**，
本次改成读 `power_bond_stack_cnt` / `power_attack_speed`，行为不变。
教训：判断「有没有实现」要按盟约 id 逐行看消费点（含被截断的超长行），不能只看键名是否出现。

## 七、待确认（已登记，未实现/未消费）

| 键 | 原表值 | 待确认什么 |
| --- | --- | --- |
| `arcaneShip.power_weak_scale` | 1.4 | ≥3 人分支客户端用的是 `base_damage_scale_show_ex=0.68`；`1.4` 与 `0.2×1.4=0.28` 都对不上，需要游戏内确认哪个才是「提升比例提升」的真值 |
| `sargonShip.invalid_in_band` | band_narant | 与 `valid_in_band` 同值，语义未定；当前只读 `valid_in_band` |
| `sargonShip.filter_item_level` | 5 | 本客户端没有「按装备等级筛选」的消费点 |
| `miraShip.probk` | 0.3 | 没有消费点（刷新免费概率只用 `baseprob + prob × 层`） |

## 八、验证与局限

- 验证方式：原表逐键比对 + 源码消费点通读 + 真实战斗行为断言（改原表数值看面板与结算是否同步）。
- `npm test`：1143 通过 / 0 失败（含新增 17 条）。
- **没有浏览器／游戏内验证**：本次改动是数值与读取路径，画面无变化；奥术、谢拉格这类倍率只做了伤害比值断言。
