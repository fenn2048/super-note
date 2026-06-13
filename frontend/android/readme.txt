Listed directory super-note
Listed directory packages
Listed directory frontend
Viewed package.json:1-136
Viewed README.md:1-200
Viewed capacitor.config.ts:1-75
Listed directory android
Viewed build_signed_debug_apk.sh:1-150

这个项目的前端（`frontend`）是一个基于 **React + TypeScript + Vite** 构建的 Web 应用，并使用 **Capacitor** 将其打包为 Android/iOS 原生应用（混合 App）。

由于它是 Capacitor 项目，调试通常分为 **原生层调试（Java/Kotlin）** 和 **前端网页层调试（React/JS/CSS）**。以下是使用 Android Studio 和 Chrome 调试该 Android 端的详细操作步骤：

---

### 第一步：准备工作（环境配置）

1. **安装 Android Studio**：确保电脑上已安装 Android Studio，并配置好了 Android SDK。
2. **开启手机的 USB 调试**：
   - 如果使用**物理 Android 手机**：在手机设置中开启“开发者选项”和“USB 调试”，然后用数据线连接电脑（选择传输文件模式）。
   - 如果使用**模拟器（Emulator）**：在 Android Studio 的 Device Manager 中创建并启动一个 Android 虚拟设备（AVD）。
3. **确保 JDK 环境**：编译 Android 项目建议使用 JDK 17 或 JDK 21（Android Studio 会自带并配置好，无需过于担心）。

---

### 第二步：编译前端并同步至 Android 目录

在打开 Android Studio 之前，需要先将最新的 React 前端代码打包并同步到 Android 原生工程的 assets 目录中：

```bash
# 1. 进入前端目录
cd frontend

# 2. 安装依赖
npm install

# 3. 编译 React 网页端
npm run build

# 4. 将编译产物同步到 Android 工程
npx cap sync android
```
*(你也可以直接使用 package.json 中配置的命令 `npm run cap:build`，它会一键执行 build 和 sync 动作。)*

---

### 第三步：在 Android Studio 中打开并调试

#### 1. 打开项目
你可以通过命令行一键唤起 Android Studio 打开项目：
```bash
npx cap open android
# 或者运行 npm 脚本：
npm run cap:open
```
*如果上述命令未成功唤起，你也可以手动操作：打开 Android Studio，选择 **Open**，然后选择本项目的 `frontend/android` 文件夹（请确保选择的是 `frontend/android` 目录，而不是项目根目录）。*

#### 2. 等待 Gradle 同步
首次打开项目时，Android Studio 会在后台自动执行 Gradle 同步并下载相关依赖（可以在右下角看到进度条）。请耐心等待其同步完成。

#### 3. 运行与调试
* 在 Android Studio 顶部工具栏中：
  - **运行配置** 选择 `app`。
  - **目标设备** 选择你连接的真机或启动的模拟器。
* 点击**绿色的“Bug”图标（Debug 'app'）**（快捷键：macOS 为 `Control + D` 或 `Shift + F9`）来启动调试。
* Android Studio 将编译项目、生成 Debug APK，并自动将其安装到你的设备上运行。此时你可以在 Android Studio 中为任何 **Java/Kotlin** 原生代码（如插件、`MainActivity.java`）打断点进行调试。

---

### 第四步：调试前端网页（React/JS/Console/Network）

因为 React 运行在 Android 的 `WebView` 容器内，Android Studio 无法直接捕获前端的日志和网络请求。我们需要使用 **Chrome DevTools**：

1. 确保手机上的 App 正在运行，且手机已通过 USB 连接到电脑。
2. 在电脑上打开 **Google Chrome** 浏览器。
3. 在地址栏输入并回车：`chrome://inspect`
4. 在页面中，你会看到 **Remote Target** 列表，其中会显示你的设备名称以及正在运行的 WebView（标识为 `com.super.note` 或 `Ark Notes`）。
5. 点击其下方的 **Inspect**（检查）按钮。
6. 这时会弹出一个独立的 Chrome DevTools 窗口。你可以在这里：
   - 在 **Console** 面板查看 `console.log` 输出和前端报错。
   - 在 **Network** 面板查看 App 发出的 API 请求（方便排查局域网后端连接问题）。
   - 在 **Elements** 面板调试 CSS 样式。
   - 在 **Sources** 中为 React 源码打断点调试。

---

### 💡 极速开发技巧：使用 Live Reload（热重载）调试

每次修改 React 代码都去运行 `npm run build` 和 `npx cap sync android` 非常繁琐。Capacitor 支持**热重载（Live Reload）**，让真机直接加载你电脑上的 Vite 开发服务器，改动代码秒级刷新：

1. **获取电脑局域网 IP**（例如 `192.168.1.100` 或本地开发 IP）。确保你的手机和电脑连接了**同一个 Wi-Fi**。
2. 在 `frontend` 目录下运行带有局域网 IP 的命令：
   ```bash
   # 将 IP 替换为你电脑的局域网 IP
   export CAP_LIVE_URL=http://<电脑局域网IP>:5173
   
   # 同步配置并启动
   npx cap sync android
   ```
   *(项目 `package.json` 中也提供了现成的快捷脚本：若你的电脑 IP 刚好匹配脚本里的默认值，可直接运行 `npm run cap:live:open`)*
3. 开启前端 Vite 服务：
   ```bash
   npm run dev
   ```
4. 在 Android Studio 中点击 **Debug** 运行 App。
5. 此时只要你修改 `frontend/src` 下的任意 React 代码，手机上的界面就会实时热更新，同时你依然可以使用 `chrome://inspect` 进行调试。

> [!WARNING]
> **发布 Release 包时务必清除该变量**：在打正式包或 Release 包时，请确保不要设置 `CAP_LIVE_URL`（或者不要将 `capacitor.config.ts` 中的 `server.url` 写入本地 IP），否则打包出来的 APK 在其他设备上会因找不到该局域网 IP 而导致白屏。

终极解决方案：使用 ADB USB 端口转发（最推荐 🌟）
如果你正用数据线连接着手机进行调试，完全不需要走 Wi-Fi 网络。你可以利用 Android SDK 提供的 adb reverse 命令，通过 USB 数据线直接建立局域网隧道，将手机的端口流量重定向到电脑上。

这种方法完全免疫防火墙限制、Wi-Fi 隔离、VPN 干扰等问题，且速度极快。

操作步骤：
确认手机已连接： 在电脑终端运行以下命令，确保能看到你的安卓设备：
bash


adb devices
反向代理端口（将手机上的 5173 和 3001 端口流量转发至电脑）：
bash


# 转发前端 Vite 端口（如果你的 Vite 启动在 5174，请改为 5174）
adb reverse tcp:5173 tcp:5173
# 转发后端 API 端口
adb reverse tcp:3001 tcp:3001
设置 Live Reload 地址为 localhost： 在终端运行：
bash


export CAP_LIVE_URL=http://localhost:5173
npx cap sync android
测试访问： 现在，在手机的浏览器中直接打开： http://localhost:5173 你就会惊奇地发现，手机可以直接通过 USB 访问到你电脑上的 Vite 服务了！App 内的后端连接地址也可以直接填 http://localhost:3001。
🌐 常规排查：无线 Wi-Fi 访问超时排查步骤
如果你必须使用 Wi-Fi 无线调试，请依次确认以下 4 点：

1. 关闭手机上的 VPN / 代理软件
如果你的手机上开启了 Clash、Shadowrocket（小火箭）、V2rayNG、AdGuard 等代理或网络过滤软件，它们默认会接管手机的所有网络流量，从而导致手机无法解析并连接本地局域网 IP（192.168.x.x）。

解决办法：在手机上彻底关闭这些软件，或者在软件设置中将局域网 IP 设为直连（Bypass LAN）。
2. 检查 macOS 电脑防火墙
Mac 的系统防火墙经常默认拦截外来连接。

排查方法：在 Mac 上打开 系统设置 -> 网络 -> 防火墙。
解决办法：尝试临时关闭防火墙；或者点击“选项”，确保 node 或 Vite 允许接收传入连接。
3. 检查是否在同一 Wi-Fi & 路由器隔离
同网络：确保手机和电脑连的是同一个 Wi-Fi 名字（SSID）。（例如：电脑连了网线，手机连了 Wi-Fi，或者一个连了主路由，另一个连了信号放大器/副路由，都有可能导致不在一个网段）。
AP 隔离（AP Isolation）：部分路由器（尤其是公司网络、公共场所 Wi-Fi 或某些智能路由器的“访客网络”）开启了“AP 隔离”功能，禁止连接该 Wi-Fi 的设备互相通信。
验证方法：用手机开一个手机热点，让电脑连接手机的热点，然后重新运行 npm run dev 并用热点分配给电脑的 IP 访问。如果此时能通，说明是路由器设置了隔离。
4. 确认电脑 IP 是否正确
有时候电脑有多个虚拟网卡（比如 Docker、虚拟机等创建的虚拟 IP），Vite 输出的 192.168.5.71 可能是错误的网卡 IP。

确认方法：在 Mac 终端运行 ifconfig，或者在 系统设置 -> Wi-Fi -> 详细信息 中查看当前 Wi-Fi 网卡真实的局域网 IP，确保填入的是正确的 IP。