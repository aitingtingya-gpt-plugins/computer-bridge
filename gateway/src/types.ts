export interface Env {
  HUB: DurableObjectNamespace;
  OAUTH_KV: KVNamespace;
  PUBLIC_URL: string;
  BRIDGE_SECRET: string;
  GITHUB_RELEASE_TOKEN?:string;
  UPDATER?:Fetcher;
}
export type Data = Record<string, any>;

export const opaque = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
export const escape = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export async function hash(s: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, "0")).join("");
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, {status, headers: {"Cache-Control": "no-store"}});
}
export function page(title: string, body: string, headers?: HeadersInit, css = "", pageClass = ""): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set("Cache-Control", "no-store");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "no-referrer");
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${css}</style></head><body class="${escape(pageClass)}"><header class="topbar"><a class="brand" href="/manage"><span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 16V9a3 3 0 0 1 3-3h3m4 0h3a3 3 0 0 1 3 3v7M8 13l4 4 4-4M12 4v13"/></svg></span>Computer Bridge</a></header><main><h1>${escape(title)}</h1>${body}</main></body></html>`, {headers: h});
}
