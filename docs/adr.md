# momoko.pro ADR / 待决策表

每项给默认值、代价、改变条件。

## ADR-01 抓取范围
- 默认：只官方/本人/经纪事务所/主办方；**X 用人工维护的普通官方 permalink 卡片（只存 account/date/permalink/人工原创说明，不复制 post 文本/图片，不 embed/API/抓取——见 sources.md §2）**；内容源在存在公开 robots/terms 证据前不自动抓取，仅人工发现/录入。`robots_result=unavailable` + `robots_path_decision=allow` 是 RFC 9309 对 4xx/404 的协议事实，不等于来源授权；`robots_path_decision` 必须绑定 checked path；批量抓取还需项目 `automated_fetch=true`。
- MVP 管线：**发现（cron `automated_fetch=true` 或人工）→ schema → AI 草稿 → Draft PR → 独立 reviewer merge 前写 reviewed → 具 merge 权限 human/agent 合并**；cron 只跑已验证允许的来源，无允许来源/无变化静默；当前 S1–S5 全 false 走 manual-import。
- 来源验证：allowlisted HTTPS hostname + source_id（MVP 无加密签名）；robots result/path decision 与 access-mode/project gate 分字段记录。旧 `robots_approved` 仅兼容读取并弃用，不参与新 access decision。
- 代价：缺失非官方/实时 X、自动抓取时效性受限（人工录入为主）。
- 改变条件：用户明确需要且人工批准；或某来源项目门置 `automated_fetch=true`、声明非空 `fetch_paths` 并为每个目标路径取得 robots 结果/decision 证据后开放自动抓取（届时才引入抓取链契约）。`runCron()` 将显式目标路径传给 adapter，不以 `/` 作为默认或全站许可。人类明确指令下的单页读取另行适用访问控制、Terms、限频和内容保留边界，不因 robots 404 自动拒绝，也不因 robots 允许自动取得再利用许可。

## ADR-02 素材托管
- 默认：不托管官方图像/Logo/完整台词/歌词/音频；不声线克隆。
- 改变条件：用户提供授权。

## ADR-03 自动发布分级（T0/T1/T2）
- T0：只自动生成文件/PR（人工事实/allowlist 卡片，无 AI 改写）；**仍需独立 reviewer review（T2 必须 human）+ 具 merge 权限合并，MVP 不自动合并/发布任何新内容**。
- T1：默认草稿 + 质量证据后人工开启 + 抽检/熔断/一键撤回。
- T2：永久人工（人物/健康/争议/纠错/来源冲突/法律版权/悼念/模型不确定）。
- future：T0 auto-merge 需另开 ADR + 签名来源/独立批准门。
- 改变条件：质量证据/政策。

## ADR-04 三语与审核状态
- AI 草稿 → 独立 reviewer 校对；原文变 → 译文 stale；不撒谎。状态机：draft → reviewed（仓库授权的独立 reviewer 在 merge 前显式提交，reviewer/time 非空；T2 必须 human）→ published（main merge 后 build 派生 manifest，不回写 canonical）；stale / retracted。自动化上限见 design.md §3.2；无 promote-review/自动晋级。published 永不回写 canonical。

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
- **MVP 锁定：Git-based workflow（PR/commit 审核 + 人工 merge 发布）**——人工发现记录/AI 草稿生成 Draft PR（agent 只推分支，默认永不自动合并）；**内容判断=独立 reviewer（human/授权 agent，非生成 agent）** 在 merge 前 GitHub review 中完成（GitHub review/commit history 即审计）；merge 后 `published` 为 build 派生（不在 canonical enum）。
- **自动化上限**：MVP 不预埋 secret-bearing 自动写回、workflow_dispatch 内容写回、硬编码 reviewer 身份或第二套审批库（momoko 2026-08-09）。
- **secret 边界**：PR 代码路径不注入任何 secret；CI/build 仅在 main merge 后由 default-branch-owned 可信 job 使用部署 secret。
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

## ADR-12 i18n 分层（ADR-I18N）
- 决策：Astro 原生 i18n routing 负责 `/ja|zh|en` 路由、locale 校验与 URL helper；Paraglide JS 只负责导航、按钮、状态提示等 UI message catalog。静态构建按 Paraglide Astro SSG 指南在 prerender 时显式设置 locale，不引入运行时语言服务。
- 路由：三种语言全部带前缀；`/` 保留 x-default 语言选择页，不读取 `Accept-Language`、不自动跳转。URL 是 locale 真相源。
- 内容边界：编辑内容仍以 `content.<lang>.md`、`source_content_hash` 与 `review_status` 为唯一真相；Paraglide/Astro fallback 不得改变或推断审核状态。缺失或 stale 内容只能显式回退源语言并显示提示。
- SEO：真实翻译必须 body 非空、`reviewed`、绑定当前源 hash 且未 retracted；真实翻译页 self-canonical。fallback 页使用源语言 `lang`/metadata、canonical 到源页并 `noindex,follow`，请求 locale 不进入 alternate。每个内容身份的 hreflang 集合使用全限定 URL、包含自身并在全部成员上双向一致；详情 `x-default` 指向源页，站点根选择页只服务入口/列表层。
- CI 门：UI message key 必须类型检查；三语 catalog key 集合完整；Astro locale 集合与 Paraglide locale 集合完全相等；按内容身份验证真实翻译/fallback 的 `lang`、metadata、canonical、robots 与 hreflang 双向集合；构建保持静态、确定且离线。
- 不采用：本切片不选 i18next；它是可行的 runtime i18n 方案，但 Paraglide 有直接的 Astro SSG 上游指南、编译期 message 类型安全且更少自建适配面。也不继续维护散落在组件中的手写三语对象。
- 代价：增加 Paraglide 编译步骤、`project.inlang` 和生成代码；UI 与编辑内容有两个明确层次。收益是 UI key/参数类型安全、编译期发现拼写错误和后续翻译工具链兼容。
- 改变条件：若 Paraglide 的 Astro SSG/Cloudflare 构建出现可复现兼容问题、维护停滞或生成物破坏确定性，回退为 Astro 原生 routing + 单一 typed local catalog；编辑内容模型不变。
- 依据（2026-08-09）：<https://docs.astro.build/en/guides/internationalization/>、<https://paraglidejs.com/astro>、<https://paraglidejs.com/static-site-generation>、<https://www.i18next.com/overview/getting-started>、<https://developers.google.com/search/docs/specialty/international/localized-versions>、<https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls>。
