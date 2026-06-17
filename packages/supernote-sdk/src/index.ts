/**
 * @super/sdk — Super Note TypeScript SDK
 *
 * 用法：
 * ```ts
 * import { SuperClient } from "@super/sdk";
 *
 * const client = new SuperClient({
 *   baseUrl: "http://localhost:3001",
 *   username: "admin",
 *   password: "admin123",
 * });
 *
 * const notebooks = await client.listNotebooks();
 * ```
 */

export { SuperClient } from "./client.js";
export type * from "./types.js";
