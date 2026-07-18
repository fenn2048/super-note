/**
 * ACL 角色 → 权限映射单测（阶段 0：名实一致）
 *
 * 运行：
 *   cd backend && npx tsx --test src/middleware/__tests__/acl.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  roleToPermission,
  hasPermission,
  hasRole,
  type WorkspaceRole,
  type Permission,
} from "../acl.js";

test("roleToPermission: strict ladder", () => {
  assert.equal(roleToPermission("viewer"), "read");
  assert.equal(roleToPermission("commenter"), "comment");
  assert.equal(roleToPermission("editor"), "write");
  assert.equal(roleToPermission("admin"), "manage");
  assert.equal(roleToPermission("owner"), "manage");
});

test("viewer cannot write or manage", () => {
  const p = roleToPermission("viewer");
  assert.equal(hasPermission(p, "read"), true);
  assert.equal(hasPermission(p, "comment"), false);
  assert.equal(hasPermission(p, "write"), false);
  assert.equal(hasPermission(p, "manage"), false);
});

test("commenter can comment but not write", () => {
  const p = roleToPermission("commenter");
  assert.equal(hasPermission(p, "read"), true);
  assert.equal(hasPermission(p, "comment"), true);
  assert.equal(hasPermission(p, "write"), false);
  assert.equal(hasPermission(p, "manage"), false);
});

test("editor can write but not manage", () => {
  const p = roleToPermission("editor");
  assert.equal(hasPermission(p, "write"), true);
  assert.equal(hasPermission(p, "manage"), false);
});

test("admin and owner can manage", () => {
  assert.equal(hasPermission(roleToPermission("admin"), "manage"), true);
  assert.equal(hasPermission(roleToPermission("owner"), "manage"), true);
  assert.equal(hasPermission(roleToPermission("admin"), "write"), true);
});

test("hasRole ordering", () => {
  const roles: WorkspaceRole[] = ["viewer", "commenter", "editor", "admin", "owner"];
  for (let i = 0; i < roles.length; i++) {
    for (let j = 0; j <= i; j++) {
      assert.equal(hasRole(roles[i], roles[j]), true, `${roles[i]} should satisfy ${roles[j]}`);
    }
    for (let j = i + 1; j < roles.length; j++) {
      assert.equal(hasRole(roles[i], roles[j]), false, `${roles[i]} should not satisfy ${roles[j]}`);
    }
  }
});

test("hasPermission null is deny", () => {
  const required: Permission[] = ["read", "comment", "write", "manage"];
  for (const r of required) {
    assert.equal(hasPermission(null, r), false);
  }
});
