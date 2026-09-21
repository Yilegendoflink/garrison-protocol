# 我方干员动画数据库

本库只采集**当前 native 运行时干员的默认战斗模型**：正面、背面，以及只有一个「战斗」入口的模型。排除敌人、基建动作、其他时装和独立召唤物。来源是 PRTS 当前资源，**不是 2026-03 历史资源快照**。

JSON 是可移植主数据库，不需要数据库服务。当前阶段没有接入棋盘渲染、改战斗结算或增加可玩干员；`npm run build` 不联网，也不把本库打进客户端。

## 采集、续传与查询

在项目根目录运行（Node.js 22+，推荐 24）：

```powershell
npm run data:animations:sync -- --snapshot=2026-09-21-operators
npm run data:animations:check
npm run data:animations -- stats
npm run data:animations -- search 银灰
npm run data:animations -- show char_1040_blaze2
```

同一 snapshot 固定 `inventory.json` 和已下载的源文件。重复命令校验缓存并续传；更新网络内容或采集新干员时应使用**新的 snapshot 名称**。默认名称为 UTC 日期加 `-operators`。

输入名单来自 `dist/runtime-data.js` 中 `profiles`，按 `charId` 去重；包括辅助／虚拟棋子引用的我方干员，不等于大厅可见预设数。`inventory.json` 固定名单、运行时文件 SHA256 和游戏数据来源。需要变更名单时先更新运行时再建新快照。

```powershell
# 已完整下载后，从本地资产重新解析，绝不请求网络
npm run data:animations:sync -- --snapshot=2026-09-21-operators --offline
```

解析器是固定提交、固定 SHA256 的 Spine 3.8 core，仅用于采集时读取二进制；首次同步下载到被 Git 忽略的 `artifacts/research/`，不会进入游戏 bundle。离线重新解析需要保留这个缓存；**离线检查、查询、单元测试不需要解析器**。版本和许可证链接记在 `database.json.inspector`。这是独立的数据检查工具；将来向玩家分发 Spine 运行时需另行选择和核对许可。

每个网络文件都记录来源 URL、获取时间、字节数和 SHA256。同步有超时、重试和请求间隔；失败时写 `acquisition-report.json`，不更新 `latest.json`。不要并行同步同一个快照。

## 文件组织与可信度

- `prts/latest.json`：最近完整采集的快照。
- `prts/<snapshot>/database.json`：角色、模型、资源描述、骨骼版本、皮肤名、动作名和时长。
- `prts/<snapshot>/inventory.json`：固定采集名单。
- `prts/<snapshot>/sources/`：PRTS 原始 `meta.json` 及来源收据，保留其他时装索引但不下载。
- `prts/<snapshot>/assets/<charId>/<front|back>/`：原始 `.skel`、`.atlas`、图集引用的 PNG；每个文件有 `.source.json` 收据。
- `prts/<snapshot>/manifest.json`：数据库、源文件、收据和资产的 SHA256 清单。
- `custom/`：自制动画包；PRTS 同步不读取、不覆盖此目录。

PRTS 元数据优先使用 `https://torappu.prts.wiki/assets/char_spine/<charId>/meta.json`，模型的实际文件路径取元数据，不凭 ID 拼接。旧 `static.prts.wiki/spine/` 前缀按 PRTS 播放器做法映射到 `spine38/`。来源字段 `sourceConfig` 原样保留视角附加配置。

`animations` 是真实解析的动作清单，时长单位为秒；`bounds` 是骨骼导出的边界，不是已校准的游戏脚底坐标。`visualVerified:false` 表示未逐个播放验收。

`bindings.states` 只对 `Idle`、`Attack`、`Start`、`Die`、`Move_Loop`、`Stun` 做严格同名候选匹配，全部标 `candidate`。**动作存在不等于状态语义核实，更不等于技能适配完成**。`bindings.skills` 保持空表，不把 `Skill_03_*` 自动绑定到三技能。确认后应放在独立扩展包中，避免修改采集结果导致清单失配。

## 自制干员与动画包

可运行的最小示例是 `custom/example/database.json` 和 `clockwork.png`，两帧原创几何小人。复制整个目录，换成自己的包 ID、干员 ID 和资源即可：

```powershell
npm run data:animations:check -- --pack=data/operator-animations/custom/example/database.json
npm run data:animations -- show clockwork --pack=data/operator-animations/custom/example/database.json
```

包结构和示例一致：`schemaVersion:1`、唯一 `id`、`provider:"custom"`、`operators`。角色身份为 **包 ID + 干员 ID**，不要求出现在 PRTS 或原作角色表，也不要求 `char_` 前缀。`gameId` 可选，不能据此隐式替换官方记录。不同包可有同名干员，同名包直接拒绝合并。

每个干员的 `models.front` 必填，`models.back` 可选。没有背面不会自动谎报成有背面。两种模型格式：

| format | 必填模型内容 |
| --- | --- |
| `spine` | `spineVersion`、`skeleton`（`.skel` 或 `.json`）、`atlas`、`textures`、`animations`、`bindings` |
| `spritesheet` | `image`、`frameWidth`、`frameHeight`、`animations`、`bindings` |

每项资源描述必须包含相对于**包文件所在目录**的 `file`、`bytes`、`sha256`。精灵图 image 还需 `width`、`height`。贴图限 PNG/WebP。禁止绝对路径、URL、路径穿越及指向包外的软链接；来源 URL 可以另记在 `url`，不会自动执行或下载。包只提供数据，不含 JS 插件或战斗规则。

Spine 动作填 `{name,duration}`，版本按真实导出填写；支持登记不同版本，但不代表客户端已有对应版本播放器。精灵图动作填 `{name,frames,fps,duration}`；`frames` 按图像从左至右、从上至下的 **0 起始格子编号**，`duration=frames.length/fps`。

`bindings.states` 使用语义状态名，值为 `{animation,loop,status}`；`status` 只能是 `candidate` 或 `confirmed`。`bindings.skills` 以自定义技能 ID 为键，下面可登记 `start`、`idle`、`attack`、`end`。可选 `hitTime` 只是视觉出手对齐点，不能触发伤害或改变战斗规则。

`scripts/operator-animation-db.mjs` 提供校验和合并查询入口：

```js
const catalog = createAnimationCatalog([prtsPack, customPack]);
const result = resolveAnimation(catalog, {
  packId: 'custom:example', operatorId: 'clockwork',
  view: 'front', state: 'attack'
});
```

默认只返回 `confirmed` 绑定；研究预览可显式传 `allowCandidates:true`。不存在的角色／视角／动作／技能返回 `null`，由后续表现层选择头像回退。不同格式只共享状态协议，各自保留资源字段；自制作者不必为了使用逐帧动画先制作 Spine。

## 验证与后续接线

`node --test tests/operator-animation-db.test.mjs` 检查包隔离、候选标记、技能映射、资产篡改、路径边界和真实清单覆盖；`data:animations:check` 全量校验已采集文件。检查不会将任何干员能力升为 `verified`。

下一步是播放器与棋盘接线、动作时序和脚底校准、暂停／倍速／控制状态、手机性能验证。完整技能特效和召唤物另计。本库不会自动给外来干员增加属性、商店条目或可执行技能。

来源：[PRTS 模型播放器](https://prts.wiki/w/Widget:SpineViewer)、[PRTS 干员一览](https://prts.wiki/w/干员一览)。原作模型归原权利人所有，源站可下载不等于开放许可；自制包自行保留作者和素材来源说明。
