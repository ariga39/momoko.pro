# momoko.pro 引用官方资料清单（人类证据说明）

机器可读来源配置见 **`config/sources.json`**（schema: `schemas/source.schema.json`）。本文档只记录人类证据、URL 与检索日期。**证据按 2026-08-08 实际访问记录清零。**（MVP 无硬编码 reviewer 身份；内容判断由人工/授权 agent 在 GitHub review 完成，见 design.md §3.2 自动化上限。）

## 1. Cloudflare / GitHub 产品额度（逐产品官方 pricing/limits 页，检索日期 2026-08-08）

| 产品 | 免费额度（官方 pricing/limits） | 官方 URL |
|---|---|---|
| 静态资产请求（Pages/Workers） | **免费且不限量** | https://developers.cloudflare.com/workers/platform/pricing/ |
| Cloudflare Pages | Free：500 builds/mo、1 并发、20,000 files/site、100 custom domains/项目、单文件 ≤25 MiB、_headers 100 条、_redirects 2100 条 | https://developers.cloudflare.com/pages/platform/limits/ |
| Workers（动态，MVP 不用） | 100k req/day、10ms CPU/次 | https://developers.cloudflare.com/workers/platform/pricing/ |
| Pages Functions（MVP 不用） | 按 Workers 计费 | https://developers.cloudflare.com/pages/functions/pricing/ |
| D1（future） | 5M rows read/day、100K rows written/day、5GB | https://developers.cloudflare.com/d1/platform/pricing/ |
| Queues（future） | **Free 10,000 operations/day**；24h 保留 | https://developers.cloudflare.com/queues/platform/pricing/ |
| R2（future） | 10GB-month、1M Class A ops | https://developers.cloudflare.com/r2/pricing/ |
| Vectorize（future） | 30M queried dims/month（Workers Paid 才可用） | https://developers.cloudflare.com/workers/platform/pricing/ |
| Workers Logs | 200k events/day、3 天 | https://developers.cloudflare.com/workers/platform/pricing/ |
| GitHub Actions（私有仓） | 2,000 分钟/月、500MB artifacts（与 Packages 共享）、10GB cache/仓；artifact 默认 90 天 retention | https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions |

> 注：D1 Time Travel（future）7 天保留（Free）：https://developers.cloudflare.com/d1/reference/time-travel/ 。所有 future 产品不计入 MVP 成本。

---

## 2. X / 社交（产品决策 = 人工 permalink 卡片）

### 2.1 官方 embed/publish 文档与适用协议（2026-08-08 逐项 HTTP 200 确认）

| 文档 | URL | 结果 |
|---|---|---|
| Embedded Posts 文档（overview） | https://docs.x.com/x-for-websites/embedded-posts/overview.md | HTTP 200 |
| oEmbed / publish 端点 | https://publish.x.com/oembed（需 `?url=` 参数） | HTTP 200（带参） |
| X Developer Agreement | https://docs.x.com/developer-terms/agreement | HTTP 200（Last Updated: April 27, 2026） |
| X Developer Policy（并入条款） | https://docs.x.com/developer-terms/policy | 见 Agreement |
| Display Requirements（并入条款） | https://docs.x.com/developer-terms/display-requirements | HTTP 200 |
| X API pricing | https://docs.x.com/x-api/getting-started/pricing | HTTP 200 |

### 2.2 关键条款事实摘录（不做法定结论）

- 事实：X Developer Agreement §III.K 含对在 iframe/inline frame/相似嵌入机制中展示 X Content 的绝对禁止表述。
- 事实：官方 Display Requirements 同时"strongly encourage"使用 embedded posts/timelines，并写明"permission from the original content creator may still be necessary, as X does not provide permission to use third party/user content"。
- **本设计不自行裁定这两份官方材料之间的法律冲突，也不声称"embed 依赖 iframe 因此绝对禁止"。**
- **产品决策（MVP）**：为避免许可解释、第三方内容与运行依赖，采用**普通官方 permalink 卡片**——**只存 account/date/permalink/人工原创说明，不复制 post 文本/图片**，不 embed、不 API、不抓取。**未来若启用 embed/API，必须先重新做法律/条款评审并经人工批准。**

### 2.3 X API

- **X API**：现为 pay-per-use credit 制，主入口无免费层（"Pay only for what you use"）；Owned Reads $0.001/resource。URL: https://docs.x.com/x-api/introduction（pricing: https://docs.x.com/x-api/getting-started/pricing）。**MVP 不调用 X API。**

---

## 3. 内容来源（机器配置见 config/sources.json）

字段：`automated_fetch`（全部 `false`）、`fetch_frequency`（manual）、`fetch_paths`（自动来源必填）、`access_control`、`terms_status`、`robots_result`、`robots_path_decision`、`checked_path`、`retrieved_at`、`evidence`、`cache_boundary`、`stop_condition`；robots/terms HTTP 结果与时间均为 2026-08-08 实测。`access_control` 与 `terms_status` 是显式状态，未知状态不能授权自动抓取；`robots_result` 是 RFC 9309 的结果类别，`robots_path_decision` 只绑定 `checked_path`；旧 `robots_approved` 仅为兼容字段，不参与新决策。自动 adapter 每次接收显式 target path，不能用根路径授权其他路径。**逐项汇总：**

| source_id | 名称 | canonical URL | robots.txt 结果与 checked path | terms/guideline 结论 |
|---|---|---|---|---|
| S1 | ミリシタ官方公告/卡池/新歌 | https://millionlive-theaterdays.idolmaster-official.jp/ | **unavailable + allow**, `checked_path=/`, 2026-08-08 | 域内无公开条款页；游戏条款仅在应用内 → 仅人工录入 |
| S2 | ミリシタ官方 X | https://x.com/imasml_theater | `not_applicable` + `not_evaluated`（不 embed/API） | 人工 permalink 卡片（§2.2） |
| S3 | 品牌官方 X | https://x.com/imasml_765PRO | `not_applicable` + `not_evaluated`（不 embed/API） | 同 S2 |
| S4 | Live 情报 | https://idolmaster-official.jp/live_event | **unavailable + allow**, `checked_path=/`, 2026-08-08 | portal 域内无公开条款页 → 仅人工录入 |
| S5 | 声優渡部恵子动态 | https://mdawn.co.jp/keiko_watanabe.html | **rules_available + allow**, `checked_path=/`, 2026-08-08 | 仅 privacy 页、无 terms → 仅人工录入 |
| S6 | アイドルマスター公式ポータル NEWS（单页） | https://idolmaster-official.jp/news/01_18661.html | **unavailable + allow**, `checked_path=/`, 2026-08-10（同 S4 域实测） | portal 域内无公开条款页 → 仅一次人工定向单页结构化字段 + 唯一人工事实笔记 |

### 3.1 Robots result 与授权的区别

按 [RFC 9309 §2.3.1.3](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.3)，HTTP 400–499（包括 404）表示 robots 文件 unavailable，crawler 可以继续访问资源；HTTP 500–599 或网络不可达则按 unreachable/complete disallow 处理，见 [§2.3.1.4](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.4)。因此：

- `robots_result=unavailable` 与 `robots_path_decision=allow` 是协议事实，不是站主、版权、Terms 或项目授权。
- `robots_result=rules_available` 只表示规则文件可解析；`robots_path_decision` 必须绑定具体 `checked_path`，不能把根路径的 allow 写成全站 allow。
- `robots_result=unreachable` 或路径 `disallow` 均由 crawler seam fail closed；`not_applicable` 只适用于当前不使用 robots 约束的表面。
- `robots_http` 与旧 `robots_approved` 只保留作历史兼容/证据读取；新决策不从 HTTP 数字或旧 approval 字段推断。

AI agent 的一次人工指令单页读取、无人值守的批量/递归 crawler，以及缓存、再发布或训练属于不同访问模式；不能仅凭 robots 结果推导后两类操作的许可。AI crawler 的 robots 语义目前也未形成统一约定，参考 [RFC 9969](https://www.rfc-editor.org/rfc/rfc9969.html)。

---

## 4. 证据清零结论（2026-08-08）

- ① **X embed**：已记录官方并存事实摘录（URL + 检索日期），不裁定法律冲突；产品决策=人工 permalink 卡片（不复制内容）。已清零。
- ② **ミリシタ官方站 robots/terms**：robots.txt 404（`unavailable + allow`，只绑定 `/`，不是全站许可）、无域内公开条款页，且项目 `automated_fetch=false` → 仅人工发现/录入。已清零。
- ③ **Live / 声优来源**：Live 走 portal（robots 404 → `unavailable + allow`，只绑定 `/`）→ 仅人工录入；声优走 mdawn 官方资料页（robots 200 → `rules_available + allow`，只绑定 `/`，但无公开利用条款）→ 仅人工录入；官方 X 走人工 permalink 卡片。已清零。
- **总则**：当前 S1–S6 全 false，cron 静默；未来 crawler 必须同时具备 `automated_fetch=true`、非空 `fetch_paths` 与每个请求路径的 robots decision。**缺失结果/路径证据绝不当作允许**。人类明确指令的单页读取、无人值守 crawler、reuse/republication 分别由 pure access seam 判定；X API 为付费，MVP 不使用。S6 为 task #31 人工定向单页样本：唯一 live GET、流式 1 MiB/端到端 30s、严格 origin/content-type/单一路径类型校验，正文 untrusted，只保留 allowlisted 字段与唯一人工事实笔记。
