#!/usr/bin/env node
/**
 * super-cli — Super Note 命令行工具
 *
 * 用法：
 *   super notes list              列出笔记
 *   super notes get <id>          查看笔记
 *   super notes create            创建笔记
 *   super notebooks list          列出笔记本
 *   super search <query>          搜索笔记
 *   super tasks list              列出任务
 *   super tags list               列出标签
 *   super ai ask <question>       知识库问答
 *   super ai process              AI 文本处理
 *   super config                  配置连接信息
 *
 * 环境变量：
 *   SUPER_URL       Super Note 后端地址（默认 http://localhost:3001）
 *   SUPER_USERNAME  登录用户名（默认 admin）
 *   SUPER_PASSWORD  登录密码（默认 admin123）
 */

import { Command } from "commander";
import chalk from "chalk";
import { SuperClient } from "./sdk-client.js";
import { registerNotesCommands } from "./commands/notes.js";
import { registerNotebooksCommands } from "./commands/notebooks.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerTasksCommands } from "./commands/tasks.js";
import { registerTagsCommands } from "./commands/tags.js";
import { registerAICommands } from "./commands/ai.js";
import { registerConfigCommand } from "./commands/config.js";

// ===== 读取配置 =====
export function getClient(): SuperClient {
  return new SuperClient({
    baseUrl: process.env.SUPER_URL || "http://localhost:3001",
    username: process.env.SUPER_USERNAME || "admin",
    password: process.env.SUPER_PASSWORD || "admin123",
  });
}

// ===== 主程序 =====
const program = new Command();

program
  .name("super")
  .description(chalk.bold("Super Note 命令行工具") + " — 从终端管理你的笔记")
  .version("1.0.0");

registerNotesCommands(program);
registerNotebooksCommands(program);
registerSearchCommand(program);
registerTasksCommands(program);
registerTagsCommands(program);
registerAICommands(program);
registerConfigCommand(program);

program.parse();
