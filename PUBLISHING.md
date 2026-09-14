# GitHub Pages 自动发布

仓库：https://github.com/Yilegendoflink/garrison-protocol
页面：https://yilegendoflink.github.io/garrison-protocol/

## 当前发布方式（2026-09-14）

用户要求每次推送后自动更新 Pages。发布源改为 GitHub Actions（build_type=workflow）。

- 推送 main 自动触发 .github/workflows/pages.yml；不设置路径过滤，因此文档提交也会触发。
- 使用 Node.js 24 执行 npm run build，将 dist 作为 Pages artifact 部署。
- 工作流只构建和部署，不运行自动测试或 release:check。
- github-pages 环境允许 main 部署；只给部署任务 pages:write 和 id-token:write 权限。
- 部署串行执行，不中断正在进行的发布。密集推送时 GitHub concurrency 可能合并等待中的任务，最终发布最新提交。
- 站点 deployment.json 包含 sourceCommit、deployedAt、testsRun=false 和 runUrl，可核对线上版本。
- 可在 Actions 页面手动运行该工作流重发 main；其他分支不会发布生产站点。

## 后续更新

提交代码后执行 git push origin main，等待 Actions 成功即可。无需手动同步 gh-pages，也不需要额外 PAT 或仓库 Secret。

排障时先查看该提交的 Actions 日志，再核对线上 deployment.json。构建或部署失败不代表新版已上线。

## 历史记录

2026-09-13 因手动 dispatch API 返回 500，曾采用 gh-pages 静态分支发布。该方式现已被自动工作流替代。artifacts/research/pages-publish-20260913 是旧独立工作副本，后续无需向它同步。
