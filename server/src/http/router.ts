// A minimal method + path router with ":param" segments. No framework needed for a dozen routes.

import type { UserDto } from "../../../shared/contracts.ts";

export interface RequestContext {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  user: UserDto | null;
  sessionToken: string | undefined;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler = (ctx: RequestContext) => ApiResponse;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  requiresAuth: boolean;
}

export type Match =
  | { kind: "found"; route: Route; params: Record<string, string> }
  | { kind: "method-not-allowed"; allowed: string[] }
  | { kind: "not-found" };

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler, options: { auth: boolean }): this {
    const keys: string[] = [];
    const source = path
      .split("/")
      .map((segment) => {
        if (!segment.startsWith(":")) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        keys.push(segment.slice(1));
        return "([^/]+)";
      })
      .join("/");
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler, requiresAuth: options.auth });
    return this;
  }

  match(method: string, pathname: string): Match {
    const allowed: string[] = [];
    for (const route of this.routes) {
      const result = route.pattern.exec(pathname);
      if (!result) continue;
      if (route.method !== method) {
        allowed.push(route.method);
        continue;
      }
      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(result[index + 1] ?? "");
      });
      return { kind: "found", route, params };
    }
    return allowed.length > 0 ? { kind: "method-not-allowed", allowed } : { kind: "not-found" };
  }
}
