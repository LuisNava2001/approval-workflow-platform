// HTTP application: routing, session cookies, JSON parsing, security headers and error mapping.

import type { IncomingMessage, ServerResponse } from "node:http";
import { ACTIONS, type Action, type ApiErrorBody } from "../../../shared/contracts.ts";
import type { AuthService } from "../application/authService.ts";
import { AppError, badRequest, notFound, unauthenticated } from "../application/errors.ts";
import type { RequestService } from "../application/requestService.ts";
import { Router, type ApiResponse, type RequestContext } from "./router.ts";
import { PAGE_SECURITY_HEADERS, serveStatic } from "./static.ts";

export const SESSION_COOKIE = "awp_session";
export const MAX_BODY_BYTES = 32 * 1024;

export interface AppOptions {
  auth: AuthService;
  requests: RequestService;
  /** Expose the demo identity list for the login screen. */
  demoMode: boolean;
  /** Add the Secure attribute to the session cookie (enable behind HTTPS). */
  cookieSecure: boolean;
  sessionTtlSeconds: number;
  webDist: string | null;
  log?: (line: string) => void;
}

const API_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function parseId(raw: string | undefined): number {
  return raw && /^\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN;
}

function buildRouter(options: AppOptions): Router {
  const { auth, requests } = options;
  const cookie = (token: string, maxAge: number) =>
    [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`]
      .concat(options.cookieSecure ? ["Secure"] : [])
      .join("; ");
  const requireUser = (ctx: RequestContext) => {
    if (!ctx.user) throw unauthenticated();
    return ctx.user;
  };

  const router = new Router()
    .add("GET", "/api/health", () => ({ status: 200, body: { status: "ok" } }), { auth: false })
    .add(
      "GET",
      "/api/demo/identities",
      () => {
        if (!options.demoMode) throw notFound();
        return { status: 200, body: { identities: auth.listUsers() } };
      },
      { auth: false },
    )
    .add(
      "POST",
      "/api/auth/login",
      (ctx) => {
        const session = auth.login(ctx.body);
        return {
          status: 200,
          body: { user: session.user, expiresAt: session.expiresAt },
          headers: { "Set-Cookie": cookie(session.token, options.sessionTtlSeconds) },
        };
      },
      { auth: false },
    )
    .add(
      "POST",
      "/api/auth/logout",
      (ctx) => {
        auth.logout(ctx.sessionToken);
        return { status: 204, headers: { "Set-Cookie": cookie("", 0) } };
      },
      { auth: false },
    )
    .add("GET", "/api/auth/me", (ctx) => ({ status: 200, body: { user: requireUser(ctx) } }), { auth: true })
    // Public session probe for the UI at startup: 200 with the user or null, so no 401 is logged.
    .add("GET", "/api/auth/session", (ctx) => ({ status: 200, body: { user: ctx.user } }), { auth: false })
    .add(
      "GET",
      "/api/requests",
      (ctx) => ({
        status: 200,
        body: {
          requests: requests.list(requireUser(ctx), {
            status: ctx.query.get("status"),
            scope: ctx.query.get("scope"),
            q: ctx.query.get("q"),
          }),
        },
      }),
      { auth: true },
    )
    .add("POST", "/api/requests", (ctx) => ({ status: 201, body: { request: requests.create(requireUser(ctx), ctx.body) } }), {
      auth: true,
    })
    .add(
      "GET",
      "/api/requests/:id",
      (ctx) => ({ status: 200, body: { request: requests.get(requireUser(ctx), parseId(ctx.params.id)) } }),
      { auth: true },
    )
    .add(
      "POST",
      "/api/requests/:id/:action",
      (ctx) => {
        const action = (ctx.params.action ?? "").toUpperCase();
        if (!(ACTIONS as readonly string[]).includes(action)) throw notFound();
        const request = requests.transition(requireUser(ctx), parseId(ctx.params.id), action as Action, ctx.body);
        return { status: 200, body: { request } };
      },
      { auth: true },
    )
    .add("GET", "/api/dashboard", (ctx) => ({ status: 200, body: { dashboard: requests.dashboard(requireUser(ctx)) } }), {
      auth: true,
    });
  return router;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  const contentType = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  // Requiring JSON blocks cross-site HTML form posts, which cannot send this content type.
  if (contentType !== "application/json") {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Send request bodies as application/json.");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw badRequest("The request body is not valid JSON.");
  }
}

function send(res: ServerResponse, response: ApiResponse): void {
  const headers = { ...API_HEADERS, ...response.headers };
  if (response.body === undefined) {
    delete headers["Content-Type"];
    res.writeHead(response.status, headers);
    res.end();
    return;
  }
  res.writeHead(response.status, headers);
  res.end(JSON.stringify(response.body));
}

function errorResponse(error: unknown, log: (line: string) => void): ApiResponse {
  if (error instanceof AppError) {
    const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
    if (error.details) body.error.details = error.details;
    return { status: error.status, body };
  }
  // Unexpected failures are logged server-side; the client gets a generic message, never a stack trace.
  log(`unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return { status: 500, body: { error: { code: "INTERNAL", message: "Something went wrong." } } satisfies ApiErrorBody };
}

export function createApp(options: AppOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const router = buildRouter(options);
  const log = options.log ?? (() => {});

  return (req, res) => {
    const started = Date.now();
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    res.on("finish", () => log(`${method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`));

    if (!url.pathname.startsWith("/api/")) {
      if (serveStatic(options.webDist, method, url.pathname, res)) return;
      res.writeHead(404, { ...PAGE_SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found. Build the web client with `npm run build` to serve it from this server.");
      return;
    }

    void (async () => {
      try {
        const match = router.match(method, url.pathname);
        if (match.kind === "not-found") throw notFound("Unknown API route.");
        if (match.kind === "method-not-allowed") {
          throw new AppError(405, "METHOD_NOT_ALLOWED", `Use ${match.allowed.join(" or ")} for this route.`);
        }
        const body = method === "POST" || method === "PUT" || method === "PATCH" ? await readBody(req) : undefined;
        const sessionToken = parseCookies(req.headers.cookie)[SESSION_COOKIE] || undefined;
        const user = options.auth.authenticate(sessionToken);
        // Authentication is checked here; authorization (403) is decided by the policy inside each use case.
        if (match.route.requiresAuth && !user) throw unauthenticated();
        send(res, match.route.handler({ params: match.params, query: url.searchParams, body, user, sessionToken }));
      } catch (error) {
        send(res, errorResponse(error, log));
      }
    })();
  };
}
