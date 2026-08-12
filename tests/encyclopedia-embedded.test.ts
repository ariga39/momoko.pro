import { afterEach, describe, expect, it } from "vitest";

import { loadPublishedProfiles } from "../src/lib/encyclopedia.ts";
import { isRealProfileTranslation } from "../src/lib/encyclopedia.ts";
import { embeddedPackage } from "../src/lib/embedded-package.ts";

const originalEnabled = embeddedPackage.enabled;
const originalExplicit = embeddedPackage.explicit;
const originalRelativeRoot = embeddedPackage.relativeRoot;
const originalMode = embeddedPackage.mode;
const originalFiles = { ...embeddedPackage.files };

const CANONICAL_JA = `---
schema_version: '1'
kind: wiki
source_id: S7
source_item_id: momoko-suou
retrieved_at: '2026-08-12'
content_hash: sha256:a8d53a0b0c96c6fd761b30fd041dd97e0954e7b0eb1dd5fdce28e2c4eec95e38
risk_tier: T1
lang: ja
is_canonical: true
title: 周防桃子
source_url: https://millionlive-theaterdays.idolmaster-official.jp/idol/momoko/
review_status: reviewed
reviewed_by: fixture-reviewer
reviewed_at: '2000-01-01T00:00:00Z'
name_ja: 周防桃子
name_roman: MOMOKO SUOU
cv: 渡部恵子
affiliation: 765プロダクション
type: Fairy
age: 11歳
birthday: 11月6日
blood_type: B
constellation: 蠍座
handedness: 右
height: 140cm
weight: 35kg
three_sizes: 73/53/74
birthplace: 東京都
hobby: かわいいシール集め
specialty: 演技や台詞の暗記
likes: ホットケーキ
tagline: 生意気？強がり？小さくて意地っぱりな妹系アイドル！
---
生意気？強がり？小さくて意地っぱりな妹系アイドル！
`;

const LOCALE_ZH = `---
schema_version: '1'
content_path: content/encyclopedia/momoko-suou/content.ja.md
lang: zh
is_canonical: false
source_content_hash: sha256:a8d53a0b0c96c6fd761b30fd041dd97e0954e7b0eb1dd5fdce28e2c4eec95e38
content_hash: sha256:1a98f014695df06ccfe1b9099224e2077a04914c956e5511ad06f517663cd524
review_status: reviewed
reviewed_by: fixture-reviewer
reviewed_at: '2000-01-01T00:00:00Z'
title: 周防桃子
name: 周防桃子
name_roman: MOMOKO SUOU
cv: 渡部惠子
affiliation: 765プロダクション
type: Fairy
age: 11岁
birthday: 11月6日
blood_type: B
constellation: 天蝎座
handedness: 右
height: 140cm
weight: 35kg
three_sizes: 73/53/74
birthplace: 东京都
hobby: 收集可爱贴纸
specialty: 表演与记忆对白
likes: 热香饼
tagline: 逞强？小个子又倔强的妹妹系偶像！
---
逞强？小个子又倔强的妹妹系偶像！
`;

const LOCALE_EN = `---
schema_version: '1'
content_path: content/encyclopedia/momoko-suou/content.ja.md
lang: en
is_canonical: false
source_content_hash: sha256:a8d53a0b0c96c6fd761b30fd041dd97e0954e7b0eb1dd5fdce28e2c4eec95e38
content_hash: sha256:48b6c65f39443e3676cf7c47889dd5dea0a1be2ac423ba7e9a62284642aa8679
review_status: reviewed
reviewed_by: fixture-reviewer
reviewed_at: '2000-01-01T00:00:00Z'
title: Momoko Suou
name: Momoko Suou
name_roman: MOMOKO SUOU
cv: Keiko Watanabe
affiliation: 765 PRO
type: Fairy
age: '11'
birthday: November 6
blood_type: B
constellation: Scorpio
handedness: Right
height: 140cm
weight: 35kg
three_sizes: 73/53/74
birthplace: Tokyo
hobby: Collecting cute stickers
specialty: Acting and memorizing lines
likes: Hotcakes
tagline: Feisty? A small, stubborn little-sister idol!
---
Feisty? A small, stubborn little-sister idol!
`;

const MANIFEST = JSON.stringify({
  package_version: "1",
  content_schema_version: "1",
  status: "ready",
});

const CANON_HASH = "sha256:a8d53a0b0c96c6fd761b30fd041dd97e0954e7b0eb1dd5fdce28e2c4eec95e38";
const ZH_HASH = "sha256:1a98f014695df06ccfe1b9099224e2077a04914c956e5511ad06f517663cd524";
const EN_HASH = "sha256:48b6c65f39443e3676cf7c47889dd5dea0a1be2ac423ba7e9a62284642aa8679";
const FIXTURE_REVIEW_AT = "2000-01-01T00:00:00Z";
const FIXTURE_HISTORY = JSON.stringify({
  history_version: "1",
  identity: "S7|momoko-suou",
  events: [
    {
      operation_id: `draft:${CANON_HASH}`,
      scope: "canonical",
      lang: "ja",
      from: null,
      to: "draft",
      actor: "anna-ai-draft",
      actor_kind: "ai",
      at: "2026-08-12T18:47:42Z",
      reason: "synthetic fixture draft",
      source_content_hash: CANON_HASH,
      content_hash: CANON_HASH,
      sequence: 1,
      event_id: "11111111-1111-4111-8111-111111111111",
    },
    {
      operation_id: "review:S7|momoko-suou:canonical",
      scope: "canonical",
      lang: "ja",
      from: "draft",
      to: "reviewed",
      actor: "fixture-reviewer",
      actor_kind: "human",
      at: FIXTURE_REVIEW_AT,
      reason: "synthetic fixture human review",
      source_content_hash: CANON_HASH,
      content_hash: CANON_HASH,
      sequence: 2,
      event_id: "22222222-2222-4222-8222-222222222222",
    },
    {
      operation_id: `draft:${CANON_HASH}:zh`,
      scope: "locale",
      lang: "zh",
      from: null,
      to: "draft",
      actor: "anna-ai-draft",
      actor_kind: "ai",
      at: "2026-08-12T18:47:42Z",
      reason: "synthetic fixture locale draft",
      source_content_hash: CANON_HASH,
      content_hash: ZH_HASH,
      sequence: 3,
      event_id: "33333333-3333-4333-8333-333333333333",
    },
    {
      operation_id: "review:S7|momoko-suou:zh",
      scope: "locale",
      lang: "zh",
      from: "draft",
      to: "reviewed",
      actor: "fixture-reviewer",
      actor_kind: "human",
      at: FIXTURE_REVIEW_AT,
      reason: "synthetic fixture human review",
      source_content_hash: CANON_HASH,
      content_hash: ZH_HASH,
      sequence: 4,
      event_id: "44444444-4444-4444-8444-444444444444",
    },
    {
      operation_id: `draft:${CANON_HASH}:en`,
      scope: "locale",
      lang: "en",
      from: null,
      to: "draft",
      actor: "anna-ai-draft",
      actor_kind: "ai",
      at: "2026-08-12T18:47:42Z",
      reason: "synthetic fixture locale draft",
      source_content_hash: CANON_HASH,
      content_hash: EN_HASH,
      sequence: 5,
      event_id: "55555555-5555-4555-8555-555555555555",
    },
    {
      operation_id: "review:S7|momoko-suou:en",
      scope: "locale",
      lang: "en",
      from: "draft",
      to: "reviewed",
      actor: "fixture-reviewer",
      actor_kind: "human",
      at: FIXTURE_REVIEW_AT,
      reason: "synthetic fixture human review",
      source_content_hash: CANON_HASH,
      content_hash: EN_HASH,
      sequence: 6,
      event_id: "66666666-6666-4666-8666-666666666666",
    },
  ],
});

function installEmbedded() {
  delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
  delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
  delete process.env.PUBLIC_BUILD;
  embeddedPackage.enabled = true;
  embeddedPackage.explicit = false;
  embeddedPackage.relativeRoot = "content";
  embeddedPackage.mode = null;
  embeddedPackage.files = {
    "package.json": MANIFEST,
    "encyclopedia/momoko-suou/content.ja.md": CANONICAL_JA,
    "encyclopedia/momoko-suou/content.zh.md": LOCALE_ZH,
    "encyclopedia/momoko-suou/content.en.md": LOCALE_EN,
    "encyclopedia/momoko-suou/editorial-history.json": FIXTURE_HISTORY,
  };
}

afterEach(() => {
  embeddedPackage.enabled = originalEnabled;
  embeddedPackage.explicit = originalExplicit;
  embeddedPackage.relativeRoot = originalRelativeRoot;
  embeddedPackage.mode = originalMode;
  embeddedPackage.files = { ...originalFiles };
});

describe("embedded encyclopedia content package", () => {
  it("loads a reviewed profile from the embedded content package", () => {
    installEmbedded();

    const published = loadPublishedProfiles();
    expect(published).toHaveLength(1);
    const momoko = published[0]!;
    expect(momoko.slug).toBe("momoko-suou");
    expect(momoko.canonical.facts.birthday).toBe("11月6日");
    expect(momoko.canonical.facts.cv).toBe("渡部恵子");
    expect(isRealProfileTranslation(momoko, "zh")).toBe(true);
  });
});
