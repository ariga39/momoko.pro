export interface EmbeddedContentPackage {
  enabled: boolean;
  explicit: boolean;
  relativeRoot: string;
  mode: "test" | "dev" | null;
  files: Record<string, string>;
}

/** Replaced by the Astro build plugin; Vitest uses the filesystem fallback. */
export const embeddedPackage: EmbeddedContentPackage = {
  enabled: false,
  explicit: false,
  relativeRoot: "content",
  mode: null,
  files: {},
};
