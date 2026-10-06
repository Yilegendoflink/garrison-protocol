# 联机匹配与信令服务

该服务负责配对房间、快速匹配、WebRTC 信令中继，以及 MVP 的队伍回合栅栏。网页大厅已接入配对码创建／加入、准备、开始、连接状态和对局入口；DataChannel 交换队友状态及盟约干员转让。服务器接收每名玩家本轮战果，统一进入联防／回合结算，随机选择联防者，并等待存活成员全部确认后推进回合。玩家战斗仍在各自客户端模拟，服务器不托管战场状态或验证战斗过程；服务重启会清空房间、协调状态和匹配队列。

## 启动

Node.js 22 或更新版本：

```powershell
npm install
npm run online:server
```

默认监听 `0.0.0.0:5503`，以便局域网设备访问。健康检查为 `http://127.0.0.1:5503/health`，本机网页使用 `ws://127.0.0.1:5503/ws`。

Windows PowerShell 局域网启动示例：

```powershell
$env:ONLINE_HOST = '0.0.0.0'
$env:ONLINE_PORT = '5503'
$env:ONLINE_ALLOWED_ORIGINS = 'http://192.168.1.10:5502,http://localhost:5502'
npm run online:server
```

将示例里的 IP 改成托管网页的来源。浏览器来源不在 `ONLINE_ALLOWED_ORIGINS` 中时，WebSocket 握手会被拒绝；不带 `Origin` 的非浏览器客户端可连接。公网部署应在反向代理上启用 TLS/WSS，并只允许可信网页来源。

## Cloudflare 部署

项目还提供基于 Workers + Durable Objects 的托管版本：Worker 处理 HTTP/WebSocket 握手；每个 WebSocket 会话、配对房间、快速匹配队列和来源 IP 限流各自使用 Durable Object。房间和队列数据存入 Durable Objects SQLite，服务可以在无常驻 Node 进程的情况下运行。客户端战斗仍在本地模拟，Worker 负责房间、信令与队伍回合协调。

首次部署前，用 Wrangler 登录目标 Cloudflare 账号：

```powershell
npx wrangler login
```

登录完成后，从项目根目录发布：

```powershell
npm install
npm run online:cf:deploy
```

当前部署地址为 `garrison-protocol-online.1226631013.workers.dev`。健康检查为 `https://garrison-protocol-online.1226631013.workers.dev/health`，WebSocket 地址为 `wss://garrison-protocol-online.1226631013.workers.dev/ws`。大厅默认使用此环境；如需本地调试，可运行 `npm run online:cf:dev`。查看实时日志：

```powershell
npm run online:cf:tail
```

`wrangler.jsonc` 中的 `ONLINE_ALLOWED_ORIGINS` 默认包含 GitHub Pages 正式来源、Cloudflare Pages 预览项目 `strongholdonlinepreview.pages.dev`（含 `online` 分支别名）和本地开发来源。自定义网页域名时，把精确的 `https://` 来源追加到该逗号分隔变量，再重新部署。不要将 API token 写入配置文件；Wrangler 登录凭证保存在本机。

Cloudflare 版使用 Durable Objects SQLite，因此状态会跨 Worker 休眠保留；房间与匹配队列按 MVP 生命周期规则管理。`server/cloudflare/` 是 Cloudflare 专用入口，原有 `npm run online:server` Node 服务仍可用于本机或自托管部署。

## WebSocket 协议

每条客户端消息是 UTF-8 JSON 对象：

```json
{
  "type": "room.create",
  "requestId": "optional-client-request-id",
  "payload": {
    "playerName": "玩家",
    "modeId": "mode_multi_normal",
    "allowUnderfilledStart": true
  }
}
```

连接成功后先收到 `server.hello`，其中包含协议版本、4 人容量和允许的正式多人难度。所有客户端命令使用 `type` 和 `payload`；同步回复尽量带回原 `requestId`。错误统一为 `{ "type":"error", "code":"...", "message":"..." }`。

### 房间和身份

| 客户端消息 | payload | 行为 |
| --- | --- | --- |
| `room.create` | `playerName`, `modeId`, `allowUnderfilledStart` | 建立私密房间并成为房主 |
| `room.join` | `code`, `playerName` | 用房间码加入未开始且未满的房间 |
| `room.rejoin` | `sessionToken` | 恢复断线成员原身份和房间 |
| `room.ready` | `ready: boolean` | 更新当前成员准备状态 |
| `room.set-settings` | `modeId?`, `allowUnderfilledStart?` | 房主可在开始前改难度／未满员开局设置 |
| `room.kick` | `playerId` | 房主可在开始前移除成员 |
| `room.start` | `mapId?` | 房主在成员全员在线且准备后开始信令阶段；服务端生成本局公共种子并广播阵地 ID |
| `room.leave` | 空对象 | 显式离开房间并撤销该成员票据 |
| `coop.battle.report` | `round`, `leaks`, `failedEnemies`, `eliminated` | 提交个人普通作战结果；全员提交后服务端决定联防名单或回合结算 |
| `coop.joint-defense.report` | `round`, `leaks`, `eliminated` | 联防玩家提交结果；所有防守者提交后广播全队结算 |
| `coop.round.ready` | `round` | 存活玩家确认继续；全员确认后广播下一回合开始 |
| `coop.boss.skip` | `round` | 同步到达 Boss 阶段并结束本局；当前 MVP 不运行 Boss 战 |

创建、加入和匹配成功时，服务端发回 `sessionToken`。客户端应只把它保存在该设备本地存储中，不放进 URL、日志、信令 payload 或分享链接。服务端只在内存保留票据摘要；房间重启后票据失效。断线成员可在房间存续期间使用 `room.rejoin`；所有成员都离线 30 分钟后，房间会被清理。

房间事件包括 `room.created`、`room.joined`、`room.rejoined`、`room.state`、`room.started`、`room.left`、`room.kicked` 和 `room.closed`。`room.started` 表示成员可以开始 WebRTC 协商，携带公共 `sessionSeed` 和 `mapId`；不代表服务端已开始或校验游戏对局。

协作事件为 `coop.progress`、`coop.joint-defense.started`、`coop.round.advance`、`coop.round.begin` 和 `coop.game.finished`。3 名或 4 名玩家完美通关且至少有一名玩家漏怪时，服务端从完美玩家中无放回随机选 2 人；完美玩家不超过 2 人时全部参加。漏怪敌人按列表轮流分给防守者，并保留敌人 ID 与路线。普通战斗报告与联防报告都按回合编号去重；队伍必须越过 `coop.round.ready` 栅栏才能进入下一回合。

### 快速匹配

客户端发送：

```json
{
  "type": "matchmaking.search",
  "payload": {
    "playerName": "玩家",
    "modeId": "mode_multi_normal",
    "minPlayers": 2
  }
}
```

队列按 `modeId` 和 `minPlayers` 分桶，不跨难度混配。`minPlayers` 可设 2–4；满足门槛后服务端短暂收集同队列玩家，最多 4 人组成一个房间。快速匹配房主允许不足 4 人开局。排队时可以发送 `matchmaking.cancel`。当前没有奖杯等级资料，所以不提供精确匹配。

匹配事件为 `matchmaking.queued`、`matchmaking.cancelled` 和 `matchmaking.matched`；`matchmaking.matched` 会包含房间状态、玩家身份和新的 `sessionToken`。

### WebRTC 信令

房主发送 `room.start` 后，成员可以向同房间在线成员发送以下消息：

```json
{
  "type": "signal.offer",
  "requestId": "signal-1",
  "payload": {
    "targetPlayerId": "peer-player-id",
    "data": {"type": "offer", "sdp": "..."}
  }
}
```

支持 `signal.offer`、`signal.answer`、`signal.ice`。offer／answer 要求匹配的类型及 SDP 字符串；ICE 接受候选对象和结束标记 `null`。目标端收到 `signal.forward`，其中包含 `fromPlayerId`、`fromName`、`signalType` 和原始 `data`。发送端收到 `signal.sent`。服务器只验证发送者身份、同房间关系、目标在线状态、类型、数据大小和发送频率，然后转发 SDP／ICE 数据；它不解析 SDP、不建立 PeerConnection，也不转发 WebRTC DataChannel 的游戏消息。

### 客户端 MVP

大厅位于 `dist/native-online.js`，从主大厅的“联机协作”卡片进入。创建时默认允许 2–3 人开局，最多 4 人；加入者输入 6 位配对码。全员准备后房主开始，客户端为房间内在线玩家建立全网状 WebRTC DataChannel。每名玩家进入正式多人难度的独立 `NativeSession`；房间种子使阵地、波次和最终 Boss 统一，每个玩家的本地商店随机流按成员 ID 分开。`peer.status` 更新队友盟约计数，原有 `NativeSession` 转让钩子通过 `team.fang` 发送盟约干员。

当前 DataChannel 由客户端彼此信任，各自战斗由本地客户端模拟；服务器只验证回合编号、身份和报告格式，不能防止伪造战果。联防和回合推进由服务器统一协调，但不校验敌人是否真实漏过。MVP 暂不支持整备／特殊选择计时与超时随机决策、共享 Boss 血量、跨端存档恢复或防作弊。联机 UI 会等待所有点对点连接建立后才允许进入模拟。

ICE 当前配置 Google STUN；跨运营商或严格 NAT 环境需要 TURN 中继，当前 MVP 尚未提供 TURN 服务配置入口。部署到同一局域网时，应让网页和服务端端口均可达，并把网页来源加入 `ONLINE_ALLOWED_ORIGINS`。

### 规则钩子

`random-rules.mjs` 提供特殊选择超时等概率选取当前有效候选，以及联防者抽选规则。联防者规则已接入 `CoopRoundCoordinator`；特殊决策超时随机仍未接入实时阶段。

## 当前限制

- 房间、匹配队列、票据和协作阶段都在单进程内存；服务退出会清空。
- 浏览器 UI 尚未提供快速匹配入口；本 MVP 通过六位配对码创建／加入房间。
- 快速匹配只按难度和最少人数分队；没有精确匹配、账号、好友和官方服务器连接。
- 默认监听所有网卡。浏览器来源仍需加入 `ONLINE_ALLOWED_ORIGINS`；公网部署应经反向代理启用 TLS/WSS，并由部署环境提供网络边界。
- 最多 256 条同时连接；每个来源 IP 每分钟最多创建 30 个房间、尝试 12 次房间码、发起 10 次快速匹配。
- 单条 WebSocket 消息最大 64 KiB；信令内容最多 48 KiB，每个连接每 10 秒最多 40 条。
