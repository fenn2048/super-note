#!/usr/bin/env node
/**
 * 估算 docker build context 大小（粗略模拟 .dockerignore）
 * 用法：node scripts/docker-context-size.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const diPath = path.join(root, ".dockerignore");

function parseDockerignore(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** 极简匹配：支持 *、**、前缀目录、basename */
function matchPattern(rel, pattern) {
  const r = rel.replace(/\\/g, "/");
  let p = pattern.replace(/\\/g, "/");
  if (p.endsWith("/")) p = p.slice(0, -1);

  if (p.startsWith("**/")) {
    const suf = p.slice(3);
    if (r === suf || r.endsWith("/" + suf)) return true;
    if (r.includes("/" + suf + "/") || r.startsWith(suf + "/")) return true;
    // **/foo/*.apk
    const re = new RegExp(
      "^" +
        suf
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, ".*")
          .replace(/\*/g, "[^/]*") +
        "$",
    );
    if (re.test(r) || re.test(path.basename(r))) return true;
  }

  if (p.includes("*")) {
    const re = new RegExp(
      "^" +
        p
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, "§§")
          .replace(/\*/g, "[^/]*")
          .replace(/§§/g, ".*") +
        "$",
    );
    if (re.test(r) || re.test(path.basename(r))) return true;
  }

  if (r === p || r.startsWith(p + "/")) return true;
  if (path.basename(r) === p) return true;
  return false;
}

function isIgnored(rel, patterns) {
  // 简化：无 negation 列表时，任意命中即 ignore
  for (const p of patterns) {
    if (p.startsWith("!")) continue;
    if (matchPattern(rel, p)) return true;
  }
  return false;
}

const patterns = fs.existsSync(diPath)
  ? parseDockerignore(fs.readFileSync(diPath, "utf8"))
  : [];

let total = 0;
let fileCount = 0;
const big = [];

function walk(dir, relBase = "") {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
    if (isIgnored(rel, patterns)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, rel);
    } else if (ent.isFile()) {
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      total += st.size;
      fileCount++;
      if (st.size >= 2 * 1024 * 1024) big.push({ size: st.size, rel });
    }
  }
}

walk(root);

big.sort((a, b) => b.size - a.size);
const mb = total / (1024 * 1024);
console.log(`docker context (approx, .dockerignore applied): ${mb.toFixed(1)} MB, ${fileCount} files`);
if (big.length) {
  console.log("files >= 2MB still in context:");
  for (const b of big.slice(0, 20)) {
    console.log(`  ${(b.size / 1024 / 1024).toFixed(1).padStart(6)} MB  ${b.rel}`);
  }
}
// 门禁：默认 80/200；带客户端安装包时（--with-assets）context 会到 ~80–120MB
const withAssets = process.argv.includes("--with-assets") || process.env.DOCKER_CONTEXT_WITH_ASSETS === "1";
const WARN_MB = withAssets ? 150 : 80;
const FAIL_MB = withAssets ? 280 : 200;
if (mb > FAIL_MB) {
  console.error(`\n[FAIL] context > ${FAIL_MB} MB — check .dockerignore (backend/data? packages?)`);
  process.exit(2);
}
if (mb > WARN_MB) {
  console.warn(`\n[WARN] context > ${WARN_MB} MB — consider trimming further`);
  process.exit(0);
}
console.log(`\n[OK] context under ${WARN_MB} MB target${withAssets ? " (with-assets)" : ""}`);
