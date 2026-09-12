# GitHub 仓库与 Pages 发布

用户于 2026-09-12 明确选择：**等 S06 全部验收通过后，才创建 GitHub 仓库并发布 GitHub Pages。** 当前未创建远程仓库、未推送源码、未发布网页。

用户随后明确允许最终 Boss 阶段改为无限血量木桩，沿用原版倒计时并可手动结束，结束后播报总伤害；其余范围仍需完全一致。详见 [NATIVE_RULES_PROGRESS.md](NATIVE_RULES_PROGRESS.md)。

当前可试玩版本不满足此条件。`readiness.json` 的 `s6.acceptedScopeComplete` 为 false，S04／S05 也存在未完成项。不得只修改标志来绕过用户要求。

## 已准备的部署流程

`.github/workflows/pages.yml` 在 main 推送或手动运行时执行构建、规则／内容测试和 `npm run release:check`。检查失败会阻止上传站点和部署。只有 `dist/` 进入 Pages 站点；源码和资料库留在仓库中。

使用 GitHub 官方 Actions，Pages 作业依赖成功的构建作业，并使用 github-pages 环境和部署所需权限。配置依据：[GitHub 自定义 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。Action 版本已通过官方仓库最新 release 核实；实际发布前复核其支持状态。

## S06 完成后的执行顺序

1. 关闭 S04–S06 用户约定范围内所有影响玩法／操作的缺口（最终阶段使用已验收的木桩替代）。正式入口必须运行原作模式，并通过全部内容、难度、关键组合和原作对照验收；资料归档数量不作为完成依据。
2. 运行 `npm run build`、`npm test`、`npm run release:check`，以及当前浏览器、触控、资料页／恢复验收。同步源码版本、交接文档与校验清单。
3. 核对 GitHub 登录账号、待推送文件、素材来源说明及仓库名。当前登录账号为 Yilegendoflink；建议仓库名 garrison-protocol，若重名则先检查该仓库归属和用途，不覆盖既有项目。
4. 创建公开仓库并关联本地 origin。用户已经授权在完成后建仓和发布，无需重复索要同一授权；当前尚不执行此步骤。
5. 在仓库 Pages 设置中使用 GitHub Actions 作为发布来源，然后推送 main，等待工作流成功。
6. 打开实际 Pages 地址验证首页、子路径资源、购买、两段式部署、战斗、刷新恢复和浏览器控制台。检查部署对应本次提交；只有这些完成后才给出仓库与在线试玩链接。

GitHub Pages 托管的是静态客户端。同盟服务端属于 S07，不会通过这一静态工作流自动部署。
