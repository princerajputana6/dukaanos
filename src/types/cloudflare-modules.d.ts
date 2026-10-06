// Ambient module declarations for workerd built-ins (script file: no top-level imports).
declare module "cloudflare:workers" {
  export const env: Env;
  export function waitUntil(promise: Promise<unknown>): void;
}
