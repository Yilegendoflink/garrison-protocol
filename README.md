# 卫戍协议：盟约下半 · 手动验收版

非官方同人项目。主入口现已连接历史下半期数据、新运营控制器与战斗循环，旧版35人演示保留在 `dist/legacy.html`。

源码仓库：[Yilegendoflink/garrison-protocol](https://github.com/Yilegendoflink/garrison-protocol)

在线手动验收：[GitHub Pages](https://yilegendoflink.github.io/garrison-protocol/)

## 当前版本

2026-09-13 按用户要求准备供手动测试的版本。**本轮只构建，不运行自动测试或浏览器测试；不能据此认定全部原作机制完成。** 旧文档中的75项通过记录属于上一版，不适用于新主对局。

主对局使用本期可见固定预设、初始／精锐养成、技能选择、地图裁切及轮次与波次数据；连接购买、晋升、装备、布阵、运营特质、准备／作战／决策／结算和存档。数据包括258个可解析养成状态、50份关卡模板、215条敌人引用及376份头像资产。

最终领袖阶段改为无限生命木桩，150秒且允许手动结束；报告统计本阶段总伤害、DPS和单位贡献。

## 已知差异

此版本是手动验收版本，**不是完整复刻成品**。

- 未取得服务端完整商店／奖励池权重，当前采用受候选条件限制的等权抽取，部分特殊池尚有差异。
- 技能通用属性、技力、弹药与普通攻击已接入；特殊召唤、形态、逐段技能、天赋／模组以及精确动作释放帧未全部实现。
- 敌人基础属性、移动、阻挡和攻击已接入；部分敌人特殊能力、服务端随机替换和地图环境效果仍有差异。
- 已接入的运营事件与部分战斗盟约／策略不代表全部效果。炎佑、复杂联动、部分特殊刷新／冻结、道具和机变仍需继续完善。
- 同盟联机服务和完整甄选／助战档案尚未接入。

页面“已知差异”也会提示这些范围。手动反馈时请导出存档并附复现步骤。

## 本地运行与构建

直接打开根目录 `index.html`，或运行 `npm run dev` 后访问 http://127.0.0.1:5502 。开发需要 Node.js 24，执行 `npm run build` 生成客户端。此命令只构建编译；Pages工作流也只构建和部署，不运行测试。

## 源码入口

- `dist/native-play.js`、`dist/native.css`：主界面与两段式部署。
- `dist/native-session.js`：主对局、商店、装备、阶段与存档。
- `dist/native-economy.js`、`dist/garrison.js`、`dist/strategy.js`：运营事件。
- `dist/native-battle.js`：数据驱动的战斗循环与木桩。
- `scripts/build-native.mjs`：将固定历史库编入客户端。
- `dist/legacy.html`：此前的演示与资料库。

原始资料与路线见 `DEVELOPMENT_PLAN.md`、`NATIVE_RULES_PROGRESS.md`、`data/modes/alliance-lower/README.md`。早期阶段文档作为历史记录保留，以本页及 `MANUAL_RELEASE.md` 为准。

## 来源

规则来源：[PRTS 下半期页面](https://prts.wiki/w/卫戍协议：盟约_下半)。基础数据使用固定提交的公开游戏数据镜像，每份表及关卡记录来源。头像清单见 `dist/assets/prts/manifest.json`，旧素材清单见 `dist/assets/asset-manifest.json`。

角色、美术与原始游戏内容的权利属于鹰角网络及相关权利人，本项目非官方产品。公开下载地址不代表原始素材采用开放许可。
