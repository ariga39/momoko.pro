import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../../");
const FONTROOT = path.resolve(__dirname, "../../node_modules/@fontsource");
const LOCK_PATH = path.resolve(__dirname, "../../tools/fonts/source-lock.json");
const PYTHON = process.env.MOMOKO_FONTTOOLS_PYTHON
  ? path.resolve(process.env.MOMOKO_FONTTOOLS_PYTHON)
  : path.join(ROOT, ".venv-fonts/bin/python");

const VERIFY_SNIPPET = `
import sys
sys.path.insert(0, sys.argv[1])
from subset import verify_source_lock, sha256_file
import json
from pathlib import Path
lock = json.loads(Path(sys.argv[2]).read_text())
try:
    verify_source_lock(Path(sys.argv[3]), Path(sys.argv[2]))
    print("LOCK_OK")
except SystemExit as e:
    print("LOCK_FAIL:", e)
    sys.exit(0)
except Exception as e:
    print("LOCK_ERROR:", e)
    sys.exit(0)
`;

function runVerify(fontroot: string, lock: Record<string, unknown>) {
  const lockFile = path.join(os.tmpdir(), `momoko-lock-${Date.now()}.json`);
  fs.writeFileSync(lockFile, JSON.stringify(lock));
  const out = execFileSync(PYTHON, ["-c", VERIFY_SNIPPET, path.join(ROOT, "tools/fonts"), lockFile, fontroot], {
    encoding: "utf8",
  }).trim();
  fs.rmSync(lockFile, { force: true });
  return out;
}

function setupTempFontroot() {
  // Copy only the locked shards (LICENSE + package.json) to a temp root so
  // tampering never touches the real node_modules and the test stays fast.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "momoko-fontroot-"));
  const lock = readLock();
  for (const pkg of Object.keys(lock.packages)) {
    const src = path.join(FONTROOT, pkg);
    const dst = path.join(tmp, pkg);
    fs.mkdirSync(path.join(dst, "files"), { recursive: true });
    fs.copyFileSync(path.join(src, "LICENSE"), path.join(dst, "LICENSE"));
    fs.copyFileSync(path.join(src, "package.json"), path.join(dst, "package.json"));
    for (const shard of Object.keys(lock.packages[pkg].shards)) {
      fs.copyFileSync(path.join(src, "files", shard), path.join(dst, "files", shard));
    }
  }
  return tmp;
}

function readLock() {
  return JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
}

describe("source lock is a trusted pin (task #25)", () => {
  it("a clean copy verifies against the committed lock", () => {
    const tmp = setupTempFontroot();
    try {
      expect(runVerify(tmp, readLock())).toBe("LOCK_OK");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("tampering a shard BEFORE subset generation fails closed", () => {
    const tmp = setupTempFontroot();
    try {
      const shard = path.join(tmp, "noto-sans-sc/files/noto-sans-sc-87-400-normal.woff2");
      fs.appendFileSync(shard, Buffer.from("tamper"));
      expect(runVerify(tmp, readLock())).toMatch(/LOCK_FAIL:.*shard sha256 mismatch/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("tampering a LICENSE before subset generation fails closed", () => {
    const tmp = setupTempFontroot();
    try {
      fs.appendFileSync(path.join(tmp, "inter/LICENSE"), "\ntampered");
      expect(runVerify(tmp, readLock())).toMatch(/LOCK_FAIL:.*LICENSE sha256 mismatch/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a package version mismatch fails closed", () => {
    const tmp = setupTempFontroot();
    try {
      const pkg = path.join(tmp, "noto-sans-jp/package.json");
      const data = JSON.parse(fs.readFileSync(pkg, "utf8"));
      data.version = "5.9.9";
      fs.writeFileSync(pkg, JSON.stringify(data));
      expect(runVerify(tmp, readLock())).toMatch(/LOCK_FAIL:.*version.*!=/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
