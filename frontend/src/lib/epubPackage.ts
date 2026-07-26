/**
 * Apple Books / macOS 常把 epub 存成「包」（Finder 里看起来是 .epub 文件，实际是目录）。
 * 浏览器无法把包当普通 File 读取 → NotFoundError / net::ERR_ACCESS_DENIED。
 * 本模块：从拖放的 FileSystemEntry / FileSystemHandle 收集内容，打成合法 epub zip 再导入。
 */

type CollectedEntry = { relativePath: string; blob: Blob };

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** 反复 readEntries，直到空批（Chrome 每次最多约 100 条） */
async function readAllDirectoryEntries(
  dirEntry: FileSystemDirectoryEntry
): Promise<FileSystemEntry[]> {
  const reader = dirEntry.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) break;
    all.push(...batch);
  }
  return all;
}

async function collectFromEntry(
  entry: FileSystemEntry,
  prefix: string
): Promise<CollectedEntry[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    const relativePath = normalizeRelPath(prefix + file.name);
    return [{ relativePath, blob: file }];
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const children = await readAllDirectoryEntries(dirEntry);
    const out: CollectedEntry[] = [];
    const nextPrefix = prefix + entry.name + "/";
    for (const child of children) {
      if (child.name === ".DS_Store" || child.name.startsWith("._")) continue;
      out.push(...(await collectFromEntry(child, nextPrefix)));
    }
    return out;
  }

  return [];
}

/** File System Access API：递归读 DirectoryHandle */
async function collectFromDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  prefix: string
): Promise<CollectedEntry[]> {
  const out: CollectedEntry[] = [];
  // 部分 TS lib.dom 未声明 values()；运行时 Chromium 均支持，用 entries 兼容类型
  const dir = dirHandle as FileSystemDirectoryHandle & {
    values?: () => AsyncIterableIterator<FileSystemHandle>;
    entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  };

  if (typeof dir.values === "function") {
    for await (const handle of dir.values()) {
      const name = handle.name;
      if (name === ".DS_Store" || name.startsWith("._")) continue;
      const rel = normalizeRelPath(prefix + name);
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile();
        out.push({ relativePath: rel, blob: file });
      } else if (handle.kind === "directory") {
        out.push(
          ...(await collectFromDirectoryHandle(
            handle as FileSystemDirectoryHandle,
            rel + "/"
          ))
        );
      }
    }
    return out;
  }

  if (typeof dir.entries === "function") {
    for await (const [name, handle] of dir.entries()) {
      if (name === ".DS_Store" || name.startsWith("._")) continue;
      const rel = normalizeRelPath(prefix + name);
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile();
        out.push({ relativePath: rel, blob: file });
      } else if (handle.kind === "directory") {
        out.push(
          ...(await collectFromDirectoryHandle(
            handle as FileSystemDirectoryHandle,
            rel + "/"
          ))
        );
      }
    }
  }

  return out;
}

/** 去掉根目录名，得到 epub 内相对路径 */
function stripRootPrefix(entries: CollectedEntry[], rootName: string): CollectedEntry[] {
  const root = rootName.replace(/\/+$/, "");
  const prefix = root + "/";
  return entries
    .map((e) => {
      let p = e.relativePath;
      if (p === root) return null;
      if (p.startsWith(prefix)) p = p.slice(prefix.length);
      if (!p || p.endsWith("/")) return null;
      return { relativePath: p, blob: e.blob };
    })
    .filter((e): e is CollectedEntry => !!e);
}

export function looksLikeExplodedEpub(paths: string[]): boolean {
  const set = new Set(paths.map((p) => p.replace(/\\/g, "/").toLowerCase()));
  if (set.has("mimetype")) return true;
  if (set.has("meta-inf/container.xml")) return true;
  for (const p of set) {
    if (p.endsWith("meta-inf/container.xml")) return true;
  }
  return false;
}

/**
 * 将解包 epub 目录内容打成标准 epub（zip）。
 * mimetype 使用 STORE（不压缩），符合 EPUB 规范。
 */
export async function packExplodedEpub(
  fileName: string,
  entries: CollectedEntry[]
): Promise<File> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const byPath = new Map<string, Blob>();
  for (const e of entries) {
    byPath.set(normalizeRelPath(e.relativePath), e.blob);
  }

  const mimeBlob = byPath.get("mimetype");
  if (mimeBlob) {
    const mimeText = (await mimeBlob.text()).trim() || "application/epub+zip";
    zip.file("mimetype", mimeText, { compression: "STORE" });
    byPath.delete("mimetype");
  } else {
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  }

  for (const [path, blob] of byPath) {
    zip.file(path, blob, { compression: "DEFLATE" });
  }

  const packed = await zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const name = fileName.toLowerCase().endsWith(".epub") ? fileName : `${fileName}.epub`;
  return new File([packed], name, {
    type: "application/epub+zip",
    lastModified: Date.now(),
  });
}

async function packFromCollected(rootName: string, collected: CollectedEntry[]): Promise<File> {
  // collectFromDirectoryHandle 路径不含根名；collectFromEntry 含根名
  const hasRootPrefix = collected.some(
    (e) =>
      e.relativePath === rootName ||
      e.relativePath.startsWith(rootName + "/")
  );
  const stripped = hasRootPrefix ? stripRootPrefix(collected, rootName) : collected;
  const paths = stripped.map((e) => e.relativePath);

  if (!looksLikeExplodedEpub(paths)) {
    throw new Error(
      `「${rootName}」是文件夹/包而不是 epub 压缩包，且内部不像电子书结构（缺少 mimetype / META-INF）。` +
        `桌面上已可使用「${rootName.replace(/\.epub$/i, "")}-fixed.epub」这类真正的 zip epub 导入。`
    );
  }

  return packExplodedEpub(rootName, stripped);
}

async function packDirectoryEntry(dirEntry: FileSystemDirectoryEntry): Promise<File> {
  const collected = await collectFromEntry(dirEntry, "");
  return packFromCollected(dirEntry.name, collected);
}

async function packDirectoryHandle(dirHandle: FileSystemDirectoryHandle): Promise<File> {
  const collected = await collectFromDirectoryHandle(dirHandle, "");
  return packFromCollected(dirHandle.name, collected);
}

/**
 * 从 DataTransfer 解析可导入的电子书 File 列表。
 * - 普通文件：原样返回（调用方再 materialize）
 * - 目录 / macOS epub 包：自动打成 zip epub
 */
export async function collectBookFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<File[]> {
  const items = dataTransfer.items;
  const results: File[] = [];

  if (items && items.length > 0) {
    const tasks: Promise<File>[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || item.kind !== "file") continue;

      tasks.push(resolveDataTransferItem(item));
    }

    const settled = await Promise.all(tasks);
    for (const f of settled) {
      if (f) results.push(f);
    }

    if (results.length > 0) return results;
  }

  return Array.from(dataTransfer.files || []);
}

async function resolveDataTransferItem(item: DataTransferItem): Promise<File> {
  // 1) 现代 API：更能识别 macOS package 为 directory
  const anyItem = item as DataTransferItem & {
    getAsFileSystemHandle?: () => Promise<FileSystemHandle>;
  };
  if (typeof anyItem.getAsFileSystemHandle === "function") {
    try {
      const handle = await anyItem.getAsFileSystemHandle();
      if (handle) {
        if (handle.kind === "directory") {
          return packDirectoryHandle(handle as FileSystemDirectoryHandle);
        }
        if (handle.kind === "file") {
          const file = await (handle as FileSystemFileHandle).getFile();
          // 若 getFile 成功但实际是包，后续 materialize 会给出明确提示
          return file;
        }
      }
    } catch {
      // 继续尝试 legacy entry
    }
  }

  // 2) webkit entry
  const entry =
    typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;

  if (entry?.isDirectory) {
    return packDirectoryEntry(entry as FileSystemDirectoryEntry);
  }

  if (entry?.isFile) {
    try {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      // 探测是否可读；包常在此失败
      try {
        const head = await file.slice(0, 4).arrayBuffer();
        if (head.byteLength > 0) return file;
      } catch {
        /* fallthrough */
      }
      if (/\.epub$/i.test(file.name) && (file.size === 0 || !(await canReadFile(file)))) {
        throw new Error(epubPackageAccessHint(file.name));
      }
      return file;
    } catch (err) {
      if (err instanceof Error && err.message.includes("Apple Books")) throw err;
      const name = (err as DOMException)?.name;
      const fallbackName =
        (typeof item.getAsFile === "function" && item.getAsFile()?.name) || "book.epub";
      if (
        name === "NotFoundError" ||
        name === "NotAllowedError" ||
        name === "SecurityError" ||
        /\.epub$/i.test(fallbackName)
      ) {
        throw new Error(epubPackageAccessHint(fallbackName));
      }
      throw err;
    }
  }

  const file = item.getAsFile();
  if (file) return file;

  throw new Error("无法从拖放项中获取文件");
}

async function canReadFile(file: File): Promise<boolean> {
  try {
    const buf = await file.slice(0, 4).arrayBuffer();
    return buf.byteLength > 0;
  } catch {
    return false;
  }
}

/**
 * 若 File 读失败且扩展名是 epub，给出针对「解包目录」的提示。
 */
export function epubPackageAccessHint(fileName: string): string {
  const base = fileName.replace(/\.epub$/i, "");
  return (
    `「${fileName}」是 macOS / Apple Books 的解包目录（不是 zip 格式的 epub），浏览器无法直接读取。\n\n` +
    `请任选其一：\n` +
    `1) 导入桌面上的「${base}-fixed.epub」（已生成的标准压缩包）\n` +
    `2) 在终端打包后再导入：\n` +
    `   cd ~/Desktop && zip -X0 "${base}-fixed.epub" -j "${fileName}/mimetype" && ` +
    `cd "${fileName}" && zip -Xr9D "../${base}-fixed.epub" * -x mimetype\n` +
    `3) 若拖放时浏览器能识别为文件夹，应用会自动打包（请直接拖到书库区域）`
  );
}
