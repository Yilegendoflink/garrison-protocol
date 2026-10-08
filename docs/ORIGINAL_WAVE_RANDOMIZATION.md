# 原版编组随机出怪

2026-10-08：新开普通对局默认使用原版编组模式。原表来源为 `source.json` 的 `specialEnemyInfoDict`（67组）、`specialEnemyRandomTypeDict`、`modeDataDict[].inactiveEnemyKey` 和 `common.constData`；关卡批次来自 `data/modes/alliance-lower/levels/`。实现入口为 `dist/native-wave-original.js` 与 `native-wave-random.js`。

- 六类特训抽三类；SPECIAL 是常驻通用池，不占三个特训名额。
- 第1–7回合只抽 `isInFirstHalf:true`，第8回合起只抽 false；每轮按 `randomWeight` 抽完整编组，不循环三类。组长、普通、精英来自同一条原表，三个槽位允许重复敌人ID。
- 难度禁用名单与本项目机制准入同时生效。组内任一成员未准入就排除整组，不删掉成员继续生成；当前67组中59组完整准入，之后再按难度/本局类型/前后半场过滤。不改变敌人机制的施工范围与准入状态。
- 将原关卡地面或飞行的普通、精英、组长占位槽替换为所抽编组，保留原批次 count/preDelay/interval/routeIndex；另一套移动类型占位槽不生成。固定敌人原样保留，因此第1轮两只源石虫继续出现。第3轮可能没有组长槽，第4轮起有组长；以模板为准。
- **数量仍为近似**：目前直接沿用原关卡槽位数量；服务器如何按敌人战斗力换算配额、保底与取整尚未核定，不使用自定预算伪称已还原。不保证逐组数量与原版实战相同。原表编组权重不等于每个角色的数量权重。
- 原版队列不调用旧的均匀分配规则；悬赏追加到原队列末尾，鸭爵替换保留原时间与路线。战前门口预览与实际战斗共用 `preparedDoorWave`，新增悬赏会使缓存失效。地图寻路规则不变。
- 最终Boss仍为既定4/5/7，30名增援、每3秒一名；原版模式下从本局三类特训的已准入后半场编组普通/精英成员抽取。不增加最终Boss范围。

## 配置与存档

`generation:'original'` 表示新默认模式，`generation:'budget'` 表示显式选择自定义预算；没有标记的旧自定义表仍兼容预算模式。加载与旧默认表等价的本地表时升级到 original（单独改过Boss血量倍率也保留并升级），实际改过的模板不覆盖。编辑器可切换两种模式，预算模板保留；导入旧JSON不自动改变其含义。出怪模式在开局记录中固定，配置切换只影响新局。

新原版对局 `waveRoster.version=3`，保存本局类型与每轮 groupId/waveSeed。已有v2对局保留旧词条轮换和预算生成；已保存的战斗队列不重抽。入门训练、每周挑战继续用各自原有预算/敌人池钩子，避免把限定种族挑战破坏成缺成员编组。

回归：`node --test tests/native-wave-*.test.mjs`，浏览器 `node scripts/regression-browser.mjs original-waves wave-activities`。

解包帖子参考：[卫戍协议怪组抽取机制一栏](https://www.bilibili.com/opus/1180364799493537800)（2026-03-18）；此帖早于终极模拟开放，数量与路径部分有推测，不能代替原表或实战取证。未闭环：服务器数量换算、重复抽取约束、终极难度是否额外修改抽取流程，以及8组受未准入成员影响的编组。
