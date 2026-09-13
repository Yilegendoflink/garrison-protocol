# GitHub Pages 发布约定

2026-09-13 用户将流程改为继续开发后不运行测试，上传 GitHub 并部署 Pages 供手动验收。工作流在 main 推送或手动触发后只构建和部署 dist，不执行 npm test 或 release:check。完整性报告保持真实状态，不因准备发布手动版而改成完成。

目标为 Yilegendoflink/garrison-protocol。当前公开仓库创建被自动审批拦截，尚无远程仓库或线上部署。后续需先解决此次审批拒绝，不绕过审批。

当前范围和未测试说明见 README.md、MANUAL_RELEASE.md。
