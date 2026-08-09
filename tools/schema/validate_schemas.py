"""Schema validation gate (owned by package B: tools/schema).

Validates every canonical config/instance against its JSON Schema, including
positive AND negative examples so the schema actually enforces the contracts
described in design.md (not just sources.json). Format keywords (uri,
date-time) are enforced with a real FormatChecker.

Run:  uv run python -m tools.schema.validate_schemas
Exit code 0 = all pass; any failure prints the failing instance and raises.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, date
from pathlib import Path
from urllib.parse import urlparse

import jsonschema
from jsonschema.validators import validator_for

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "schemas"
CONFIG = ROOT / "config"

SHA = "sha256:" + "a" * 64
SHA_B = "sha256:" + "b" * 64


def _build_format_checker() -> jsonschema.FormatChecker:
    """FormatChecker with stdlib-backed uri / date-time / date / hostname checks.

    The system FormatChecker does NOT register `uri` or `date-time` (and the
    optional rfc3987/rfc3339-validator deps are absent), so format keywords
    silently no-op. We register real checks so `format` is actually enforced.
    """
    fc = jsonschema.FormatChecker()

    @fc.checks("uri", raises=(ValueError,))
    def _uri(value: str) -> bool:
        if not isinstance(value, str):
            return True  # format applies to strings only; null handled by type
        parts = urlparse(value)
        return bool(parts.scheme and parts.netloc) and " " not in value

    @fc.checks("date-time", raises=(ValueError,))
    def _date_time(value: str) -> bool:
        if not isinstance(value, str):
            return True
        # Strict RFC 3339: YYYY-MM-DD[Tt]HH:MM:SS(.fff)?(Z|[+-]HH:MM).
        # Rejects date-only strings and timestamps without a timezone.
        m = re.fullmatch(
            r"(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?"
            r"([Zz]|[+-]\d{2}:\d{2})",
            value,
        )
        if not m:
            return False
        year, month, day, hh, mm, ss = (int(g) for g in m.groups()[:6])
        date(year, month, day)
        datetime(year, month, day, hh, mm, ss)
        return True

    @fc.checks("date", raises=(ValueError,))
    def _date(value: str) -> bool:
        if not isinstance(value, str):
            return True
        date.fromisoformat(value)
        return True

    @fc.checks("hostname", raises=(ValueError,))
    def _hostname(value: str) -> bool:
        if not isinstance(value, str):
            return True
        # RFC 1123 hostname: labels of 1..63 chars [A-Za-z0-9-], not starting
        # or ending with '-', joined by single dots; max 253 chars.
        if not value or len(value) > 253:
            return False
        for label in value.rstrip(".").split("."):
            if not label or len(label) > 63:
                return False
            if not re.fullmatch(r"[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?", label):
                return False
        return True

    return fc


def _build_registry():
    """Registry so cross-file $refs (e.g. content -> source.schema.json) resolve."""
    store = {}
    for f in SCHEMAS.glob("*.json"):
        doc = json.loads(f.read_text())
        store[str(f.name)] = doc
        if "$id" in doc:
            store[doc["$id"]] = doc
    return jsonschema.RefResolver.from_schema(
        {"$id": "https://momoko.pro/root.json"},
        store=store,
    )


def _content(**over) -> dict:
    base = {
        "schema_version": "1",
        "kind": "news",
        "source_id": "S1",
        "source_item_id": "2026-08-08-xxx",
        "published_at": "2026-08-08T00:00:00+09:00",
        "content_hash": SHA,
        "risk_tier": "T1",
        "lang": "ja",
        "title": "官方原文标题",
        "source_url": "https://millionlive-theaterdays.idolmaster-official.jp/news/1",
        "review_status": "draft",
        "reviewed_by": None,
        "reviewed_at": None,
        "body": "人工事实笔记或批准短摘录",
    }
    base.update(over)
    return base


def _source(**over) -> dict:
    base = {
        "source_id": "S9",
        "name_zh": "合成探针来源",
        "canonical_url": "https://example.com/",
        "robots_txt_url": "https://example.com/robots.txt",
        "robots_http": "200",
        "robots_note": "Allow: /",
        "terms_url": "https://example.com/terms",
        "terms_note": "公开条款允许抓取",
        "automated_fetch": False,
        "fetch_frequency": "manual",
        "cache_boundary": "仅归档 URL，不复制正文",
        "stop_condition": "条款变更即停止",
    }
    base.update(over)
    return base


def _locale(**over) -> dict:
    base = {
        "schema_version": "1",
        "content_path": "content/news/2026-08-08-x/index.md",
        "lang": "zh",
        "source_content_hash": SHA,
        "content_hash": SHA_B,
        "review_status": "draft",
        "reviewed_by": None,
        "reviewed_at": None,
        "body": "译文草稿",
    }
    base.update(over)
    return base


# (schema file, instance, expect_valid)
CASES: list[tuple[str, dict, bool]] = [
    # config
    ("source.schema.json", json.loads((CONFIG / "sources.json").read_text()), True),
    # source: positive — approved automated_fetch=true with non-manual frequency
    (
        "source.schema.json",
        {"schema_version": "1", "sources": [_source(automated_fetch=True, fetch_frequency="daily")]},
        True,
    ),
    # source: negative — automated_fetch=true cannot be manual frequency
    (
        "source.schema.json",
        {"schema_version": "1", "sources": [_source(automated_fetch=True)]},
        False,
    ),
    # source: negative — automated_fetch=false cannot have non-manual frequency
    (
        "source.schema.json",
        {"schema_version": "1", "sources": [_source(automated_fetch=False, fetch_frequency="weekly")]},
        False,
    ),
    # source: negative — fetch_frequency not in enum
    (
        "source.schema.json",
        {"schema_version": "1", "sources": [_source(fetch_frequency="hourly")]},
        False,
    ),
    # content: positive (reviewed requires reviewer+time)
    (
        "content.schema.json",
        _content(review_status="reviewed", reviewed_by="ariga39",
                 reviewed_at="2026-08-08T01:00:00+09:00"),
        True,
    ),
    # content: negative — published not allowed in canonical
    ("content.schema.json", _content(review_status="published"), False),
    # content: negative — reviewed without reviewer
    ("content.schema.json", _content(review_status="reviewed"), False),
    # content: negative — reviewed without reviewed_at
    (
        "content.schema.json",
        _content(review_status="reviewed", reviewed_by="ariga39"),
        False,
    ),
    # content: negative — bad uri / bad date-time formats caught by FormatChecker
    ("content.schema.json", _content(source_url="not-a-uri"), False),
    ("content.schema.json", _content(published_at="not-a-datetime"), False),
    # strict RFC 3339 probes: date-only and missing-timezone must be rejected
    ("content.schema.json", _content(published_at="2026-08-08"), False),
    ("content.schema.json", _content(published_at="2026-08-08T12:00:00"), False),
    # unknown field rejected
    ("content.schema.json", {**_content(), "not_a_field": True}, False),
    # content: negative — review_status not in enum
    ("content.schema.json", _content(review_status="bogus"), False),
    # locale: positive (reviewed requires reviewer+time)
    (
        "locale.schema.json",
        _locale(review_status="reviewed", reviewed_by="ariga39",
                reviewed_at="2026-08-08T01:00:00+09:00"),
        True,
    ),
    # locale: negative — published not allowed in canonical
    ("locale.schema.json", _locale(review_status="published"), False),
    # locale: negative — reviewed without reviewer
    ("locale.schema.json", _locale(review_status="reviewed"), False),
    # locale: negative — bad lang
    ("locale.schema.json", _locale(lang="fr"), False),
    # discovery-record: positive (has source_item_id for unique key)
    (
        "discovery-record.schema.json",
        {
            "schema_version": "1",
            "source_id": "S1",
            "source_item_id": "2026-08-08-news-x",
            "source_url": "https://millionlive-theaterdays.idolmaster-official.jp/news/1",
            "published_at": "2026-08-08T00:00:00+09:00",
            "title": "公告标题",
            "lang": "ja",
            "note_hash": SHA_B,
            "note": "人工撰写的事实笔记",
        },
        True,
    ),
    # discovery-record: negative — missing source_item_id
    (
        "discovery-record.schema.json",
        {
            "schema_version": "1",
            "source_id": "S1",
            "source_url": "https://example.com/1",
            "published_at": "2026-08-08T00:00:00+09:00",
            "title": "t",
            "lang": "ja",
            "note_hash": SHA_B,
            "note": "n",
        },
        False,
    ),
    # anniversary: positive (requires source_id + source_url)
    (
        "anniversary.schema.json",
        {
            "schema_version": "1",
            "kind": "birthday",
            "slug": "suo-momoko",
            "date": "2001-03-29",
            "title": "周防桃子 生日",
            "tier": "T0",
            "source_id": "S1",
            "source_url": "https://millionlive-theaterdays.idolmaster-official.jp/idol/momoko",
        },
        True,
    ),
    # anniversary: negative — missing source_id/source_url
    (
        "anniversary.schema.json",
        {
            "schema_version": "1",
            "kind": "birthday",
            "slug": "suo-momoko",
            "date": "2001-03-29",
            "title": "周防桃子 生日",
            "tier": "T0",
        },
        False,
    ),
    # retraction: positive
    (
        "retraction.schema.json",
        {
            "schema_version": "1",
            "id": "r-001",
            "content_path": "content/news/2026-08-08-x/index.md",
            "status": "requested",
            "reason": "来源要求下架",
            "requested_at": "2026-08-08T00:00:00+09:00",
            "requested_by": "ariga39",
            "resolved_at": None,
        },
        True,
    ),
    # retraction: negative — unknown status enum
    (
        "retraction.schema.json",
        {
            "schema_version": "1",
            "id": "r-002",
            "content_path": "content/news/2026-08-08-x/index.md",
            "status": "bogus",
            "reason": "x",
            "requested_at": "2026-08-08T00:00:00+09:00",
            "requested_by": "ariga39",
            "resolved_at": None,
        },
        False,
    ),
    # manifest: positive build artifact shape
    (
        "manifest.schema.json",
        {
            "manifest_version": "1",
            "generated_at": "2026-08-08T00:00:00+09:00",
            "entries": [
                {
                    "path": "content/news/2026-08-08-x/index.md",
                    "kind": "news",
                    "source_id": "S1",
                    "source_item_id": "x",
                    "content_hash": SHA,
                    "review_status": "published",
                    "locales": {
                        "ja": {"status": "published", "hash": SHA, "reviewed_by": "ariga39"},
                        "zh": {"status": "draft", "hash": SHA_B, "reviewed_by": None},
                        "en": {"status": "stale", "hash": SHA_B, "reviewed_by": None},
                    },
                }
            ],
        },
        True,
    ),
    # manifest: negative — locale status not in enum
    (
        "manifest.schema.json",
        {
            "manifest_version": "1",
            "generated_at": "2026-08-08T00:00:00+09:00",
            "entries": [
                {
                    "path": "content/news/x/index.md",
                    "kind": "news",
                    "source_id": "S1",
                    "source_item_id": "x",
                    "content_hash": SHA,
                    "review_status": "published",
                    "locales": {
                        "ja": {"status": "bogus", "hash": SHA, "reviewed_by": None},
                        "zh": {"status": "draft", "hash": SHA_B, "reviewed_by": None},
                        "en": {"status": "draft", "hash": SHA_B, "reviewed_by": None},
                    },
                }
            ],
        },
        False,
    ),
]


def main() -> int:
    resolver = _build_registry()
    failures = 0
    for schema_file, instance, expect in CASES:
        schema = json.loads((SCHEMAS / schema_file).read_text())
        validator = validator_for(schema)(
            schema,
            resolver=resolver,
            format_checker=_build_format_checker(),
        )
        try:
            validator.validate(instance)
            ok = True
        except jsonschema.ValidationError:
            ok = False
        if ok != expect:
            failures += 1
            print(f"FAIL {schema_file}: expected_valid={expect}, got={ok}")
            print(f"  instance={json.dumps(instance, ensure_ascii=False)[:200]}")
        else:
            print(f"ok   {schema_file} valid={ok}")
    if failures:
        print(f"\n{failures} schema case(s) failed")
        return 1
    print("\nall schema cases pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
