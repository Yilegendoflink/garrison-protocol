# 规范化原作数据（S1）

本目录是PRTS参考库的补充规范层。`current.json`与`allianceLower.json`互相独立，来源和时间边界写入各自`source`。`database.sqlite`同时提供两种版本的查询，是可重建产物。

## 数据契约 v1

| 字段 | 类型与含义 |
| --- | --- |
| `schemaVersion` | 当前为1 |
| `id` | `arknights:current`或`arknights:allianceLower` |
| `source` | 固定仓库提交、URL、各原始表SHA256及采集信息 |
| `clientVersion` | 原始data_version.txt内容 |
| `entities` | 以原作内部ID为键；`kind`区分operator、summon、device |
| `entities.*.phases` | 各精英阶段maxLevel、rangeId及精确attributesKeyFrames；不使用估算成长锚点 |
| `entities.*.skillRefs` | 原始技能ID、解锁条件等，引用`skills` |
| `entities.*.talents/trait/potentials/favor` | 天赋候选、特性、潜能和信赖锚点的原始结构化记录 |
| `enemies` | 按原作内部enemyId索引，图鉴记录和战斗等级分开 |
| `enemies.*.levels` | `raw`保留m_defined，`data`为按等级继承展开的数据；未定义且没有继承值保持null |
| `skills` | 技能各等级、恢复/触发类型、消耗、持续、prefabId及blackboard参数 |
| `modules` | 模组ID、角色ID、解锁条件和各级效果/属性 |
| `ranges` | 客户端范围ID及原始网格；与PRTS显示SVG独立保存 |
| `links` | PRTS页面与内部实体对应；支持一对多、聚合页面和历史快照不存在 |

属性键使用原作名称（例如maxHp、atk、magicResistance），数值含义不在数据层擅自改写。移动速度等原始属性仍需在S4按机制解释。enemy的未定义属性不是0；`m_defined:false`的原始缺省字段和显式给定0有区别。

技能prefab名称和blackboard不是可直接执行代码。它们明确记录所需能力，但仍需要S4建立效果实现与对照测试。当前源表引用了未收录的`sktok_cdsoul`，挂在装置`trap_755_cdsoul`上，作为源数据异常保留，没有虚构空技能消除报告。

## 来源与版本

- 当前：客户端2.7.71，提交`0ef7f952dfd018392200157a5c79a6511ba69122`。
- 下半期历史：客户端2.7.21，提交`86da4cfa3a4b958c3615fccf5afbc10b5c7f1bfb`。
- 提交来自[公开游戏数据镜像](https://github.com/Kengxxiao/ArknightsGameData)，并非官方服务接口；PRTS原始修订档案继续保存在`data/prts/`。
- 历史快照按活动结束前最近一次国服数据版本提交固定，不自动跟随master更新。服务器热修复与镜像的完整对应关系仍待核实。

`current-report.json`和`allianceLower-report.json`记录实体、引用、目录匹配与例外。当前对应全部460个PRTS干员和1804个PRTS敌人页面；后者覆盖的是页面，不等于2151个内部敌人都具有独立Wiki页面。

## 命令

```powershell
npm run data:fetch-game
npm run data:normalize
npm run data:normalized-sqlite
```

SQLite表：`versions`、`records`、`prts_links`。例如：

```sql
SELECT id, name FROM records
WHERE version='allianceLower' AND kind='entity' AND name='能天使';

SELECT name, data FROM prts_links
WHERE version='current' AND kind='enemies' AND name='源石虫';
```

JSON为主数据，SQLite是导出；修改或更新规范化数据后重新导出。源表、规范化结果和演示规则内容包互不覆盖。

来源表只剔除了物品简介和模组故事等非战斗文本。manifest同时保留下载原文的sourceSha256及存储文件sha256，数值和能力字段未删改。
