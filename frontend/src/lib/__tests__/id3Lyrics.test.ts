import { describe, it, expect } from "vitest";
import {
  parseLrcText,
  findActiveLyricIndex,
  readUsLTFrame,
  readSYLTFrame,
  type LyricLine,
} from "../id3";

describe("parseLrcText", () => {
  it("parses standard LRC lines", () => {
    const raw = `
[00:12.00]第一句
[00:15.50]第二句
[01:02.123]第三句
`;
    const lines = parseLrcText(raw);
    expect(lines).not.toBeNull();
    expect(lines!.length).toBe(3);
    expect(lines![0]).toEqual({ time: 12, text: "第一句" });
    expect(lines![1].time).toBeCloseTo(15.5, 3);
    expect(lines![2].time).toBeCloseTo(62.123, 3);
  });

  it("supports multiple timestamps on one line", () => {
    const lines = parseLrcText("[00:01.00][00:10.00]重复句");
    expect(lines).toHaveLength(2);
    expect(lines![0].text).toBe("重复句");
    expect(lines![1].time).toBe(10);
  });

  it("returns null when no timestamps", () => {
    expect(parseLrcText("纯文本\n没有时间")).toBeNull();
    expect(parseLrcText("")).toBeNull();
  });
});

describe("findActiveLyricIndex", () => {
  const lines: LyricLine[] = [
    { time: 0, text: "a" },
    { time: 10, text: "b" },
    { time: 20, text: "c" },
  ];

  it("returns -1 before first line effectively still 0 if time 0", () => {
    expect(findActiveLyricIndex(lines, 0)).toBe(0);
  });

  it("picks last line with time <= current", () => {
    expect(findActiveLyricIndex(lines, 10)).toBe(1);
    expect(findActiveLyricIndex(lines, 15)).toBe(1);
    expect(findActiveLyricIndex(lines, 20.1)).toBe(2);
  });

  it("handles empty", () => {
    expect(findActiveLyricIndex([], 5)).toBe(-1);
  });
});

describe("readUsLTFrame", () => {
  it("reads UTF-8 USLT and detects embedded LRC", () => {
    // encoding=3 (UTF-8), lang=eng, empty descriptor \0, then LRC text
    const body = "\u0003eng\u0000[00:01.00]hello\n[00:02.00]world";
    const bytes = new TextEncoder().encode(body);
    const r = readUsLTFrame(bytes, 0, bytes.length);
    expect(r).not.toBeNull();
    expect(r!.lines).not.toBeNull();
    expect(r!.lines![0].text).toBe("hello");
    expect(r!.lines![1].time).toBe(2);
  });

  it("falls back to plain when no LRC", () => {
    const body = "\u0003chi\u0000没有时间戳的歌词";
    const bytes = new TextEncoder().encode(body);
    const r = readUsLTFrame(bytes, 0, bytes.length);
    expect(r).not.toBeNull();
    expect(r!.lines).toBeNull();
    expect(r!.plain).toContain("没有时间戳");
  });
});

describe("readSYLTFrame", () => {
  it("reads millisecond timestamps", () => {
    // encoding 3, eng, format=2 (ms), contentType=1, empty desc \0
    // entry: "hi"\0 + ts 1500ms
    const parts: number[] = [];
    parts.push(3); // utf-8
    parts.push(...[0x65, 0x6e, 0x67]); // eng
    parts.push(2); // ms
    parts.push(1); // content type
    parts.push(0); // empty descriptor
    const text = new TextEncoder().encode("hi");
    parts.push(...text, 0);
    const ts = 1500;
    parts.push((ts >>> 24) & 0xff, (ts >>> 16) & 0xff, (ts >>> 8) & 0xff, ts & 0xff);

    const buf = new Uint8Array(parts);
    const r = readSYLTFrame(buf, 0, buf.length);
    expect(r).not.toBeNull();
    expect(r!.lines).toHaveLength(1);
    expect(r!.lines![0].time).toBeCloseTo(1.5, 3);
    expect(r!.lines![0].text).toBe("hi");
  });
});
