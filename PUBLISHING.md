# GitHub Pages 发布约定

2026-09-13 用户将流程改为继续开发后不运行测试，上传 GitHub 并部署 Pages 供手动验收。工作流在 main 推送或手动触发后只构建和部署 dist，不执行 npm test 或 release:check。完整性报告保持真实状态，不因准备发布手动版而改成完成。

目标为 https://github.com/Yilegendoflink/garrison-protocol ，Pages 为 https://yilegendoflink.github.io/garrison-protocol/ 。用户已明确批准该目标及公开范围，仓库已创建；main 推送后由工作流构建和部署。

当前范围和未测试说明见 README.md、MANUAL_RELEASE.md。
