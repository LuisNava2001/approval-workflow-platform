// Serves the built web client (web/dist) with path containment and a strict Content-Security-Policy.

import { existsSync, readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export const PAGE_SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

function resolveInside(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = resolve(root, `.${decoded}`);
  return candidate === root || candidate.startsWith(root + sep) ? candidate : null;
}

/** Serve a file from `distDir`, falling back to index.html. Returns false when nothing was served. */
export function serveStatic(distDir: string | null, method: string, pathname: string, res: ServerResponse): boolean {
  if (!distDir || (method !== "GET" && method !== "HEAD")) return false;
  const root = resolve(distDir);
  const index = join(root, "index.html");
  if (!existsSync(index)) return false;

  let file = resolveInside(root, pathname);
  if (!file || !existsSync(file) || !statSync(file).isFile()) file = index;
  const body = readFileSync(file);
  const isAsset = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    ...PAGE_SECURITY_HEADERS,
    "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(method === "HEAD" ? undefined : body);
  return true;
}
