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
    // 显式预构建：避免「504 Outdated Optimize Dep」拖垮按需 import
    //（fixed-layout.js → construct-style-sheets-polyfill → 阅读器整页挂）
    include: [
      "recharts",
      "construct-style-sheets-polyfill",
      "jszip",
      "@zip.js/zip.js",
    ],
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
    modulePreload: {
      polyfill: false,
      resolveDependencies: (_filename, deps) => {
        return deps.filter(dep =>
          !dep.includes("vendor-mermaid") &&
          !dep.includes("vendor-tesseract") &&
          !dep.includes("vendor-player") &&
          !dep.includes("vendor-pdf") &&
          !dep.includes("pdf.worker")
        );
      },
    },
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("mermaid")) return "vendor-mermaid";
          if (id.includes("tesseract")) return "vendor-tesseract";
          if (id.includes("artplayer") || id.includes("hls.js")) return "vendor-player";
          if (id.includes("pdfjs") || id.includes("foliate-js") || id.includes("/foliate/")) {
            return "vendor-pdf";
          }
          if (id.includes("katex")) return "vendor-katex";
          if (id.includes("jspdf") || id.includes("html2canvas")) return "vendor-export";
          if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
          if (id.includes("@codemirror") || id.includes("@lezer")) return "vendor-codemirror";
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
