// Hash-based routing in a few lines: deep links work from the static build without server rewrites.

import { useSyncExternalStore } from "react";

export type Route =
  | { name: "login" }
  | { name: "dashboard" }
  | { name: "requests"; params: URLSearchParams }
  | { name: "request"; id: number }
  | { name: "new" }
  | { name: "not-found" };

export function parseHash(hash: string): Route {
  const [path = "", search = ""] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(search);
  if (path === "" || path === "/" || path === "/dashboard") return { name: "dashboard" };
  if (path === "/login") return { name: "login" };
  if (path === "/requests") return { name: "requests", params };
  if (path === "/new") return { name: "new" };
  const detail = /^\/requests\/(\d{1,9})$/.exec(path);
  if (detail) return { name: "request", id: Number(detail[1]) };
  return { name: "not-found" };
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  return parseHash(hash);
}

export function navigate(path: string): void {
  window.location.hash = `#${path}`;
}
