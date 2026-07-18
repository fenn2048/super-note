#!/usr/bin/env node
/**
 * 一次性脚本：重新生成 Android splash（启动屏）PNG
 *
 * 设计与 app icon 统一：奶白底 + 居中靛蓝便签 + 镂空 N，简约无黑色。
 *
 * 输出覆盖 `frontend/android/app/src/main/res/drawable*` 下的 11 张 splash.png：
 *   - drawable/splash.png              480x320   (legacy / 默认)
 *   - drawable-land-{m,h,xh,xxh,xxxh}dpi/splash.png
 *   - drawable-port-{m,h,xh,xxh,xxxh}dpi/splash.png
 *
 * 品牌图形始终放在画布中央，并按较短边 40% 缩放，避免竖屏/横屏拉伸变形。
 *
 * 用法：node scripts/regen-android-splash.mjs
 * 依赖：根 node_modules/sharp
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const RES_DIR = path.join(
    REPO_ROOT,
    "frontend",
    "android",
    "app",
    "src",
    "main",
    "res",
);

// 与 app icon 保持一致的配色
const BG = "#F5F3EE"; // 奶白

// 居中品牌图：蜉蝣主标（方案 A）
const BRAND_PNG = path.join(
    REPO_ROOT,
    "frontend",
    "public",
    "brand",
    "fuyou-icon-1024.png",
);

// 目标尺寸清单（与现有项目中的 splash.png 尺寸严格一致，避免 Gradle 对 drawable
// 名称冲突提示或 aapt2 产出尺寸不匹配）
const TARGETS = [
    { rel: "drawable/splash.png", w: 480, h: 320 },
    { rel: "drawable-land-mdpi/splash.png", w: 480, h: 320 },
    { rel: "drawable-land-hdpi/splash.png", w: 800, h: 480 },
    { rel: "drawable-land-xhdpi/splash.png", w: 1280, h: 720 },
    { rel: "drawable-land-xxhdpi/splash.png", w: 1600, h: 960 },
    { rel: "drawable-land-xxxhdpi/splash.png", w: 1920, h: 1280 },
    { rel: "drawable-port-mdpi/splash.png", w: 320, h: 480 },
    { rel: "drawable-port-hdpi/splash.png", w: 480, h: 800 },
    { rel: "drawable-port-xhdpi/splash.png", w: 720, h: 1280 },
    { rel: "drawable-port-xxhdpi/splash.png", w: 960, h: 1600 },
    { rel: "drawable-port-xxxhdpi/splash.png", w: 1280, h: 1920 },
];

/**
 * 生成一张 splash：奶白底 + 居中品牌图
 * 品牌图按较短边的 40% 作为边长（确保竖屏/横屏下不会顶边、也不会太小）
 */
async function renderSplash(w, h, outFile) {
    const minSide = Math.min(w, h);
    const brandSize = Math.round(minSide * 0.4);

    if (!fs.existsSync(BRAND_PNG)) {
        throw new Error(`[regen-android-splash] 找不到品牌图：${BRAND_PNG}`);
    }
    const brandBuf = await sharp(BRAND_PNG)
        .resize(brandSize, brandSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

    // 奶白底 + 居中合成
    await sharp({
        create: {
            width: w,
            height: h,
            channels: 4,
            background: BG,
        },
    })
        .composite([
            {
                input: brandBuf,
                gravity: "center",
            },
        ])
        .png({ compressionLevel: 9 })
        .toFile(outFile);

    const kb = (fs.statSync(outFile).size / 1024).toFixed(2);
    console.log(
        `  wrote ${path.relative(REPO_ROOT, outFile)}  ${w}x${h}  brand=${brandSize}px  ${kb} KB`,
    );
}

async function main() {
    for (const t of TARGETS) {
        const outFile = path.join(RES_DIR, t.rel);
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        await renderSplash(t.w, t.h, outFile);
    }
    console.log("\nDone. Next: cd frontend/android && .\\gradlew.bat clean assembleRelease");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
