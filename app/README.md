# 卫戍协议 Android 容器

这是与网页工程并列的 Android Studio / Gradle 工作区。App 使用 Kotlin WebView 打开远程页面，游戏代码仍由所选网页源发布。

## 构建

需要 JDK 17、Android SDK Platform 36 和 Gradle Wrapper：

```powershell
cd app
.\gradlew.bat assembleDebug
```

APK 输出到 `app/build/outputs/apk/debug/GarrisonProtocolAndroid-debug.apk`。

## Release APK

Release 使用 `signing.properties` 指定的本地 keystore 签名；keystore 与属性文件已列入 `.gitignore`，不要提交或丢失，否则后续版本无法覆盖安装到同一设备。配置 `storeFile`、`storePassword`、`keyAlias`、`keyPassword` 后运行：

```powershell
.\gradlew.bat assembleRelease
```

APK 输出到 `app/build/outputs/apk/release/GarrisonProtocolAndroid-release.apk`。未配置本地签名信息时会生成未签名 APK。

## 来源标记

新部署首页在 `<head>` 声明：

```html
<meta name="garrison-app-id" content="garrison-protocol">
<meta name="garrison-app-shell" content="1">
```

自定义来源必须有这两个标记。两个固定内置站点在过渡期间也接受现有首页签名（正确标题、`boot-screen`、`app` 与 `native.bundle.js`），因此旧 Cloudflare 部署无需等待 App 才能打开。首页标记用于识别兼容站点，不是防伪签名；发布者授权需由来源 URL 本身或更强的签名机制另行确认。

## 离线缓存

访问过的同源 GET 资源会写入 App 私有目录，并通过 ETag / Last-Modified 在下次访问时验证。来源页提供 `android-assets.json` 时，可在来源页点击“预缓存此来源的全部离线资源”；缓存文件会按该清单中的大小和 SHA-256 校验。无清单的自定义站点仍支持按需缓存。缓存按来源隔离，容量上限 768 MB；超出时先淘汰最久未访问的资源。清除 App 数据或卸载 App 会移除缓存和该 WebView 来源下的网页存档。

## 存档

网页保留原有 JSON 格式与校验流程。Android 容器用系统文件选择器保存／打开 JSON 文件，单文件限制 10 MB。

## Cloudflare Pages

若 Cloudflare Pages 由本仓库构建且运行 `npm run build`，它会收到相同首页标记及 `android-assets.json`。若该站点使用另一份构建源，需要在对应首页加入上述两个 meta，并发布同格式的资源清单；没有清单时会退回按需缓存。
