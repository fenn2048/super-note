import { describe, expect, it, vi, beforeEach } from "vitest";
import { importMemos, isDiaryCompatibleMedia, stripMemosHashtags } from "@/lib/importService";
import { api } from "@/lib/api";

// Polyfill File.prototype.text for jsdom environment if missing
if (typeof File !== "undefined" && !File.prototype.text) {
  File.prototype.text = function(this: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

// Mock the api module
vi.mock("@/lib/api", () => {
  return {
    api: {
      postDiary: vi.fn().mockResolvedValue({ id: "diary_id" }),
      importNotes: vi.fn().mockResolvedValue({ success: true, notes: [{ id: "1" }, { id: "2" }] }),
      updateNote: vi.fn().mockResolvedValue({ id: "note_id" }),
      getTags: vi.fn().mockResolvedValue([]),
      createTag: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
        id: `tag_${name}`,
        name,
      })),
      addTagToNote: vi.fn().mockResolvedValue({}),
      diaryImages: {
        upload: vi.fn().mockResolvedValue({ id: "image_id" }),
      },
      attachments: {
        upload: vi.fn().mockResolvedValue({
          id: "att_id",
          url: "/api/attachments/att_id",
          mimeType: "application/pdf",
          size: 100,
          filename: "doc.pdf",
          category: "file",
        }),
      },
    },
  };
});

describe("importMemos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully imports memos as diaries", async () => {
    const memosData = [
      {
        content: "Hello memos 1 #tag1",
        createdTs: 1680000000,
        visibility: "PUBLIC",
      },
      {
        content: "Hello memos 2 #tag2",
        createdTs: 1680000060,
        visibility: "PRIVATE",
      },
    ];

    const jsonFile = new File([JSON.stringify(memosData)], "memos.json", {
      type: "application/json",
    });

    const progressCallbacks: any[] = [];
    const onProgress = vi.fn((p) => {
      progressCallbacks.push(p);
    });

    const result = await importMemos(jsonFile, "diaries", onProgress, {
      workspaceId: "test-workspace-id",
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);

    expect(api.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tag1", workspaceId: "test-workspace-id" })
    );
    expect(api.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tag2", workspaceId: "test-workspace-id" })
    );

    expect(api.postDiary).toHaveBeenCalledTimes(2);
    // 标签已创建实体后，正文中的 #tag 应被去掉
    expect(api.postDiary).toHaveBeenNthCalledWith(
      1,
      {
        contentText: "Hello memos 1",
        images: [],
        visibility: "PUBLIC",
        createdAt: "2023-03-28 10:40:00", // 1680000000 UTC
        tagIds: ["tag_tag1"],
      },
      "test-workspace-id"
    );
    expect(api.postDiary).toHaveBeenNthCalledWith(
      2,
      {
        contentText: "Hello memos 2",
        images: [],
        visibility: "PRIVATE",
        createdAt: "2023-03-28 10:41:00", // 1680000060 UTC
        tagIds: ["tag_tag2"],
      },
      "test-workspace-id"
    );

    // Verify progress callbacks
    expect(progressCallbacks.some((p) => p.phase === "reading")).toBe(true);
    expect(progressCallbacks.some((p) => p.phase === "uploading")).toBe(true);
    expect(progressCallbacks.some((p) => p.phase === "done")).toBe(true);
  });

  it("successfully imports memos as notes", async () => {
    const memosData = [
      {
        content: "Hello memos 1 #tag1",
        createdTs: 1680000000,
        visibility: "PUBLIC",
      },
      {
        content: "Hello memos 2 #tag2",
        createdTs: 1680000060,
        visibility: "PRIVATE",
      },
    ];

    const jsonFile = new File([JSON.stringify(memosData)], "memos_backup.json", {
      type: "application/json",
    });

    const onProgress = vi.fn();

    const result = await importMemos(jsonFile, "notes", onProgress, {
      workspaceId: "test-workspace-id",
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);

    expect(api.importNotes).toHaveBeenCalledTimes(1);
    expect(api.importNotes).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Hello memos 1",
          notebookName: "Memos",
          notebookPath: ["Memos"],
        }),
        expect.objectContaining({
          title: "Hello memos 2",
          notebookName: "Memos",
          notebookPath: ["Memos"],
        }),
      ]),
      undefined,
      undefined,
      "test-workspace-id"
    );

    expect(api.addTagToNote).toHaveBeenCalledWith("1", "tag_tag1");
    expect(api.addTagToNote).toHaveBeenCalledWith("2", "tag_tag2");
  });

  it("uses explicit tags field and creates corresponding tags", async () => {
    const memosData = [
      {
        content: "explicit tags body",
        createdTs: 1680000000,
        visibility: "PRIVATE",
        tags: ["待消化", "思考"],
      },
    ];

    const jsonFile = new File([JSON.stringify(memosData)], "memos.json", {
      type: "application/json",
    });

    const result = await importMemos(jsonFile, "diaries", vi.fn(), {
      workspaceId: "test-workspace-id",
    });

    expect(result.success).toBe(true);
    expect(api.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ name: "待消化" })
    );
    expect(api.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ name: "思考" })
    );
    expect(api.postDiary).toHaveBeenCalledWith(
      expect.objectContaining({
        tagIds: expect.arrayContaining(["tag_待消化", "tag_思考"]),
      }),
      "test-workspace-id"
    );
  });

  it("classifies diary media vs file attachments", () => {
    expect(isDiaryCompatibleMedia("a.jpg")).toBe(true);
    expect(isDiaryCompatibleMedia("a.png", "image/png")).toBe(true);
    expect(isDiaryCompatibleMedia("v.mp4")).toBe(true);
    expect(isDiaryCompatibleMedia("s.mp3")).toBe(true);
    expect(isDiaryCompatibleMedia("doc.pdf")).toBe(false);
    expect(isDiaryCompatibleMedia("key.pem")).toBe(false);
    expect(isDiaryCompatibleMedia("x.bin", "application/pdf")).toBe(false);
    expect(isDiaryCompatibleMedia("x.bin", "image/*")).toBe(false);
  });

  it("strips hashtags from content after tags are created", () => {
    expect(stripMemosHashtags("又看到推荐《系统之美》#书籍推荐", ["书籍推荐"])).toBe(
      "又看到推荐《系统之美》"
    );
    expect(stripMemosHashtags("思考一下 #待消化 #信息", ["待消化", "信息"])).toBe("思考一下");
    // markdown 标题（# 后有空格）保留
    expect(stripMemosHashtags("# 标题\n正文 #tag", ["tag"])).toBe("# 标题\n正文");
  });
});
