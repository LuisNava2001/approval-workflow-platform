// Optional browser smoke test through the Chrome DevTools Protocol (no extra npm packages).
//
//   npm run seed && npm run build && npm start            # in one terminal
//   npm run smoke:browser -- --screenshots docs/images     # in another
//
// It signs in through the UI, checks key screens, approves one request, checks responsive layout and
// fails on console errors or CSP violations. It changes data, so run it against a freshly seeded database.
// Chrome is located via CHROME_PATH or common install paths. Not part of CI.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const base = option("--base", "http://127.0.0.1:3000");
const screenshots = option("--screenshots", null);
const candidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const chromePath = candidates.find((path) => existsSync(path));
if (!chromePath) {
  console.error("Chrome not found. Set CHROME_PATH.");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), "awp-smoke-"));
const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { await sleep(250); }
  }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  let nextId = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); } else events.push(data);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (data) => (data.error ? reject(new Error(`${method}: ${JSON.stringify(data.error)}`)) : resolve(data.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  const go = async (path) => { await send("Page.navigate", { url: base + path }); await sleep(1300); };
  const text = () => evaluate("document.body.innerText");
  const click = (label) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (b) b.click(); return Boolean(b); })()`);
  const shot = async (name) => {
    if (!screenshots) return;
    mkdirSync(screenshots, { recursive: true });
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(screenshots, `${name}.png`), Buffer.from(data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  await go("/#/login");
  check("login lists the seven demo identities", (await evaluate("document.querySelectorAll('button.identity').length")) === 7);
  await shot("login");
  await evaluate(`[...document.querySelectorAll('button.identity')].find(b => b.textContent.includes('Morgan')).click()`);
  await sleep(1500);
  check("signing in as Morgan opens the dashboard", (await text()).includes("Welcome, Morgan"));
  await shot("dashboard");

  await go("/#/requests/6");
  const ownButtons = await evaluate("[...document.querySelectorAll('.action-panel button')].map(b => b.textContent.trim())");
  check("own request: withdraw only, with a separation-of-duties note",
    JSON.stringify(ownButtons) === '["Withdraw"]' && (await text()).includes("Separation of duties"));

  const seededStatus = await evaluate("fetch('/api/requests/3').then(r => r.json()).then(b => b.request && b.request.status)");
  const fresh = seededStatus === "PENDING_MANAGER";
  check("database is freshly seeded (REQ-0003 pending manager)", fresh, fresh ? "" : `found ${seededStatus}; run npm run seed and restart`);
  if (fresh) {
    await go("/#/requests/3");
    await click("Reject");
    check("rejecting requires a reason", await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Confirm rejection')?.disabled === true`));
    await click("Cancel");
    await click("Approve");
    await click("Confirm approval");
    await sleep(1200);
    const after = await text();
    check("approving in the UI moves the request to finance", after.includes("Saved.") && after.includes("Pending finance"));
    await shot("request-detail");
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (const path of ["/#/dashboard", "/#/requests"]) {
    await go(path);
    const overflow = await evaluate("document.documentElement.scrollWidth - window.innerWidth");
    check(`no horizontal overflow at 390 px on ${path}`, overflow <= 0, `overflow=${overflow}px`);
  }

  const problems = events
    .filter((e) => (e.method === "Log.entryAdded" && ["error", "warning"].includes(e.params.entry.level)) ||
      (e.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(e.params.type)) ||
      e.method === "Runtime.exceptionThrown")
    .map((e) => e.params.entry?.text ?? e.params.exceptionDetails?.text ?? "console message");
  check("no console errors, exceptions or CSP violations", problems.length === 0, problems.slice(0, 3).join(" | "));
  ws.close();
} catch (error) {
  check("smoke test completed", false, String(error));
} finally {
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill();
  await Promise.race([exited, sleep(5000)]);
  try {
    // Chrome may keep profile files locked briefly on Windows; cleanup is best effort.
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    console.warn(`Could not remove the temporary Chrome profile at ${profile}.`);
  }
}

for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.detail ? `  (${result.detail})` : ""}`);
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
