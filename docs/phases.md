# momoko.pro 分阶段实施计划

## 阶段 0（设计）
- 本方案锁定（momoko GO）；sources 证据已清零（2026-08-08），机器配置 `config/sources.json`（当前全 `automated_fetch=false`；cron seam 允许逐项置 true——见 design.md §5.3）。
- 技术栈 ADR-11 已定（Astro+TS+pnpm+Ajv+Vitest+Playwright+Pagefind；Pages 走 Actions Direct Upload）。
- schema 正/反实例校验门已就绪：`tools/schema/validate_schemas.py` 全 cases 通过（计数以 `pnpm test`/`tests/schema.test.ts` 实际结果为准，不写死）。

## 阶段 1（MVP 并行工作包 A–E，互斥目录边界）

| 包 | owned files（互斥目录） | 接口（契约） | 依赖 | 验收测试 | 集成顺序 |
|---|---|---|---|---|---|
| **A. frontend/design-system** | `src/**`（Astro pages/components/styles）、`e2e/**` | 只读 content + build 产物契约（design.md §6） | 无（示例内容先行） | 三语路由、响应式、hreflang、CSP、缺译回退、`/` 语言选择页 | B 契约后并行 |
| **B. content-schema/CI** | `schemas/**`、`tools/schema/**`、`config/*.json`（校验） | schema+manifest 契约、job 输入/输出、schema_version/唯一键、content_hash 定义、双重构建确定性 | 无 | schema 正/反实例校验、幂等、无变化静默、双重构建确定性、迁移空库/旧库、CJK 搜索夹具+fallback | **先冻结契约** |
| **C. ingestion（cron+manual 双 seam）** | `tools/ingest/**` | B 的 schema/PR 接口、错误 enum、allowlisted hostname+source_id | B | 来源 allowlist、去重、错误 enum、bounded-root 文件写入（traversal/symlink/atomic）、cron 只跑 `automated_fetch=true` 已验证 adapter（false 走 manual-import；无允许来源/无变化静默） | B 后 |
| **D. i18n/editorial** | `content/**/content.<lang>.md`、`tools/editorial/**` | B schema + A 渲染契约；AI 只消费人工笔记；状态转移写入者 | B+C | 三语不撒谎、T 分级、stale、retract 原子、AI 输入边界、独立 reviewer 审计 | B+C 后 |
| **E. QA/deploy** | `.github/workflows/**`（**E 唯一拥有**）、`.github/CODEOWNERS`、`tests/**`、CI/CD、安全头、监控 | A–D 产物；secret 隔离、action pinning、远端 preview workflow_dispatch（人工触发） | A–D | MVP 测试矩阵（mvp-tests.md）、STRIDE 六类回归、恢复演练 | 收尾 |

集成顺序：**B 冻结契约 → A/C/D 并行 → E 收尾**。
分支策略：feature/package 分支各自开 PR，merge 前 rebase 到 main；冲突 fail-closed 人工解决。
发布流：Draft PR（无 secret 构建+Playwright+artifact）→ 独立 reviewer merge 前写 reviewed（T2 必须 human）→ 具 merge 权限 human/agent 合并 → main → build 派生 published → Direct Upload production。无 promote-review/自动晋级。

## 阶段 2
- 审核界面完善、stale 自动化、回滚/审计报告、监控告警、备份恢复演练。
- cron seam：某来源取得 robots/terms 许可证据并经人工批准后，置 `automated_fetch=true`，cron agent 抓取（重试/退避/死信/raw store 契约届时引入）；当前无允许来源时 cron 静默。

## 阶段 3（可选）
- R2 私有文件、Vectorize 语义搜索、订阅提醒、时间线可视化（各自 ADR 批准后）。

## 里程碑
- M1 设计锁定（阶段 0）；M2 MVP 可跑（A–E 集成）；M3 上线 + 监控 + 零成本验证。
