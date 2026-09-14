import { describe, expect, it } from "vitest";
import { buildAndroidApkCandidateUrls } from "@/lib/androidUpdate";

describe("buildAndroidApkCandidateUrls", () => {
  it("puts the server proxy first, then Gitee, GitHub, ghproxy, local debug apk", () => {
    const urls = buildAndroidApkCandidateUrls({
      serverBase: "http://192.168.1.8:3001",
      release: {
        tag: "v1.1.96",
        version: "1.1.96",
        assets: [
          {
            name: "Super-Note-1.1.96.apk",
            browserDownloadUrl:
              "https://github.com/cropflre/super-note/releases/download/v1.1.96/Super-Note-1.1.96.apk",
          },
        ],
      },
      androidApkUrl: "/api/releases/android-apk/latest.apk",
    });

    expect(urls[0]).toBe("http://192.168.1.8:3001/api/releases/android-apk/latest.apk");
    expect(urls).toContain(
      "https://gitee.com/cropflre/super-note/releases/download/v1.1.96/Super-Note-1.1.96.apk",
    );
    expect(urls).toContain(
      "https://github.com/cropflre/super-note/releases/download/v1.1.96/Super-Note-1.1.96.apk",
    );
    expect(urls).toContain(
      "https://ghproxy.net/https://github.com/cropflre/super-note/releases/download/v1.1.96/Super-Note-1.1.96.apk",
    );
    expect(urls).toContain("http://192.168.1.8:3001/downloads/super-note-debug.apk");
    expect(urls.filter((u) => u.includes("android-apk/latest.apk"))).toHaveLength(1);
  });

  it("skips GitHub releases page as a download url", () => {
    const urls = buildAndroidApkCandidateUrls({
      serverBase: "https://note.example.com",
      androidApkUrl: "https://github.com/cropflre/super-note/releases/latest",
    });
    expect(urls).not.toContain("https://github.com/cropflre/super-note/releases/latest");
  });
});
