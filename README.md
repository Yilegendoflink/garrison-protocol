# 卫戍协议 · 同人独立模拟

这是可在浏览器独立运行的中文同人塔防自走棋游戏。源码无第三方 JavaScript 运行时依赖，以原生 ES modules、Canvas 2D 与 CSS 实现。

## 开发路线

整体路线见 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)，原作界面与操作的专项要求见 [UI_RESTORATION_PLAN.md](UI_RESTORATION_PLAN.md)。S0–S3工程交付候选已落地，详见 [S0_S3_DELIVERY.md](S0_S3_DELIVERY.md)。大厅与主要操作原型可用；部署已改为落点后拖动朝向确认。本轮进展及 S04–S06 未完成项见 [S4_S6_PROGRESS.md](S4_S6_PROGRESS.md)，演示战斗仍为改编内容。

## 发布安排

按用户要求，S06 全部验收通过后才建仓并发布 GitHub Pages，当前不发布试玩版。部署配置与条件见 [PUBLISHING.md](PUBLISHING.md)。

最终阶段已按用户要求增加无限生命木桩，支持 150 秒自动结束、手动结束及总伤害播报。原作数据、资源和实际接入边界见 [NATIVE_RULES_PROGRESS.md](NATIVE_RULES_PROGRESS.md)。

## 原作参考数据库

已建立基于PRTS的全目录干员／敌人参考数据库，包含SQLite、JSON、来源修订、采集器与查询校验工具。精确当前／历史原作表和内部ID映射见 [规范化数据库](data/normalized/README.md)。范围及完成度见 [data/prts/README.md](data/prts/README.md)。该数据库尚未替换游戏内的改编数据。

## 战斗基础系统

战斗规则与实现边界见 [COMBAT_SYSTEM.md](COMBAT_SYSTEM.md)。数值公式、范围索敌和攻击动作已独立分层，并接入现有游戏。当前共75项自动化测试，另有真实浏览器、触控与离线启动检查；原作单位数据与特殊机制仍需继续校准。

## 启动游戏

完整解压后，直接双击根目录的 `index.html`，会自动进入游戏；也可以直接打开 `dist/index.html`。无需安装 Node.js、Python 或 npm 依赖。

VS Code Live Server 同样支持：以项目文件夹为工作区打开根目录 `index.html`，或者直接访问 `dist/index.html`。所有资源使用相对路径，可在子目录中运行。字体和图片均不依赖外部网络请求。

详细说明见 `本地运行说明.md`。

## 实现范围

- 35 名干员、6 个调度等阶、15 种盟约、8 种装备、10 种局内策略。
- 3 张自制地图、3 种难度、16 轮防卫与条件触发的第 17 轮核心挑战。
- 干员招募（I 阶 2，II–IV 阶 3，V–VI 阶 4 资金，效果折扣另算）、出售（1 资金）、调度升级、回合升级折扣、刷新和冻结。
- 三名同名初始干员自动晋升精锐，保留部署位置，退回装备，免费选择高一阶干员。
- 10 个常规整备位、临时溢出整备区、装备二合一、每人最多两件装备、明确替换流程。
- 8 个初始部署位、朝向、射界、高台限制、移动与交换、阻挡、空中单位与不可阻挡敌人。
- 物理、法术与真实伤害，范围攻击、多目标、减速、晕眩、削防、护盾、持续回复、医疗无人机。
- 自动技能与基于冷却和部署费用的自动再部署，敌人波次与持续恶化，泥岩护盾、范围锤击和召唤巨像。
- 盟约由不同的已部署干员激活，通过获得、刷新、回合开始/结束、技能、击杀或被击倒等事件叠层。
- 回合结算、阶段策略、领袖战、胜负结算与伤害统计。
- 鼠标点击/拖动、手机点击、键盘布阵、1/2/4 倍速、暂停、音效与全屏。
- 基础资金第 n 轮为 n+3，初始 4，之后每轮 +1，不封顶且难度无影响；额外收益另算。
- 当前浏览器自动保存完整对局状态，暂离后 24 小时内可恢复（战斗默认暂停）；旧内容版本存档保留备份。

本版并非原版全内容或逐项数值复刻。地图、波次、属性、部分技能、盟约与策略效果经过网页适配重制；不包含全部干员、全部历期活动、四人在线同盟模拟或官方账号养成/兑换奖励。游戏内的「版本说明」明确展示这些范围。

## 源码结构

| 文件 | 作用 |
| --- | --- |
| `dist/data.js` | 干员、技能、盟约、装备、策略、地图和波次数据 |
| `dist/protocol.js` / `dist/status.js` | 原作期次数据解析、运营组件、自动技能政策与状态原语 |
| `dist/protocol-data.js` | 固定下半期资料页的构建产物 |
| `dist/engine.js` | 可序列化的对局状态机与固定步长战斗模拟 |
| `dist/renderer.js` | 棋盘、干员标记、敌人及战斗效果 |
| `dist/app.js` | 中文交互界面、模态决策、输入及自动保存 |
| `dist/style.css` | 终端界面及响应布局 |
| `tests/engine.test.mjs` | 游戏流程与战斗规则测试 |
| `tests/startup.test.mjs` | 打包脚本启动、界面初始化和资源路径回归测试 |
| `dist/game.bundle.js` | 可由本地文件直接载入的普通脚本构建产物 |
| `scripts/build-browser.mjs` | 无第三方依赖的浏览器脚本构建工具 |

使用 Node.js 22 或更新版本开发。修改原始 JavaScript 模块后，运行 `node scripts/build-browser.mjs` 或 `npm run build` 更新浏览器脚本。修改 HTML、CSS 和图片无需构建。

测试命令：`node --test tests/*.test.mjs` 或 `npm test`。无需先执行 `npm install`。

## 验证

初始启动修复曾执行 11 项测试：8 项既有对局测试，以及新增的实际打包脚本初始化、受限存储/缺少 ResizeObserver 时启动、子目录与 file URL 资源解析测试。启动测试使用 Node VM 和有限的宿主 API 替身，并非真实浏览器视觉或端到端测试。

此前另以 5 个固定随机种子验证实际资金条件下的运营与结算，得到正常通关及失败结果。

本次启动修复解决了界面函数重复声明 `note` 导致脚本无法解析的问题，并将根绝对路径改为相对路径。下载版使用预构建普通脚本，避免 `file://` 下 ES modules 无法载入；移除外部字体请求，并补充可见的加载状态及启动错误信息。

## 来源

- 规则参考：https://prts.wiki/w/卫戍协议 与 https://prts.wiki/w/卫戍协议/帮助。
- 干员和敌人图像来源：https://github.com/ArknightsAssets/ArknightsAssets2。
- 图像来源清单见 `dist/assets/asset-manifest.json`。
- 角色、名称和原始图像等权利属于鹰角网络及其关联公司。本作非官方作品；素材镜像的公开可访问性不构成开放图像许可。

## 开发预览与验收

触控部署专项使用 `npm run test:deployment`；本期资料页与暂离有效期使用 `npm run test:season`。

运行 `npm run dev` 后访问 http://127.0.0.1:5502 。另开终端运行 `npm run test:browser` 进行隔离浏览器验收；该命令需要Playwright和Edge，可通过PLAYWRIGHT_MODULE与BROWSER_EXECUTABLE指定路径。正常游玩不需要这些测试依赖。
