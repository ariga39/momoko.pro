// Deterministic self-host font subsetting (task #25).
// Builds the per-locale required codepoint corpus from the rendered content,
// feeds the pinned fonttools[woff]/pyftsubset path via subset.py, and fails
// closed if any required character is missing from the emitted WOFF2 cmap or
// the shipped total exceeds the <1,000,000 byte contract.
//
// Provisioning (`fonts:install`) and the offline subset build (`fonts:subset`)
// are separate so the build itself never touches the network: the venv must
// already exist with pinned fonttools, or the build fails closed with a clear
// instruction to run the install step first.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "public/fonts");
const MANIFEST = path.join(OUT, "manifest.json");
const CSS = path.join(ROOT, "src/styles/fonts.css");
const CORPUS_TMP = path.join(ROOT, "node_modules/.cache/momoko-font-corpus.json");

const LOCALES = ["zh", "ja", "en"];
const VENV = path.join(ROOT, ".venv-fonts");
const PYFTSUBSET = process.env.MOMOKO_PYFTSUBSET
  ? path.resolve(process.env.MOMOKO_PYFTSUBSET)
  : path.join(VENV, "bin/pyftsubset");
const PYTHON = process.env.MOMOKO_FONTTOOLS_PYTHON
  ? path.resolve(process.env.MOMOKO_FONTTOOLS_PYTHON)
  : path.join(VENV, "bin/python");

function provision() {
  // Idempotent one-time install of the pinned font tooling. Not part of the
  // subset build path (which must stay offline).
  if (process.env.MOMOKO_PYFTSUBSET || fs.existsSync(PYTHON)) return;
  const req = path.join(__dirname, "requirements.txt");
  const python3 = process.env.MOMOKO_PYTHON3 || "python3";
  let usedUv = false;
  try {
    execFileSync(python3, ["-m", "venv", VENV], { cwd: ROOT, stdio: "pipe" });
  } catch {
    execFileSync("uv", ["venv", VENV], { cwd: ROOT, stdio: "inherit" });
    usedUv = true;
  }
  if (usedUv) {
    execFileSync("uv", ["pip", "install", "--python", PYTHON, "-r", req], { cwd: ROOT, stdio: "inherit" });
  } else {
    execFileSync(PYTHON, ["-m", "pip", "install", "--disable-pip-version-check", "-r", req], {
      cwd: ROOT,
      stdio: "inherit",
    });
  }
}

function requireTooling() {
  if (process.env.MOMOKO_PYFTSUBSET) return;
  if (!fs.existsSync(PYTHON) || !fs.existsSync(PYFTSUBSET)) {
    console.error(
      "[fonts] pinned fonttools venv missing; run `pnpm fonts:install` first " +
        "(offline build must not provision).",
    );
    process.exit(1);
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === "install") {
    provision();
    console.log("[fonts] tooling ready");
    return;
  }
  requireTooling();
  const { requiredCodepoints } = await import("./pipeline.ts");
  fs.mkdirSync(path.dirname(CORPUS_TMP), { recursive: true });
  const corpus = {};
  for (const locale of LOCALES) corpus[locale] = requiredCodepoints(locale);
  fs.writeFileSync(CORPUS_TMP, JSON.stringify(corpus));

  execFileSync(
    PYTHON,
    [
      path.join(__dirname, "subset.py"),
      "--corpus", CORPUS_TMP,
      "--out", OUT,
      "--pyftsubset", PYFTSUBSET,
      "--fontroot", path.join(ROOT, "node_modules/@fontsource"),
      "--manifest", MANIFEST,
      "--css", CSS,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );

  // Surface the budget line for CI logs.
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  console.log(`[fonts] manifest written: ${manifest.total_bytes} bytes total (< ${manifest.budget_bytes} budget)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
