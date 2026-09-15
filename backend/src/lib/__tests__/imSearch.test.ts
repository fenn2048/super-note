/**
 * 运行：cd backend && npx tsx --test src/lib/__tests__/imSearch.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { imSearchKindClause, sqliteTzModifier, sqliteUtcFromQuery } from "../imSearch.js";

test("sqliteUtcFromQuery parses ISO to sqlite UTC", () => {
  const sql = sqliteUtcFromQuery("2026-09-15T16:00:00.000Z");
  assert.equal(sql, "2026-09-15 16:00:00");
});

test("sqliteUtcFromQuery accepts YYYY-MM-DD as midnight", () => {
  assert.equal(sqliteUtcFromQuery("2026-09-15"), "2026-09-15 00:00:00");
});

test("sqliteUtcFromQuery rejects junk", () => {
  assert.equal(sqliteUtcFromQuery(""), null);
  assert.equal(sqliteUtcFromQuery("nope"), null);
});

test("sqliteTzModifier converts JS getTimezoneOffset to sqlite modifier", () => {
  assert.equal(sqliteTzModifier(-480), "+480 minutes");
  assert.equal(sqliteTzModifier(0), "+0 minutes");
  assert.equal(sqliteTzModifier(300), "-300 minutes");
  assert.equal(sqliteTzModifier("nope"), "+0 minutes");
});

test("imSearchKindClause only allows the whitelist", () => {
  assert.equal(imSearchKindClause("text"), "msg.type = 'text'");
  assert.match(imSearchKindClause("link") || "", /https:\/\//);
  assert.equal(imSearchKindClause("card"), "msg.type = 'card'");
  assert.match(imSearchKindClause("image") || "", /msg\.type = 'image'/);
  assert.match(imSearchKindClause("video") || "", /video\/%/);
  assert.equal(imSearchKindClause("sticker"), null);
  assert.equal(imSearchKindClause("'; drop table"), null);
});
