import { afterEach, describe, expect, it } from "vitest";

import { ContentPackageError, readContentPackageManifest } from "../src/lib/content.ts";
import { embeddedPackage } from "../src/lib/embedded-package.ts";

const originalEnabled = embeddedPackage.enabled;
const originalFiles = { ...embeddedPackage.files };

const MANIFEST = JSON.stringify({
  package_version: "1",
  content_schema_version: "1",
  status: "ready",
});

afterEach(() => {
  embeddedPackage.enabled = originalEnabled;
  embeddedPackage.files = { ...originalFiles };
});

function installEmbeddedWithEncyclopedia() {
  delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
  delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
  delete process.env.PUBLIC_BUILD;
  embeddedPackage.enabled = true;
  embeddedPackage.explicit = false;
  embeddedPackage.relativeRoot = "content";
  embeddedPackage.mode = null;
  embeddedPackage.files = {
    "package.json": MANIFEST,
    "encyclopedia/momoko-suou/content.ja.md": "---\nkind: wiki\nlang: ja\nis_canonical: true\nreview_status: reviewed\n---\nbody",
  };
}

describe("encyclopedia embedded build boundary", () => {
  it("accepts an encyclopedia top-level entry in the embedded package manifest", () => {
    installEmbeddedWithEncyclopedia();

    // The embedded manifest boundary must allow the encyclopedia top-level so
    // production builds can embed reviewed profiles.
    const manifest = readContentPackageManifest();
    expect(manifest.status).toBe("ready");
  });
});
