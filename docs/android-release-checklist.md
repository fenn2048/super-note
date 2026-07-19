# Android 发版门禁清单

发版 APK / AAB 前按顺序勾选。与 `device-qa-checklist.md` 互补：本页偏工程与商店，后者偏真机交互。

## 0. 构建前

- [ ] `git status` 干净或已 intentional 改动
- [ ] 版本号：`frontend/android/app/build.gradle` 的 `versionName` / `versionCode` 已 bump
- [ ] 品牌：`strings.xml` 应用名、闪屏色与产品一致（蜉蝣）
- [ ] `bash scripts/sync-brand-splash.sh`（有原生目录时）
- [ ] 环境变量**未**设置 `CAP_LIVE_URL`（防 release 连局域网 dev server）

## 1. 构建

```bash
cd frontend
npm run build
npx cap sync android
# 签名 release：
cd android && ./gradlew assembleRelease   # 或 bundleRelease
```

- [ ] `assembleRelease` / `bundleRelease` 成功
- [ ] 产物路径与命名符合预期（如 `super-note-release-*.apk`）

## 2. 安装冒烟（真机）

- [ ] 冷启动：Splash → 登录/主界面，无白屏
- [ ] 登录键盘无底部白条
- [ ] 底栏四主路径可切换
- [ ] **分享入站**（文本 + 微信链）各 1 次
- [ ] **KeepAlive 默认关**；手动开/关各 1 次
- [ ] **播音频**出现媒体通知，暂停/下一曲可用
- [ ] **断网**顶栏离线提示；恢复后「已恢复连接」
- [ ] 系统字体「最大」：列表可滚动、底栏仍可用
- [ ] 分屏半屏：列表/底栏不严重裁切

## 3. 权限与合规

- [ ] 首次相机/麦克风为**按需**申请，非启动连弹
- [ ] 应用设置页可关通知各渠道
- [ ] `usesCleartextTraffic` 仅自托管场景需要；商店描述说明局域网 HTTP

## 4. 回归文件

- [ ] `docs/device-qa-checklist.md` 相关项已手测或注明跳过原因

## 5. 发布

- [ ] 变更说明（中文）准备完毕
- [ ] 如上传应用商店：隐私政策与权限声明与 `docs/PRIVACY.md` 一致
