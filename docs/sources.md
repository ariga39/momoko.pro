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

字段：`automated_fetch`（全部 `false`）、`fetch_frequency`（manual）、`cache_boundary`、`stop_condition`；robots/terms HTTP 结果与时间均为 2026-08-08 实测。**逐项汇总：**

| source_id | 名称 | canonical URL | robots.txt HTTP/时间 | terms/guideline 结论 |
|---|---|---|---|---|
| S1 | ミリシタ官方公告/卡池/新歌 | https://millionlive-theaterdays.idolmaster-official.jp/ | **404（无文件）** / 0.77s | 域内无公开条款页；游戏条款仅在应用内 → 仅人工录入 |
| S2 | ミリシタ官方 X | https://x.com/imasml_theater | 不适用（不 embed/API） | 人工 permalink 卡片（§2.2） |
| S3 | 品牌官方 X | https://x.com/imasml_765PRO | 不适用 | 同 S2 |
| S4 | Live 情报 | https://idolmaster-official.jp/live_event | **404（无文件）** / 0.04s | portal 域内无公开条款页 → 仅人工录入 |
| S5 | 声優渡部恵子动态 | https://mdawn.co.jp/keiko_watanabe.html | **200** / 1.12s（Allow:/） | 仅 privacy 页、无 terms → 仅人工录入 |

---

## 4. 证据清零结论（2026-08-08）

- ① **X embed**：已记录官方并存事实摘录（URL + 检索日期），不裁定法律冲突；产品决策=人工 permalink 卡片（不复制内容）。已清零。
- ② **ミリシタ官方站 robots/terms**：robots.txt 404（无文件）、无域内公开条款页 → 仅人工发现/录入。已清零。
- ③ **Live / 声优来源**：Live 走 portal（robots 404、无公开条款）→ 仅人工录入；声优走 mdawn 官方资料页（robots 200 但无公开利用条款）→ 仅人工录入；官方 X 走人工 permalink 卡片。已清零。
- **总则**：在存在公开 robots/terms 证据前，任何内容来源不自动抓取；**缺失证据绝不当作允许**。X API 为付费，MVP 不使用。**cron seam 允许**：任何来源取得 robots/terms 许可证据并经人工批准后置 `automated_fetch=true` 由 cron agent 抓取；当前 S1–S5 全 false 时 cron 静默（见 design.md §5.3）。
