# 每周挑战

每周挑战内容由 `data/modes/alliance-lower/weekly-challenges.json` 提供，并在 `npm run build` 时注入运行时数据。时间表的 `startsAt` 和 `endsAt` 必须带 UTC 偏移或 `Z`，生效区间采用左闭右开 `[startsAt, endsAt)`。同一时间只允许一个挑战生效。

```json
{
  "schemaVersion": 1,
  "timeZone": "Asia/Hong_Kong",
  "entries": [
    {
      "id": "2026-week-41",
      "challengeId": "example",
      "title": "挑战标题",
      "description": "本周规则摘要",
      "startsAt": "2026-10-05T00:00:00+08:00",
      "endsAt": "2026-10-12T00:00:00+08:00",
      "allowedModeIds": [],
      "mapId": null,
      "finalBossId": null,
      "rules": [
        { "id": "rule-example", "title": "规则名称", "description": "规则说明" }
      ],
      "effects": []
    }
  ]
}
```

`allowedModeIds` 为空数组表示不额外限制大厅难度；`mapId` 为 `null` 时沿用大厅地图选择；`finalBossId` 可固定本周最终首领，`null` 时沿用常规抽选。简报和本局存档使用挑战快照，不会在跨周或配置更新后改变。

游戏每次点击挑战入口都会向当前站点发送带随机参数、禁用缓存的 `HEAD` 请求，并用 HTTPS 响应 `Date` 头校时。网络请求失败、响应没有有效时间或当前时刻不在任何时间区间内时，挑战入口拒绝开始。设备本地时间和上次校时结果不作为兜底。

规则效果使用 `{ "hook": "...", "type": "...", "params": {} }` 描述。当前钩子包括 `unit.stats`（干员与召唤物最终属性）、`operator.bonds`（本局干员盟约）与 `enemy.pool`（随机敌池）。第一期按 PRTS 图鉴的「种类」字段筛选为「海怪」，并固定选择海怪类最终首领昆图斯。所有规则效果都从存档中的本局挑战快照读取；无挑战快照的基础模式走原有逻辑。新增规则时，在 `dist/native-challenges.js` 登记纯运行时处理器；新增结算位置时先登记钩子，再在会话／战斗结算入口调用 `runWeeklyChallengeHook`。构建期校验会拒绝未接入的钩子或未登记的效果类型。
