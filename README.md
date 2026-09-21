# 卫戍协议：盟约下半 · 手动验收版

非官方同人项目。主入口已连接历史下半期数据、运营控制器与 native 战斗循环。

源码仓库：[Yilegendoflink/garrison-protocol](https://github.com/Yilegendoflink/garrison-protocol)

在线试玩：[GitHub Pages](https://yilegendoflink.github.io/garrison-protocol/)

给后续开发者的当前事实见 [AGENTS.md](AGENTS.md)。

## 概述

你也没玩够，我也没玩够。我有没用完的codex额度，所以这个项目就这么出现了

数据库来自PRTS。一部分玩法逻辑来自我和群友的记忆，还有一部分是一点点自由发挥 添加一抹奇幻色彩。

彩蛋部分代码来自 https://github.com/ophixation/325calculator

## 当前版本

已接上主对局的：本期 112 名可见预设、初始／精锐养成、技能选择、地图裁切、轮次；购买、晋升、装备、两段式部署、准备／作战／决策／结算、存档；大厅 → 战前准备 → 对局；词条预算随机波次与编制台；职业分支基础层；公共结算（伤害／治疗／回复／流失／退场）；112 名 `descriptor-v1` 适配入口（`needsSpecialHandler=0`）；战斗费用账本与整备资金分离；部分敌人移动／攻击策略。

最终领袖阶段仍是无限生命木桩，150 秒且允许手动结束；报告只统计本阶段伤害。

工作区可能还有未提交的战斗盟约改动，不以工作区草稿当作已发布内容。

2026-09-13 的地图裁切、预置工事、分支规则修正仍然有效，详见 [BRANCH_RULES.md](BRANCH_RULES.md)。

## 已知差异

此版本可供人手动点，**不是完整复刻成品**。

- 未取得服务端完整商店／奖励池权重，当前采用受候选条件限制的等权抽取。
- 112 名均有适配层入口，不等于技能／天赋／模组已逐项对照。能力状态表里 `verified` 只覆盖抽样场景。
- 特殊召唤站位选择、精确动作释放帧、部分敌人特殊能力、地图环境／装置动态破坏仍有缺口。
- 战斗盟约、复杂策略、特殊刷新／冻结、道具和机变仍在补；不要把侧栏盟约计数当成效果已全部执行。
- 同盟联机和完整甄选／助战档案尚未接入。

页面「已知差异」也会提示这些范围。手动反馈时请导出存档并附复现步骤。

## 本地运行与构建

直接打开根目录 `index.html`，或运行 `npm run dev` 后访问 http://127.0.0.1:5502 。开发需要 Node.js 22+（Pages 使用 24）。`npm run build` 只编译；推送 `main` 会自动部署 Pages，工作流不运行测试。

## 源码入口

- `dist/native-play.js`、`dist/native-lobby.js`、`dist/native.css`：大厅、战前准备、对局与两段式部署。
- `dist/native-session.js`：主对局、商店、装备、阶段与存档。
- `dist/native-economy.js`、`dist/garrison.js`、`dist/strategy.js`：运营事件。
- `dist/native-battle.js`、`dist/native-combat.js`、`dist/native-effects.js`、`dist/native-operator-effects.js`：战斗循环、结算与逐名适配。
- `dist/native-sp.js`、`dist/native-waves.js`、`dist/native-wave-editor.js`：技力与波次编制。
- `scripts/build-native.mjs`：将固定历史库编入客户端。
- 我方干员模型资源、动作清单和自制动画包约定见 [动画数据库](data/operator-animations/README.md)；独立采集与校验，尚未接入棋盘播放。
- `dist/legacy.html`：此前的演示与资料库。

期次资料见 `data/modes/alliance-lower/README.md`。早期阶段文档作为历史记录保留；当前事实以本页和 `AGENTS.md` 为准。

## TODO

- 补全大部分特殊敌人行为机制，例如复活、解压缩
- 补全最终BOSS战
- 实装小人动画和更精致的特效
- 支持自定义追加原创干员、盟约、敌人、BOSS
- 支持联机（有可能吗？）

## 来源

规则来源：[PRTS 下半期页面](https://prts.wiki/w/卫戍协议：盟约_下半)。基础数据使用固定提交的公开游戏数据镜像，每份表及关卡记录来源。头像清单见 `dist/assets/prts/manifest.json`，旧素材清单见 `dist/assets/asset-manifest.json`。

角色、美术与原始游戏内容的权利属于鹰角网络及相关权利人，本项目非官方产品。公开下载地址不代表原始素材采用开放许可。
