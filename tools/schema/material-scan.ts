import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * 版权/素材越界扫描（§版权边界 + tsundere 2026-08-09 public 建议）：
 * 仓库内容不得包含官方图片/Logo/歌词/台词/音频/视频/抓取正文。
 * 返回违规文件列表（内容行命中关键词即视为违规）。
 */
export function scanOutOfBoundsMaterial(): string[] {
  const contentRoot = path.join(REPO_ROOT, "content");
  if (!fs.existsSync(contentRoot)) return [];
  const violations: string[] = [];
  // 内容文件内禁止出现：二进制媒体引用、歌词/台词整段、官方图片。
  // 仅做静态关键词扫描（MVP 门），不追求覆盖所有合法用法。
  const mediaPatterns = [
    /\.(png|jpe?g|gif|webp|mp3|m4a|wav|flac|mp4|webm)(['"\s)]|$)/i,
    /(?:lyrics|歌詞|歌词|word.*for word|transcript|台词|セリフ)/i,
  ];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const rel = path.relative(REPO_ROOT, full);
        const text = fs.readFileSync(full, "utf-8");
        const lower = text.toLowerCase();
        if (mediaPatterns.some((re) => re.test(lower))) {
          violations.push(rel);
        }
      }
    }
  };
  walk(contentRoot);
  return violations;
}
