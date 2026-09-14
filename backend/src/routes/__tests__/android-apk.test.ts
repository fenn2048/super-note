import test from "node:test";
import assert from "node:assert/strict";
import {
  pickAndroidApkAsset,
  giteeDownloadUrl,
  githubProxyDownloadUrl,
} from "../releases.js";

test("pickAndroidApkAsset prefers Super-Note-x.y.z.apk over debug", () => {
  const picked = pickAndroidApkAsset([
    { name: "super-note-debug.apk", browserDownloadUrl: "http://x/debug.apk" },
    { name: "Super-Note-1.1.96.apk", browserDownloadUrl: "http://x/rel.apk" },
    { name: "notes.yml", browserDownloadUrl: "http://x/yml" },
  ]);
  assert.equal(picked?.name, "Super-Note-1.1.96.apk");
});

test("pickAndroidApkAsset falls back to the only apk", () => {
  const picked = pickAndroidApkAsset([{ name: "app.apk" }]);
  assert.equal(picked?.name, "app.apk");
});

test("pickAndroidApkAsset returns undefined when no apk", () => {
  assert.equal(pickAndroidApkAsset([{ name: "setup.exe" }]), undefined);
});

test("giteeDownloadUrl encodes filename and normalizes tag", () => {
  assert.equal(
    giteeDownloadUrl("cropflre", "super-note", "1.1.96", "Super-Note-1.1.96.apk"),
    "https://gitee.com/cropflre/super-note/releases/download/v1.1.96/Super-Note-1.1.96.apk",
  );
  assert.equal(
    giteeDownloadUrl("cropflre", "super-note", "v1.1.96", "Super Note 1.1.96.apk"),
    "https://gitee.com/cropflre/super-note/releases/download/v1.1.96/Super%20Note%201.1.96.apk",
  );
});

test("githubProxyDownloadUrl prefixes once", () => {
  const src = "https://github.com/cropflre/super-note/releases/download/v1.1.96/Super-Note-1.1.96.apk";
  const proxied = githubProxyDownloadUrl(src);
  assert.equal(proxied, `https://ghproxy.net/${src}`);
  assert.equal(githubProxyDownloadUrl(proxied), proxied);
});
