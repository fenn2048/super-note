# 记账模块（Finance / Ledger）— 实现说明

> 设计全文见会话 plan；本文档记录已落地的实现要点，便于后续迭代。

## 技术选型

- **真源**：SQLite 复式记账（`finance_*` 表，migration v36）
- **不依赖** Go beancount-gs / Python bean-query
- 算法与 UX 参考 `beancount-gs` / `beancount-web`

## 后端

| 路径 | 说明 |
|------|------|
| `backend/src/db/migrations.ts` v36 | 全量表结构 |
| `backend/src/routes/finance.ts` | REST API |
| `backend/src/services/finance/*` | 解锁、交易、规则、统计、建议 |
| `backend/src/services/finance/parsers/*` | 账单自动识别与解析 |

API 前缀：`/api/finance`  
敏感接口需 Header：`X-Finance-Unlock`（有密码账本）。

## 前端

| 路径 | 说明 |
|------|------|
| `frontend/src/components/finance/FinanceCenter.tsx` | 记账中心（列表/解锁/概览/明细/导入/账户/规则/统计/建议） |
| `frontend/src/lib/api.ts` → `api.finance` | 客户端封装 |
| 导航 | `navigation.config` + NavRail / 移动「我的」 |

## 导入渠道（样例回归）

| 渠道 | 扩展名 | 说明 |
|------|--------|------|
| alipay | csv (GBK/UTF-8) | 自动识别 |
| wechat | xlsx | 自动识别 |
| jd | csv | 自动识别 |
| 工/招/广发信用卡 | eml | 自动识别 |
| 招/交/工行储蓄卡 | pdf/txt | 自动识别 |
| 建行储蓄卡 | xls | 自动识别 |

流程：上传 → detect+parse → 规则打标 → 预览二次编辑 → commit。

## 金额

全程 **整数分**（`amountMinor`），展示层 `/100`。

## 导出

- `GET /api/finance/ledgers/:id/export?format=csv|beancount`
- 需解锁；前端顶栏「下载」/「.bean」

## 生物识别解锁（移动端）

- 启用：`POST .../bio-enable` → `bioToken` 存 SecureStorage
- 解锁：`POST .../unlock-bio` + 系统指纹/面容
- 改密自动吊销 bio token
- 实现：`frontend/src/lib/financeBio.ts`

## 导入规则（对齐 beancount-gs / beancount-web）

**匹配条件**
- 对方 peer / 类型 type / 商品 item / 分类 category / 支付方式 method
- AND / OR 逻辑、完全匹配 / 包含、多值分隔符
- 金额 min/max/精确；日内时间 HH:MM-HH:MM；时间戳范围
- 平台：tradeNo / orderNo / transactionId / merchantId / transactionCode 等

**执行动作**
- 目标账户、默认支付账户、支付方式映射列表
- 默认收入/支出账户、标签、忽略

**API**
- `GET/POST .../import/rules`（扁平字段或 match/action 嵌套）
- `POST .../import/rules/reorder`、`POST .../import/rules/test`
- 导入时 `ruleIds=ALL` 或指定规则

**前端**
- `RulesPanel.tsx` 完整编辑抽屉；导入页可选规则；预览显示命中规则名

## 导入增强

- 行级「存为规则」：对方关键词 → 分类账户
- 筛选：全部 / 待确认 / 就绪 / 重复；全选可导入
- **跨源去重**：同日同额 + 时间/对方近似 → 标 duplicate（可强制导入）
- 批量设置分类/资产账户；`POST .../import/batches/:id/bulk`

## 预算（v38）

- 表 `finance_budgets`：按 `yearMonth` + 可选支出账户
- 进度 = 当月 Expenses posting / 预算额
- 建议页合并预算超支洞察
- `POST .../budgets/copy` 从上月复制（可 overwrite）

## 交易编辑与模板

- `PATCH .../transactions/:txId` 更新头字段与分录
- `GET|POST|DELETE .../templates` 常用记账模板
- 前端：明细编辑按钮；记一笔可存模板 / 点选模板

## 首页

- `GET /api/finance/overview`：账本列表 + 已解锁账本的本月收支（锁定账本不返回金额）
- Dashboard「本月记账」卡片，点击进入 finance

## 定期记账（v39）

- 表 `finance_recurring`：monthly / weekly / interval
- `autoPost=1` 到期自动写交易 + 通知；`0` 仅通知
- 后台 `finance-worker` 每 10 分钟扫描；也可 `POST /finance/recurring/run-due`
- 去重键 `sourceRef=recurring:{id}:{date}`

## 预算告警

- `finance_alert_log` 防重复：每月每预算 near(≥85%) / over(>100%) 各通知一次
- worker 内 `processBudgetAlerts`；类型 `finance_budget_warn` / `finance_budget_over`

## 统计（对齐 beancount-web）

- KPI：资产 / 收入 / 支出 / 负债 / 结余 / 净资产，可隐藏金额
- Tab：
  1. 月度收支 — Area 折线（`/stats/months`）
  2. 资产负债 — 累计余额曲线（`/stats/balance-series`）
  3. 每日趋势 — 当月日折线（`/stats/trend`）
  4. 分类占比 — 环形图 + 图例（支出/收入）
  5. 商户排行 — 列表 + 进度条（累计/频次/均额）
- 前端：`StatsDashboard.tsx` + recharts；已去掉简陋柱状块

## 共享账本

- `finance_ledgers.workspaceId`：NULL=个人；非空=工作区共享
- 访问：个人仅 owner；共享 = 创建者 + 工作区任意成员
- 删除/改密：创建者 或 工作区 admin/owner
- 创建：`POST /ledgers` 传 `workspaceId`（需 editor+）
- 列表/概览聚合个人 + 成员可见共享账本

## 定期收入

- 定期支持 kind=income / expense
- UI 快捷：工资 / 房租 / 物业费

## V1 后置

- 投资 FIFO、Beancount 源文件在线编辑、共享账本成员级只读角色细分
