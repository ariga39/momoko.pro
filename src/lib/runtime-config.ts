type RuntimeEnv = Record<string, unknown>;

let requestEnv: RuntimeEnv | undefined;

/**
 * Bind Cloudflare Worker env values to the content seam for the current
 * request. Node-side builds continue to use process.env, while production
 * workers receive only explicit bindings from the platform request context.
 */
export function configureRuntimeEnv(env: unknown): void {
  requestEnv = env && typeof env === "object" ? env as RuntimeEnv : undefined;
}

export function runtimeEnv(name: string): string | undefined {
  const bound = requestEnv?.[name];
  if (typeof bound === "string") return bound;
  const local = process.env[name];
  return typeof local === "string" ? local : undefined;
}
