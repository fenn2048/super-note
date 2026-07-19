#!/usr/bin/env node
/**
 * 后端生产构建：esbuild 打成单文件 dist/index.js + 极简 runtime package.json
 *
 * external（必须真实 node_modules）：
 *   - better-sqlite3 / sqlite-vec*  原生 .node
 *   - sharp / @img/*                 原生与平台包
 *   - bonjour-service                动态加载
 *   - unpdf                          ESM + worker 资源
 *   - bufferutil / utf-8-validate    ws 可选原生加速（optional）
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outdir = join(__dirname, "dist");
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const external = [
  "better-sqlite3",
  "sqlite-vec",
  "sqlite-vec-windows-x64",
  "sqlite-vec-darwin-x64",
  "sqlite-vec-darwin-arm64",
  "sqlite-vec-linux-x64",
  "sqlite-vec-linux-arm64",
  "bonjour-service",
  "unpdf",
  "sharp",
  // sharp 平台子包（require 动态路径）
  "@img/sharp-libvips-dev",
  "@img/sharp-libvips-dev/cplusplus",
  "@img/sharp-libvips-dev/include",
  "@img/sharp-wasm32",
  "@img/sharp-wasm32/versions",
  // optional ws natives
  "bufferutil",
  "utf-8-validate",
];

// 捕获所有 @img/* 与 sqlite-vec-* 为 external
const externalPatterns = [/^@img\//, /^sqlite-vec-/];

const start = Date.now();
await build({
  entryPoints: [join(__dirname, "src", "index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: join(outdir, "index.js"),
  external,
  plugins: [
    {
      name: "mark-native-external",
      setup(buildApi) {
        buildApi.onResolve({ filter: /.*/ }, (args) => {
          if (externalPatterns.some((re) => re.test(args.path))) {
            return { path: args.path, external: true };
          }
          return null;
        });
      },
    },
  ],
  minify: false,
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
  logOverride: {
    "unsupported-dynamic-import": "silent",
    "unsupported-require-call": "silent",
  },
});

// 运行时仅需这些生产依赖（版本锁到当前 package.json）
const runtimeDeps = {
  "better-sqlite3": pkg.dependencies["better-sqlite3"],
  "sqlite-vec": pkg.dependencies["sqlite-vec"],
  "bonjour-service": pkg.dependencies["bonjour-service"],
  unpdf: pkg.dependencies["unpdf"],
  sharp: pkg.dependencies["sharp"],
};

const runtimePkg = {
  name: "super-note-backend-runtime",
  version: pkg.version || "0.0.0",
  private: true,
  main: "index.js",
  dependencies: runtimeDeps,
};

writeFileSync(join(outdir, "package.json"), JSON.stringify(runtimePkg, null, 2) + "\n");

const ms = Date.now() - start;
const size = statSync(join(outdir, "index.js")).size;
console.log(`[backend bundle] done in ${ms}ms -> dist/index.js (${(size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`[backend bundle] external: ${external.filter((e) => !e.includes("/")).join(", ")}`);
console.log(`[backend bundle] runtime package.json deps: ${Object.keys(runtimeDeps).join(", ")}`);
