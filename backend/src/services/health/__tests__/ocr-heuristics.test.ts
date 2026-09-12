/**
 * 运行：cd backend && npx tsx --test src/services/health/__tests__/ocr-heuristics.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  structureHealthFromOcrText,
  structureMedicineFromOcrText,
} from "../ocr-heuristics.js";

test("structureHealthFromOcrText extracts date and hospital", () => {
  const text = `某某市中医院
开方日期：2024年5月12日
医师：张三
诊断：小儿咳嗽病
处方：
杏仁 10g
桔梗 6g
共 7 剂 水煎服`;
  const s = structureHealthFromOcrText(text, "prescription_tcm");
  assert.equal(s.occurredAt, "2024-05-12");
  assert.match(s.hospital || "", /中医院/);
  assert.ok(s.prescription?.includes("杏仁"));
  assert.ok(s.confidence > 0.3);
});

test("structureHealthFromOcrText exam findings", () => {
  const text = `血常规报告
白细胞 6.5
血红蛋白 130`;
  const s = structureHealthFromOcrText(text, "exam_lab");
  assert.match(s.documentType, /exam/);
  assert.ok(s.examFindings?.includes("白细胞"));
  assert.ok(!s.prescription);
});

test("structureMedicineFromOcrText name and expiry", () => {
  const text = `通用名称：阿莫西林胶囊
规格：0.25g×24粒
生产企业：某某制药
有效期至：2026年08月01日
用法用量：口服`;
  const s = structureMedicineFromOcrText(text);
  assert.match(s.name || "", /阿莫西林/);
  assert.equal(s.expiryDate, "2026-08-01");
  assert.ok(s.spec);
});
