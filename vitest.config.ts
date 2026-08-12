import { getViteConfig } from "astro/config";

// Astro's container API needs the astro vite plugins (astro:build transforms
// .astro sources) to render server HTML in vitest. Astro 5.18 targets Vite 6
// but vitest 2.1.9 runs Vite 5, so dev-server/adapter plugins that require the
// Vite 6 environment API are excluded, and astro:build is patched to supply a
// server environment object the transform hook expects. The embedded-package
// override plugin is intentionally NOT registered so unit tests keep the
// filesystem fallback and their explicit test-mode overrides.
const resolved = await getViteConfig(
  {
    test: {
      include: ["tests/**/*.test.ts"],
      environment: "node",
      setupFiles: ["tests/setup.ts"],
    },
  },
  {},
)({ mode: "test", command: "serve" });

const keep = new Set([
  "astro:scripts",
  "astro:markdown",
  "astro:html",
  "astro:postprocess",
  "astro:i18n",
  "astro:container",
  "astro:build",
]);

export default {
  ...resolved,
  plugins: resolved.plugins
    .flat()
    .filter((p) => keep.has(p?.name ?? ""))
    .map((p) => {
      if (p?.name !== "astro:build") return p;
      const { configEnvironment, ...rest } = p;
      return {
        ...rest,
        async transform(source, id, options) {
          this.environment = this.environment ?? { name: "server" };
          return rest.transform.call(this, source, id, options);
        },
      };
    }),
};
