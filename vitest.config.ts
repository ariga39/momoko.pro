import { getViteConfig } from "astro/config";
import { defineConfig } from "vitest/config";

// Astro's container API needs the astro vite plugins (astro:build transforms
// .astro sources) to render server HTML in vitest. Astro 5.18 targets Vite 6
// but vitest 2.1.9 runs Vite 5, so dev-server/adapter plugins that require the
// Vite 6 environment API are excluded, and astro:build is patched to supply a
// server environment object the transform hook expects. The embedded-package
// override plugin is intentionally NOT registered so unit tests keep the
// filesystem fallback and their explicit test-mode overrides.

// Minimal structural shape for the plugin entries we keep; avoids depending on
// the exact Vite plugin union that differs between Vite 5 (vitest) and Vite 6
// (astro), which astro check would otherwise type-check.
interface NamedPlugin {
  name?: string;
  configEnvironment?: unknown;
  transform?: (this: { environment?: { name: string } }, source: string, id: string, options: object) => unknown;
  [key: string]: unknown;
}

const resolved = await getViteConfig({}, {})({ mode: "test", command: "serve" });

const keep = new Set([
  "astro:scripts",
  "astro:markdown",
  "astro:html",
  "astro:postprocess",
  "astro:i18n",
  "astro:container",
  "astro:build",
]);

const plugins = (resolved.plugins ?? [])
  .flat()
  .filter((p) => keep.has((p as NamedPlugin | null)?.name ?? ""))
  .map((p) => {
    if ((p as NamedPlugin | null)?.name !== "astro:build") return p;
    const copy: NamedPlugin = { ...(p as NamedPlugin) };
    // astro:build's configEnvironment targets the Vite 6 environment API,
    // which vitest 2.1.9 (Vite 5) does not call; drop it defensively.
    delete copy.configEnvironment;
    const transform = copy.transform;
    return {
      ...copy,
      async transform(
        this: { environment?: { name: string } },
        source: string,
        id: string,
        options: object,
      ) {
        this.environment ??= { name: "server" };
        return transform?.call(this, source, id, options);
      },
    };
  });

export default defineConfig({
  // resolved comes from astro's Vite 6 config; vitest 2.1.9 types Vite 5, and
  // the cross-version UserConfig fields (json.stringify etc.) diverge under
  // exactOptionalPropertyTypes, so the astro-derived portion is passed through
  // as-is while vitest's own options keep full typing.
  ...(resolved as object),
  plugins: plugins as never[],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
