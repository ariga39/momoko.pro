#!/usr/bin/env python3
"""Deterministic glyph-level font subsetting for momoko.pro (task #25).

Consumes the per-locale required codepoint set produced by pipeline.ts and
emits self-hosted WOFF2 files in public/fonts, a manifest with per-file byte
counts/sha256/source/version/license and input shard hashes, and a generated
src/styles/fonts.css whose @font-face rules are derived from each emitted
font's *actual* cmap (so manifest <-> CSS is always closed and ranges exact).

Approach (offline, byte-identical across runs):
  - For each locale, gather the pinned @fontsource WOFF2 shards declared by the
    family's 400.css (base latin/common + locale slice CSS).
  - Pick the shard that covers the most required codepoints as the primary
    subset input; pyftsubset it to exactly the required codepoints it provides.
  - Every remaining required codepoint is carved from the single shard that
    contains it (each pyftsubset call is a single deterministic input).
  - Coverage is fail-closed: any required codepoint missing from the emitted
    cmap union aborts the build. Characters the family genuinely cannot render
    (foreign-script fixtures such as the trilingual lang switcher labels) are
    recorded as system-fallback in the manifest and never silently dropped.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

BUDGET_BYTES = 1_000_000  # strict <1,000,000 shipped webfont bytes contract
PINNED_VERSIONS = {"fonttools": "4.63.0", "brotli": "1.2.0", "zopfli": "0.4.3"}

FAMILIES: dict[str, dict[str, object]] = {
    "zh": {
        "package": "noto-sans-sc",
        "family": "Noto Sans SC",
        "css": ["400.css", "chinese-simplified-400.css"],
        "weight": 400,
        "license": "OFL-1.1",
        "version": "5.3.0",
    },
    "ja": {
        "package": "noto-sans-jp",
        "family": "Noto Sans JP",
        "css": ["400.css", "japanese-400.css"],
        "weight": 400,
        "license": "OFL-1.1",
        "version": "5.3.0",
    },
    "en": {
        "package": "inter",
        "family": "Inter",
        "css": ["400.css", "latin-400.css"],
        "weight": 400,
        "license": "OFL-1.1",
        "version": "5.3.0",
    },
}

SUBSET_FLAGS = [
    "--flavor=woff2",
    "--layout-features=*",
    "--drop-tables+=DSIG",
    "--name-IDs=0,1,2,3,4,6",
]


def collect_slices(fontroot: Path, pkg: str, css_files: list[str]) -> list[Path]:
    """Return every WOFF2 shard referenced by the given family CSS files."""
    out: list[Path] = []
    for css in css_files:
        css_path = fontroot / pkg / css
        if not css_path.exists():
            continue
        text = css_path.read_text(encoding="utf-8")
        for m in re.finditer(r"url\(\./files/([^)]+\.woff2)\)", text):
            out.append(fontroot / pkg / "files" / m.group(1))
    # Deduplicate while preserving deterministic sorted order.
    return sorted(set(out))


def cmap_of(path: Path) -> set[int]:
    try:
        return set(TTFont(path).getBestCmap().keys())
    except Exception:
        return set()


def codepoints_to_ranges(codepoints: set[int]) -> list[tuple[int, int]]:
    """Collapse sorted codepoints into [start, end] ranges."""
    if not codepoints:
        return []
    cps = sorted(codepoints)
    ranges: list[tuple[int, int]] = []
    start = prev = cps[0]
    for cp in cps[1:]:
        if cp == prev + 1:
            prev = cp
        else:
            ranges.append((start, prev))
            start = prev = cp
    ranges.append((start, prev))
    return ranges


def ranges_to_css(ranges: list[tuple[int, int]]) -> str:
    parts = []
    for a, b in ranges:
        if a == b:
            parts.append(f"U+{a:X}")
        else:
            parts.append(f"U+{a:X}-{b:X}")
    return ",".join(parts)


def run_pyftsubset(pyftsubset: str, src: Path, codepoints: set[int], out: Path) -> None:
    if not codepoints:
        return
    unicodes = ",".join(f"{c:x}" for c in sorted(codepoints))
    subprocess.run(
        [pyftsubset, str(src), f"--unicodes={unicodes}", *SUBSET_FLAGS, f"--output-file={out}"],
        check=True,
        capture_output=True,
        text=True,
    )


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def find_ofl_text(fontroot: Path, pkg: str) -> str:
    """Read the package LICENSE (OFL) text, normalized to a stable form."""
    license_path = fontroot / pkg / "LICENSE"
    text = license_path.read_text(encoding="utf-8")
    # Trim trailing blank lines for determinism.
    return text.rstrip() + "\n"


def write_fonts_css(out_dir: Path, manifest: dict[str, object], css_target: Path) -> None:
    """Generate src/styles/fonts.css with @font-face rules derived from the
    emitted fonts' actual cmaps, plus the locale-scoped font stack variables.

    Locale stacks must never fall back to another region's CJK font (SC/JP are
    not mixed): the zh stack lists only SC + neutral system fonts, the ja stack
    only JP + neutral system fonts, the en stack only Inter + neutral system
    fonts."""
    lines = [
        "/* Self-hosted locale font stacks (task #25).",
        "   Generated deterministically by tools/fonts/subset.py from the emitted",
        "   WOFF2 cmaps; do not edit by hand. SC/JP are never mixed. */",
    ]
    for locale in ("zh", "ja", "en"):
        entry = manifest["locales"][locale]
        family = str(entry["family"])
        weight = entry["weight"]
        for f in entry["files"]:
            font_path = out_dir / f["file"]
            cmap = cmap_of(font_path)
            ranges = ranges_to_css(codepoints_to_ranges(cmap))
            lines.append("")
            lines.append("@font-face {")
            lines.append(f'  font-family: "{family}";')
            lines.append("  font-style: normal;")
            lines.append("  font-display: swap;")
            lines.append(f"  font-weight: {weight};")
            lines.append(f'  src: url("/fonts/{f["file"]}") format("woff2");')
            lines.append(f"  unicode-range: {ranges};")
            lines.append("}")
    lines.append("")
    lines.append(":root {")
    lines.append('  --font-display: "Noto Sans SC", serif;')
    lines.append('  --font-body: "Noto Sans SC", "PingFang SC", sans-serif;')
    lines.append("}")
    lines.append("")
    lines.append('html[lang="ja"] {')
    lines.append('  --font-display: "Noto Sans JP", serif;')
    lines.append('  --font-body: "Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif;')
    lines.append("}")
    lines.append("")
    lines.append('html[lang="en"] {')
    lines.append('  --font-display: "Inter", serif;')
    lines.append('  --font-body: "Inter", "Segoe UI", "Helvetica Neue", sans-serif;')
    lines.append("}")
    lines.append("")
    css_target.parent.mkdir(parents=True, exist_ok=True)
    css_target.write_text("\n".join(lines), encoding="utf-8")


def installed_versions() -> dict[str, str]:
    """Return the versions of the Python tooling actually running this build."""
    out = {}
    try:
        import fontTools
        out["fonttools"] = str(getattr(fontTools, "version", importlib.metadata.version("fonttools")))
    except Exception as exc:  # pragma: no cover
        out["fonttools"] = f"unresolved:{exc}"
    for pkg in ("brotli", "zopfli"):
        try:
            out[pkg] = importlib.metadata.version(pkg)
        except Exception as exc:  # pragma: no cover
            out[pkg] = f"unresolved:{exc}"
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", required=True, help="path to per-locale codepoint JSON")
    parser.add_argument("--out", required=True, help="output directory (public/fonts)")
    parser.add_argument("--pyftsubset", required=True, help="path to pinned pyftsubset")
    parser.add_argument("--fontroot", required=True, help="node_modules/@fontsource root")
    parser.add_argument("--manifest", required=True, help="output manifest path")
    parser.add_argument("--css", required=True, help="output src/styles/fonts.css path")
    args = parser.parse_args()

    corpus = json.loads(Path(args.corpus).read_text(encoding="utf-8"))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    fontroot = Path(args.fontroot)

    manifest: dict[str, object] = {
        "locales": {},
        "budget_bytes": BUDGET_BYTES,
        "tool": {
            "fonttools": "4.63.0",
            "flags": SUBSET_FLAGS,
        },
    }
    # Verify the tooling actually running matches the pinned versions.
    actual = installed_versions()
    for pkg, expected in PINNED_VERSIONS.items():
        if actual.get(pkg) != expected:
            print(f"[fonts] FAIL: {pkg} version {actual.get(pkg)!r} != pinned {expected!r}")
            return 1
    manifest["tool"]["installed"] = actual
    total_bytes = 0
    all_files: list[str] = []

    for locale, spec in FAMILIES.items():
        required = set(corpus.get(locale, []))
        pkg = str(spec["package"])
        slices = collect_slices(fontroot, pkg, [str(c) for c in spec["css"]])

        # Family cmap = union of every declared shard.
        family_cmap: set[int] = set()
        slice_cmaps: dict[Path, set[int]] = {}
        for sl in slices:
            cm = cmap_of(sl)
            slice_cmaps[sl] = cm
            family_cmap |= cm

        responsible = required & family_cmap
        foreign = required - family_cmap  # deliberate multilingual fixtures

        # Primary shard = the one covering the most required codepoints.
        primary = max(slices, key=lambda sl: len(responsible & slice_cmaps[sl]))
        primary_cps = responsible & slice_cmaps[primary]
        leftover = responsible - primary_cps

        produced: list[Path] = []
        emitted: set[int] = set()
        source_of: dict[str, str] = {}  # output filename -> source shard name

        def carve(shard: Path, cps: set[int]) -> None:
            if not cps:
                return
            dest = out_dir / shard.name
            run_pyftsubset(args.pyftsubset, shard, cps, dest)
            produced.append(dest)
            source_of[dest.name] = shard.name
            emitted.update(set(TTFont(dest).getBestCmap().keys()))

        carve(primary, primary_cps)
        for shard in slices:
            if shard == primary:
                continue
            inter = leftover & slice_cmaps[shard]
            if inter:
                carve(shard, inter)
                leftover -= inter

        missing = responsible - emitted
        if missing:
            sample = " ".join(f"U+{c:04X}" for c in sorted(missing)[:8])
            print(f"[fonts] FAIL {locale}: {len(missing)} required codepoints missing: {sample}")
            return 1

        entries = []
        for p in produced:
            size = p.stat().st_size
            total_bytes += size
            # unicode-range derives from the emitted font's ACTUAL cmap.
            range_str = ranges_to_css(codepoints_to_ranges(cmap_of(p)))
            entries.append(
                {
                    "file": p.name,
                    "bytes": size,
                    "sha256": sha256_file(p),
                    "unicode_range": range_str,
                    "source_shard": source_of[p.name],
                    "source_shard_sha256": sha256_file(fontroot / pkg / "files" / source_of[p.name]),
                }
            )
            all_files.append(p.name)

        manifest["locales"][locale] = {
            "family": spec["family"],
            "weight": spec["weight"],
            "license": spec["license"],
            "license_text": find_ofl_text(fontroot, pkg),
            "version": spec["version"],
            "source_package": pkg,
            "files": entries,
            "total_bytes": sum(e["bytes"] for e in entries),
            "codepoints_required": len(required),
            "codepoints_responsible": len(responsible),
            "codepoints_system_fallback": len(foreign),
            "foreign_codepoints": sorted(foreign),
        }
        print(
            f"[fonts] {locale}: required={len(required)} responsible={len(responsible)} "
            f"files={len(entries)} total={sum(e['bytes'] for e in entries)}B"
        )

    manifest["total_bytes"] = total_bytes
    Path(args.manifest).parent.mkdir(parents=True, exist_ok=True)
    Path(args.manifest).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    # Regenerate the CSS from emitted cmaps so manifest <-> @font-face is closed.
    write_fonts_css(out_dir, manifest, Path(args.css))

    if total_bytes >= BUDGET_BYTES:
        print(f"[fonts] FAIL: shipped webfont {total_bytes}B exceeds budget {BUDGET_BYTES}B")
        return 1

    print(f"[fonts] ok: {len(all_files)} files, {total_bytes}B total (< {BUDGET_BYTES}B budget)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
