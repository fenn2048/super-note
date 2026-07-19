import path from "path"
import fs from "node:fs"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// 读取根 package.json 的 version，注入到前端以便 UI 展示真实版本号
// （release.sh 会在发布时更新根 package.json 的 version 字段）
const rootPkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"),
) as { version?: string }
const APP_VERSION = rootPkg.version || "0.0.0"

export default defineConfig({
  // 使用绝对路径，确保嵌套路由 (例如 /share/:id) 能正确加载静态资源
  base: "/",
  root: path.resolve(__dirname),
  plugins: [react()],
  define: {
    // 编译期常量；使用 JSON.stringify 确保是带引号的字符串字面量
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@pdfjs/pdf.min.mjs": path.resolve(__dirname, "./src/foliate-js/vendor/pdfjs/pdf.mjs"),
      "@pdfjs": path.resolve(__dirname, "./src/foliate-js/vendor/pdfjs"),
    },
  },
  optimizeDeps: {
    entries: ["index.html"],
    esbuildOptions: {
      keepNames: true,
    },
  },
  build: {
    sourcemap: false,
    // 禁用 modulePreload polyfill 注入，避免某些 rollup 版本将
    // "vite/modulepreload-polyfill" 误识别为 source phase import 而报错。
    // 现代浏览器（Chrome 64+、Firefox 115+、Safari 17.5+）已原生支持 modulepreload，
    // Capacitor WebView 和 Electron 同样无需 polyfill。
    modulePreload: { polyfill: false },
    // 降低 chunk 大小警告阈值
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // 手动分包，降低构建内存峰值
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // 重型可选能力：独立 chunk，仅打开对应功能时加载
          if (id.includes("mermaid")) return "vendor-mermaid";
          if (id.includes("tesseract")) return "vendor-tesseract";
          if (id.includes("@mediapipe")) return "vendor-mediapipe";
          if (id.includes("artplayer") || id.includes("hls.js")) return "vendor-player";
          if (id.includes("pdfjs") || id.includes("foliate")) return "vendor-pdf";
          if (id.includes("@codemirror") || id.includes("/codemirror")) return "vendor-codemirror";
          if (id.includes("@tiptap") || id.includes("prosemirror")) return "vendor-tiptap";
          if (id.includes("framer-motion") || id.includes("lucide-react") || id.includes("react-icons")) {
            return "vendor-ui";
          }
          if (id.includes("react-dom") || id.includes("/react/") || id.endsWith("/react")) {
            return "vendor-react";
          }
          if (
            id.includes("jszip") ||
            id.includes("react-markdown") ||
            id.includes("remark-gfm") ||
            id.includes("turndown") ||
            id.includes("date-fns") ||
            id.includes("i18next")
          ) {
            return "vendor-utils";
          }
          // 其余 node_modules 归入 generic vendor（避免单包过大）
          return "vendor";
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    watch: {
      ignored: ["**/android/**", "**/ios/**"],
    },
    // 接受来自手机 App（Capacitor WebView）跨 origin 的 HMR WebSocket 握手。
    // 手机侧的 `capacitor.config.ts#server.url` 会把 WebView 直接指向
    // `http://<电脑LAN_IP>:5173`，此时 host 就是 LAN IP。
    // 不设 hmr.host 时 vite 会把 HMR clientScript 固定成某个值（通常是 localhost），
    // 导致手机端无法命中 HMR 通道——因此显式放开。
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // 后端的实时协作 WebSocket（Y.js presence / 协同编辑）也必须代理，
      // 否则手机端 `new WebSocket("/ws")` 会落到 vite 自己的 HMR server 上。
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
