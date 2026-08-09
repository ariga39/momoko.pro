# momoko.pro Phase 2B ingestion seam — handoff (task #7, 翼/tsubasa)

Author: 翼（tsubasa）· peer: Mirai（未来）· 协调: momoko（桃子）
Branch: `phase2b/ingestion-final` · base: GitHub main `2ee05244527564e423c0aeb4cb4990ec4c8dbb8e`

## 交付对象（current-main successor）

- 代码 head: 本 exact tree 即交付对象（exact SHA 由 PR/线程机器记录，wrapper 不自引用自身 commit；代码事实以本文件为准）
- 独占文件：
  - `tools/ingest/ingest.ts`
  - `tests/ingest.test.ts`
  - `schemas/source.schema.json`（显式 robots_result/robots_path_decision 与 path-bound evidence；自动来源还必须声明 fetch_paths；旧 robots_approved 仅兼容读取）
  - `schemas/discovery-record.schema.json`（note_hash 可选——工具重算 canonical）
  - `config/sources.json`（S1–S5 显式 allowed=false 带证据）
  - `tests/schema.test.ts` / `tools/schema/validate_schemas.py`（审批字段同步）
  - `package.json` / `pnpm-lock.yaml`（补 `@types/js-yaml`）

## 契约

- cron 门：`runCron()` 只跑 `automated_fetch=true`、显式声明 `fetch_paths` 且每个请求路径通过 robots pure decision 的来源，并把相同路径传给 adapter；
  S1–S5 全 false → 静默 no-op。
- manual-import：`importDiscovery()` 校验 discovery-record schema、source 登记、urlInScope；
  identity = (source_id, source_item_id, lang)；content_hash 含 published_at+source_url；
  内容变化 → versioned successor（index-vN.md，跨年单调，不分叉）。
- 事务：批提交 = staging 树 + 原子 swap（rename 旧→backup、staging→root、失败恢复旧树）；
  import 单写失败结构化返回且清理空目录（零状态变化）；adapter null/非对象元素 fail-closed。
- 结构化失败：importDiscovery 写失败 → `{status:"error", code:"write_failed"}` 且清理空父目录（零状态）；
  adapter 返回 null/undefined/非对象、throw null/非 Error → `adapter_unexpected`（无 raw TypeError/异常）。
- commit 语义：`commitPlannedBatch` 返回 `{committed, cleanupResidue}`；swap 失败 → `errors.commit = "commit_failed: ..."`
  且恢复旧树（零状态）；backup 清理失败 → `errors.commit = "commit_ok_with_cleanup_residue"`（已提交 + 残留可观察，honest）。
- 安全：atomicWriteStaged resolve/relative-to 防逃逸 + symlink（含 root）拒绝 + temp 清理；
  urlInScope 完整 HTTPS origin + path segment + 拒 userinfo；note_hash timing-safe 比较。
- 版权/隐私：全离线合成测试，不注册服务/不接受条款/不写 GitHub/生产；跨源候选只标不吞。

## 验证（clean detached worktree，exact head）

- `pnpm check`（lint + Astro check strictest）→ 0 errors / 0 warnings（本任务文件）
- `pnpm test` → 68 passed（ingest 50）
- `pnpm build` OK；`python3 -m tools.schema.validate_schemas` 全 cases
- `git diff --check` clean；运行后 `git status --short` 为空

> 注：共享 checkout 存在 task #6 未跟踪 frontend 文件（src/components、a11y 等），其 Astro
> strictest 4 errors 属 task #6 范围；本 exact tree 不含这些文件，`pnpm check` 全绿。
