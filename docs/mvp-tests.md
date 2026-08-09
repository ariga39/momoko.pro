# momoko.pro MVP 测试矩阵

## 架构与部署（Git canonical + GitHub Actions Direct Upload + Cloudflare Pages 静态）
- [ ] Git canonical 内容文件；Draft PR → 独立 reviewer merge 前写 reviewed（T2 必须 human）→ 具 merge 权限 human/agent 合并 → CI → 静态发布
- [ ] **manifest 不提交仓库**：构建期全量生成到 dist；**双重构建确定性**（同内容构建两次逐字节一致，失败即 fail）
- [ ] preview：PR 仅无 secret 构建 + Playwright + artifact；prod：main merge 部署（见安全 I/E）
- [ ] 零成本断言：**无运行时 Worker / KV / Cron Trigger / D1 / Queues / R2 / Vectorize / Pages Functions / 原生 Git 集成**（代码层无调用 + 部署面单一=Actions Direct Upload）
- [ ] 静态资产请求免费且不限量断言（官方 pricing 页快照核对）
- [ ] Pages 限制断言（500 builds/mo、20k files、25MiB/file、100 custom domains 用量低于阈值）
- [ ] 备份：Git 历史可恢复内容；**artifact 过期不可当备份**；恢复演练每季度一次 RTO≤1 工作日；回滚 = revert PR

## 三语与审核
- [ ] canonical + alternate(hreflang) 正确（zh/ja/en + x-default）
- [ ] 缺译文回退源语言 + 显式标注
- [ ] 原文变 → 译文 stale，不显示为已审核
- [ ] 状态机：**正/反转移表**校验（draft→reviewed 由独立 reviewer 在 merge 前提交且 reviewer/time 非空；reviewed→published 仅 build 派生；published 不在 canonical enum→draft / reviewed→draft / 跳过 → fail）
- [ ] **published 不回写 canonical**：重建后 main 上 reviewed 内容再次派生 published，不回退
- [ ] `/` 为语言选择页或固定静态 302；无服务端 Accept-Language 读取

## 风险分级 T0/T1/T2
- [ ] T0 只自动生成文件/PR，**仍需独立 reviewer review（T2 必须 human）+ 具 merge 权限合并；MVP 不自动合并/发布**（无 auto-merge 路径）
- [ ] T1 默认草稿；质量证据后人工开启 + 抽检/熔断/一键撤回
- [ ] T2 永久人工（人物/健康/争议/纠错/来源冲突/法律版权/悼念/模型不确定）
- [ ] 模糊/冲突 → 升级人工

## 内容管线（MVP：cron+manual 双 seam → schema → AI 草稿 → PR）
- [ ] 幂等/去重：同 `(source_id, source_item_id, lang)` + hash 不重复；重跑无 diff（静默）
- [ ] manual-import：allowlisted hostname+source_id 校验、schema 校验、去重、生成 PR；错误 enum 映射正确；**不提交 manifest**
- [ ] cron adapter（`automated_fetch=true` 来源）：按 fetch_frequency 抓取、去重、生成 PR；**无变化静默**；当前无允许来源时 cron 无输出
- [ ] ai-draft：**只消费人工事实笔记/批准短摘录，不打开 URL**；外部正文不入 repo/prompt log/artifact；输出恒 draft
- [ ] reviewer-before-merge：独立 reviewer（human/授权 agent，非生成 agent）在 merge 前显式提交 reviewed_by/reviewed_at（T2 必须 human）；生成 agent 只开 Draft PR、不自审/自合；具 merge 权限 human/agent 合并；无 promote-review bot / workflow 写回 / 硬编码 reviewer 身份
- [ ] stale-check：源 hash 变化 → 三语 reviewed 译文原子置 stale
- [ ] retraction：合并后同一 build 原子过滤
- [ ] schema_version 迁移：空库/旧库可迁移；迁移脚本可重入；`tools/schema/migrations/*` 单次执行
- [ ] **schema 正/反实例全量校验**：每 canonical 类型（content/locale/discovery/anniversary/retraction/manifest/source）至少各 1 正例+1 反例，含 published 拒绝、reviewed 无 reviewer/time 拒绝、uri/date-time format 拒绝（严格 RFC3339：date-only/无时区/非法日拒绝，hostname 拒绝 `-x`/`..`）、automated_fetch=true 需非 manual 频率（false 需 manual）；`tools/schema/validate_schemas.py` 用真实 FormatChecker 通过
- [ ] **cron seam**：cron 只运行 `automated_fetch=true` 且 robots/terms 已验证的来源 adapter；false 来源只走 manual-import；无允许来源/无变化静默；当前 S1–S5 全 false 时 cron 无输出

## 版权/来源边界
- [ ] 无 X embed/iframe、无 X API、无 X 抓取（X 仅人工 permalink 卡片；**不复制 post 文本/图片**，只存 account/date/permalink/人工说明）
- [ ] 无官方素材托管/声线克隆；**无完整台词/台词库/随机台词渲染**
- [ ] 来源只来自 `config/sources.json` allowlist；robots/terms 证据与 config 一致；`automated_fetch` 值与证据一致（当前全 false）
- [ ] 无硬编码 reviewer 身份/自动晋级（momoko 自动化上限）；内容判断由人工/授权 agent 在 GitHub review 完成
- [ ] 机器配置（config/sources.json）与人类证据（docs/sources.md）一致

## 安全（STRIDE 六类映射）
- [ ] **S**：allowlisted HTTPS hostname + source_id 校验；author≠reviewer
- [ ] **T**：schema+content_hash 校验、双重构建确定性比对
- [ ] **R**：GitHub review/commit history 记录不可变审核证据（独立 reviewer 审计）
- [ ] **I**：**PR workflow 不向可修改 workflow 的 `pull_request` 代码暴露模型/CF secret**（PR 仅无 secret 构建+Playwright+artifact）；secret 仅受信 main merge deploy / maintainer `workflow_dispatch`；外部正文隔离
- [ ] **D**：permissions 最小化、第三方 action 固定 full SHA、失败不发布
- [ ] **E**：workflow 权限最小化审计；`workflow_dispatch` 远端 preview 使用 default-branch workflow 且对固定 SHA
- [ ] CSP 严格（`default-src 'self'`）；HTML 消毒；prompt-injection 隔离
- [ ] **manual-import 文件写入**：bounded root（content/+config/）、拒绝 traversal/symlink（含中间目录 symlink）、temp+atomic replace、失败零半成品

## 搜索
- [ ] Pagefind 索引 CJK 验收夹具（中文词/同义名、日文假名/汉字、大小写/全半角、三语别名、缺译回退、索引失效、无结果降级）
- [ ] **确定性 fallback**：若 Pagefind 夹具不通过 → 构建期 `/search.json` 本地索引可用；MVP 至少二者其一

## 功能
- [ ] 新闻/百科/歌曲/Live/纪念日/搜索/About 可用
- [ ] 纪念日计算 + T0 生成（人工 merge）
