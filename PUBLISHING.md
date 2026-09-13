# GitHub Pages 发布约定

用户于2026-09-13明确批准将当前手动验收版、源码、数据／素材及版本历史公开到其账号，并要求不运行测试。

仓库：https://github.com/Yilegendoflink/garrison-protocol

页面：https://yilegendoflink.github.io/garrison-protocol/

## 当前发布方式

- main 保存完整源码、数据与构建产物。
- Pages 使用 gh-pages 分支根目录，build_type 为 legacy；.nojekyll 表示直接发布静态构建。
- 首次发布尝试的自定义 Actions dispatch API 连续返回500，因此改为上传已有 dist 到 gh-pages。配置源后再推送部署元数据，已触发 GitHub 的 pages build and deployment。
- 页面 deployment.json 记录其来源提交、发布时间以及 testsRun=false。
- .github/workflows/pages.yml 仅保留手动备用入口。使用前须把 Pages 发布源切换为 GitHub Actions；当前 main 推送不会自动同步静态分支。

## 后续更新

按用户要求仅运行 npm run build，随后将 dist 内容同步到 gh-pages，保留 .nojekyll 并更新 deployment.json，再推送该分支。应通过已配置的本地系统代理访问GitHub；不要修改全局代理，不要把凭据写入仓库。

此次本地暂存目录为 artifacts/research/pages-publish-20260913，已被主仓库忽略。它是独立的 gh-pages 工作副本，不要在该目录覆盖或提交 main 的完整资料库。

仅确认发布服务状态和线上部署元数据，不进行游戏功能测试。机制差异及本轮未测试说明见 README.md、MANUAL_RELEASE.md。
