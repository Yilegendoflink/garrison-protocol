# 盟约下半期内容源

基础版本：`data/normalized/allianceLower.json`，公开游戏数据镜像固定提交 `86da4cfa3a4b958c3615fccf5afbc10b5c7f1bfb`。PRTS 查询器使用的活动表结构为 `activity.AUTOCHESS_SEASON.act2autochess` 与 `autoChessData`；这里固定使用历史提交，不使用 latest 覆盖历史规则。

- `source.json`：该期活动配置及共用规则，带原始完整 activity_table 的来源 URL、提交和 SHA-256；文件自身是相关区段提取，SHA 不表示提取后的文件。
- `levels/manifest.json`：50 份地图／波次／敌人及撤离战模板的 URL、提交和原始文件 SHA-256。
- `confirmed-rules.json`：用户于 2026-09-12 明确确认的资金规则。第 n 轮基础资金 n+3，无封顶，各难度一致；额外效果另算。该项来源是用户确认，不冒称公开活动表包含该公式。
- `catalog.json`：从原始表及历史基础库生成的可见预设、养成、装备、盟约、策略、地图、轮次和商店配置。
- `readiness.json`：数据数量、依赖目录、已实现原语与未完成机制。资料归档完整不等于所有内容可执行。

获取：`npm run data:fetch-mode`。生成：`npm run build`。不需要在正常离线游玩时访问这些网络源。

主要入口：[PRTS 模式帮助](https://prts.wiki/w/卫戍协议/帮助)、[PRTS 协议数据查询](https://static.prts.wiki/app/spdatabase/index.html)、[固定历史活动表](https://github.com/Kengxxiao/ArknightsGameData/blob/86da4cfa3a4b958c3615fccf5afbc10b5c7f1bfb/zh_CN/gamedata/excel/activity_table.json)。

公开表没有确认商店随机候选权重和全部动画事件时点。运营组件使用明确给定的候选，不以均匀随机假冒原作概率。当前技能依赖统计仅覆盖可见固定预设，动态甄选／助战依赖仍需本地档案解析。完整限制见项目根目录 `S4_S6_PROGRESS.md`。
