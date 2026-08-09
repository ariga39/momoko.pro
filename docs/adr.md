# momoko.pro ADR / 待决策表

每项给默认值、代价、改变条件。

## ADR-01 抓取范围
- 默认：只官方/本人/经纪事务所/主办方；**X 用人工维护的普通官方 permalink 卡片（只存 account/date/permalink/人工原创说明，不复制 post 文本/图片，不 embed/API/抓取——见 sources.md §2）**；内容源在存在公开 robots/terms 证据前不自动抓取，仅人工发现/录入。
- MVP 管线：**人工 discovery → schema → AI 草稿 → PR → 人工 review/merge**；无 daily-fetch、无抓取重试/死信、无 raw store、工具不打开 URL。
- 来源验证：allowlisted HTTPS hostname + source_id（MVP 无加密签名）。
- 代价：缺失非官方/实时 X、自动抓取时效性受限（人工录入为主）。
- 改变条件：用户明确需要且人工批准；或某来源取得公开 robots/terms 许可证据并经批准后开放自动抓取（届时才引入抓取链契约）。

## ADR-02 素材托管
- 默认：不托管官方图像/Logo/完整台词/歌词/音频；不声线克隆。
- 改变条件：用户提供授权。

## ADR-03 自动发布分级（T0/T1/T2）
- T0：只自动生成文件/PR（人工事实/allowlist 卡片，无 AI 改写）；**仍需人工 review + merge，MVP 不自动合并/发布任何新内容**。
- T1：默认草稿 + 质量证据后人工开启 + 抽检/熔断/一键撤回。
- T2：永久人工（人物/健康/争议/纠错/来源冲突/法律版权/悼念/模型不确定）。
- future：T0 auto-merge 需另开 ADR + 签名来源/独立批准门。
- 改变条件：质量证据/政策。

## ADR-04 三语与审核状态
- AI 草稿 → 人工校对；原文变 → 译文 stale；不撒谎。状态机：draft → reviewed（promote-review 受控 workflow_dispatch+Contents API 在开放 PR 写）→ published（main merge 后 build 派生 manifest，不回写 canonical）；stale / retracted。转移表与写入者见 design.md §3。published 永不回写 canonical。

## ADR-05 搜索（ADR-SEARCH）
- **MVP：build-time 搜索（Pagefind 首选）**，只有通过 zh/ja/en 验收夹具后才采用；**若夹具不通过，确定性 fallback = 构建期生成的本地 JSON 索引（/search.json，客户端过滤）**；MVP 至少启用二者之一。
- future：D1 搜索仅在官方能力与 CJK 质量证据都优于静态方案时选择；Vectorize 留作规模/语义检索达到明确阈值后的升级。

## ADR-06 渲染与部署（ADR-RENDER/DEPLOY）
- **MVP 锁定：Cloudflare Pages 静态托管；部署面 = GitHub Actions Direct Upload（唯一）**——Git canonical 内容由 GitHub Actions 构建为静态站点；**无运行时 Worker / Pages Functions / 原生 Git 集成**；静态资产请求免费且不限量（https://developers.cloudflare.com/workers/platform/pricing/ ）。
- **manifest.json 不提交仓库**：构建期全量生成到 dist，双重构建确定性验证。
- `/` 为 x-default 语言选择页或固定静态 302；**无服务端 Accept-Language 读取**。
- **PR 不接触 CF secret**：`pull_request` 仅无 secret 构建+Playwright+artifact；生产部署仅受信 main merge；远端 preview 由 maintainer 对固定 SHA 手动 `workflow_dispatch`（default-branch workflow）。
- future：如需秒级发布或复杂服务端查询，可引入 D1 + 请求时渲染（打开 ADR）。
- 改变条件：出现非 Git 编辑者、秒级发布、构建瓶颈或复杂服务端查询（需量化证据）。

## ADR-07 编辑/审核入口（ADR-ADMIN）
- **MVP 锁定：Git-based workflow（PR/commit 审核 + merge 发布）**——人工发现记录/AI 草稿生成 PR；**promote-review**（default-branch-owned 受控 `workflow_dispatch` 可信 workflow）经 GitHub API 校验 PR/head/真实 review 证据后用 Contents API 在 PR head 写 `reviewed` + 非空 `reviewed_by/reviewed_at`（author≠reviewer，reviewer ∈ `config/reviewers.json` 真实 GitHub 身份）；`published` 为 build 派生（不在 canonical enum）；PR/commit history 兼作审计。required reviewer ≥1（author 除外）。
- **secret 边界**：promote-review 与 preview 均不在 `pull_request` 代码路径注入 secret；只读 PR/review + 该 head Contents 写，不 checkout/执行未审脚本。
- future：如需非 Git 编辑者或秒级发布，引入受保护管理 API + 审核界面（X-Api-Key + IP allowlist）。
- 改变条件：出现非 Git 编辑者、秒级发布（需量化证据）。

## ADR-08 AI 层（ADR-AI）
- 默认：provider-neutral 契约；**AI 是 CI/本地任务的可选依赖，未选定供应商前不标"启用"**；输出一律 T1 草稿。
- **输入边界**：只消费人工撰写的事实笔记或明确批准的短摘录；外部正文不进 repo/prompt log/artifact；工具不打开 URL。
- 评估：可用性/数据处理/质量/额度/锁定；用户接受 LLM 费用，不因"免费"牺牲质量。
- 改变条件：选定供应商并经人工批准后，在 CI/受控本地任务中启用。

## ADR-09 用户系统/评论
- MVP 无。

## ADR-10 备份/安全/可撤回
- 强制项，零成本不以跳过为代价。备份 = Git 历史（内容真相）+ 可重建产物；**artifact 会过期不能当备份**；恢复演练每季度一次，RTO ≤ 1 工作日；下架 retraction 经 build 原子生效。

## ADR-11 技术栈（ADR-STACK）
- 默认：Astro + TypeScript(Node≥20) + pnpm(lockfile 强制) + JSON Schema/Ajv + Vitest + Playwright + Pagefind；Pages 部署走 GitHub Actions Direct Upload。
- 版本/锁定：pnpm-lock.yaml 强制提交、CI frozen-lockfile；第三方 action 固定 full SHA。
- 代价：供应商/框架锁定（Astro/Pagefind/CF）；可替换条件见 design.md §2。
- 改变条件：构建复杂度超阈值、CJK 搜索夹具不通过需 fallback、团队主导语言变更——均需另开 ADR。
