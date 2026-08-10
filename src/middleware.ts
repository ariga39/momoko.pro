import type { APIContext, MiddlewareHandler } from "astro";

import { configureRuntimeEnv } from "./lib/runtime-config.ts";

export const onRequest: MiddlewareHandler = async (context: APIContext, next) => {
  const runtime = (context.locals as { runtime?: { env?: unknown } }).runtime;
  configureRuntimeEnv(runtime?.env);
  return next();
};
