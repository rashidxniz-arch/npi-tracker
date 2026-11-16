// Browser smoke tests for the app (index.html) and publisher (latest.html) against an in-memory Firebase stand-in.
// Run: npm install && npm run test:smoke   (set CHROME_PATH to use a specific Chromium)
// No real Firebase, Outlook or CDN is contacted: Firebase/SheetJS/font requests are intercepted. All data is synthetic.
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STUB = readFileSync(join(ROOT, "tests/smoke/firebase-stub.js"), "utf8");
const SHEETJS = readFileSync(require.resolve("xlsx/dist/xlsx.full.min.js"), "utf8");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

const TEAM = ["rashid", "fadzmi", "liyana", "yusri", "zul", "fakrul", "wajdi", "shamsuri"];
const NAMES = { rashid: "Rashid", fadzmi: "Fadzmi", liyana: "Liyana", yusri: "Yusri", zul: "Zul", fakrul: "Fakrul", wajdi: "Wajdi", shamsuri: "Shamsuri" };
function seed() {
  const docs = {};
  TEAM.forEach((k, i) => { docs["team/" + k] = { key: k, name: NAMES[k], short: NAMES[k], ini: NAMES[k].slice(0, 2).toUpperCase(), order: i }; });
  docs["users/u-admin"] = { active: true, role: "admin", name: "Rashid", teamKey: "rashid" };
  docs["users/u-zul"] = { active: true, role: "member", name: "Zul Azri", teamKey: "zul" };
  docs["users/u-view"] = { active: true, role: "viewer", name: "Wajdi", teamKey: "wajdi" };
  // Legacy flat snapshot as published by the old latest.html (row-number IDs, no version pointer).
  const P = [
    { "Project / Programme": "Synthetic Alpha", Customer: "Cust A", "Latest Status": "Pending review", "Mentioned Owner / Contact": "Fadzmi", "Latest Email Date": { __ts: Date.UTC(2026, 9, 28) }, Workstream: "Tooling", "Latest Evidence / Update": "DFM sent", "Next Action": "Await reply" },
    { "Project / Programme": "Synthetic Beta", Customer: "Cust B", "Latest Status": "At risk - delay", "Mentioned Owner / Contact": "external contact", "Latest Email Date": "29 Oct 2026" }
  ];
  const A = [
    { Action: "Send synthetic DFM", Project: "Synthetic Alpha", "Mentioned Owner / Team": "Zul", "Latest State": "Open", "Due / Target": "1 Nov 2026" },
    { Action: "Confirm synthetic qty", Project: "Synthetic Beta", "Mentioned Owner / Team": "customer", "Latest State": "Open" }
  ];
  const E = [{ "Email Date": { __ts: Date.UTC(2026, 9, 30) }, "Email Subject": "Re: Synthetic Alpha", "Evidence Extract": "Attached v2", Project: "Synthetic Alpha" }];
  P.forEach((x, i) => { docs["emailSnapshotProjects/" + String(i + 1).padStart(4, "0")] = { ...x, rowNumber: i + 1 }; });
  A.forEach((x, i) => { docs["emailSnapshotActions/" + String(i + 1).padStart(4, "0")] = { ...x, rowNumber: i + 1 }; });
  E.forEach((x, i) => { docs["emailSnapshotEvidence/" + String(i + 1).padStart(4, "0")] = { ...x, rowNumber: i + 1 }; });
  docs["emailSnapshotMeta/current"] = { asOf: "2026-10-30", publishedBy: "admin@example.test" };
  docs["status/email-action-002"] = { id: "email-action-002", done: true, by: "zul", at: "2026-11-01T00:00:00Z", actorUid: "u-zul" };
  docs["tasks/team-1"] = { id: "team-1", source: "google-sheets", owner: "zul", text: "Synthetic team task", createdBy: "zul", createdByUid: "u-zul", createdAt: "2026-11-02T00:00:00Z" };
  docs["updates/u1"] = { id: "u1", at: "2026-11-03T08:00:00Z", owner: "zul", text: "Synthetic legacy update", project: "email-project-001", createdBy: "zul", createdByUid: "u-zul" };
  return { docs, users: { "admin@example.test": "u-admin", "zul@example.test": "u-zul", "viewer@example.test": "u-view" }, deny: [], log: [] };
}
function workbook(path, variant) {
  const wb = XLSX.utils.book_new();
  const P = [
    { "Project / Programme": "Synthetic Alpha", Customer: "Cust A", "Latest Status": variant === 2 ? "On track" : "Pending review", "Mentioned Owner / Contact": "Fadzmi", "Latest Email Date": "12 Nov 2026" },
    { "Project / Programme": "Synthetic Beta", Customer: "Cust B", "Latest Status": "At risk - delay", "Mentioned Owner / Contact": "Zul", "Latest Email Date": "13 Nov 2026" },
    { "Project / Programme": "Synthetic Gamma", Customer: "Cust A", "Latest Status": "Open", "Mentioned Owner / Contact": "", "Latest Email Date": "14 Nov 2026" }
  ];
  const A = [
    { Action: "Confirm synthetic qty", Project: "Synthetic Beta", "Mentioned Owner / Team": "Zul", "Latest State": "Open" },
    { Action: "Send synthetic DFM", Project: "Synthetic Alpha", "Mentioned Owner / Team": "Zul", "Latest State": "Open", "Due / Target": "20 Nov 2026" },
    { Action: variant === 2 ? "Book synthetic trial (v2)" : "Book synthetic trial", Project: "Synthetic Gamma", "Latest State": "Open" }
  ];
  const E = [{ "Email Date": variant === 2 ? "15 Nov 2026" : "14 Nov 2026", "Email Subject": "Re: Synthetic Gamma", "Evidence Extract": "Trial request", Project: "Synthetic Gamma", "Source Message ID": "hash-001" }];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(P), "Latest Projects");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(A), "Latest Actions");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(E), "Email Evidence");
  XLSX.writeFile(wb, path);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const ctx = await browser.newContext({ acceptDownloads: true });
// Playwright tries the most recently added route first, so the generic Firebase route is added before the app-compat one.
await ctx.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: "text/javascript", body: "/* stubbed */" }));
await ctx.route(/gstatic\.com\/firebasejs\/.*app-compat/, r => r.fulfill({ contentType: "text/javascript", body: STUB }));
await ctx.route(/cdn\.sheetjs\.com|cdn\.jsdelivr\.net\/npm\/xlsx/, r => r.fulfill({ contentType: "text/javascript", body: SHEETJS }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await ctx.addInitScript(s => { window.__FS_SEED = s; }, seed());
const page = await ctx.newPage(); if (process.env.DEBUG) { page.on("console", m => console.log("CONSOLE", m.type(), m.text())); page.on("requestfailed", r => console.log("REQFAIL", r.url().slice(0, 100))); }
const errors = []; page.on("pageerror", e => errors.push(e.message));
page.on("dialog", d => d.accept());
let n = 0; const ok = m => { n++; console.log("  ✓ " + m); };
const store = () => page.evaluate(() => JSON.parse(localStorage.getItem("__fsStore")));
async function signIn(email) {
  await page.goto(BASE + "/index.html");
  await page.evaluate(() => sessionStorage.removeItem("__fsUser")); await page.reload(); // start signed out
  await page.fill("#firebaseEmail", email); await page.fill("#firebasePassword", "test-password"); await page.click("#lockBtn");
  await page.waitForSelector("#app:not([hidden])", { timeout: 10000 });
}

async function adminPage() {
  await page.goto(BASE + "/latest.html");
  const u = await page.evaluate(() => JSON.parse(sessionStorage.getItem("__fsUser") || "null"));
  if (!u || u.uid !== "u-admin") {
    await page.evaluate(() => sessionStorage.removeItem("__fsUser")); await page.reload();
    await page.fill("#email", "admin@example.test"); await page.fill("#password", "test-password"); await page.click("#login");
  }
  await page.waitForSelector("#admin:not(.hide)");
}
console.log("App against the legacy flat snapshot");
await signIn("zul@example.test");
ok("signs in and opens the tracker");
await page.goto(BASE + "/index.html#actions"); await page.waitForSelector("#app:not([hidden])", { timeout: 10000 });
ok("session is restored after reload without typing the password");
await page.click('[data-ashow="all"]'); await page.waitForTimeout(150);
const actText = await page.textContent("#actions");
assert.ok(actText.includes("Synthetic team task"), "team task visible while a snapshot is live");
ok("team-added task stays visible while the email snapshot is live");
assert.ok(actText.includes("Not matched to a team member"), "unassigned group");
ok("action with no team member named is shown as unassigned (not given to Rashid)");
assert.strictEqual(await page.isChecked('.row:has-text("Confirm synthetic qty") .check'), true);
ok("tick saved under the old index ID (email-action-002) still shows");
assert.strictEqual(await page.isDisabled("#whoami"), true);
ok("identity comes from the account and cannot be switched");
await page.click('.row:has-text("Send synthetic DFM") .check'); await page.waitForTimeout(400);
let st = await store(); const tick = Object.entries(st.docs).find(([k, v]) => k.startsWith("status/ea-") && v.by === "zul");
assert.ok(tick, "new tick stored under a stable ea- ID, signed by the signed-in user");
ok("new tick is stored under a stable ID and signed as the signed-in user");
await page.goto(BASE + "/index.html#projects"); await page.waitForTimeout(300);
assert.ok(!(await page.textContent("#projects")).includes("overdue"), "latest email date must not create overdue flags");
ok("latest email date no longer shows as an overdue due date");
await page.goto(BASE + "/index.html#email-intel"); await page.waitForTimeout(300);
const ei = await page.textContent("#v-email-intel");
assert.ok(!/\[object Object\]|Timestamp\(/.test(ei), "dates render as text");
assert.ok(/days old/.test(await page.textContent("#emailIntelSummary")), "stale snapshot flagged");
ok("email dates render as text and a stale snapshot is flagged");
await page.click("#meBtn"); await page.click("#logout"); await page.waitForSelector("#lock:not([hidden])");
assert.strictEqual(await page.evaluate(() => localStorage.getItem("npi-team-cache")), null);
ok("sign out clears cached team data");

console.log("Publisher: validate → backup → stage → verify → switch → audit → mirror");
workbook("/tmp/npi-smoke-1.xlsx", 1); workbook("/tmp/npi-smoke-2.xlsx", 2);
await adminPage();
assert.strictEqual(await page.isDisabled("#publish"), true);
await page.setInputFiles("#file", "/tmp/npi-smoke-1.xlsx"); await page.waitForTimeout(300);
assert.ok((await page.textContent("#report")).includes("No blocking problems"), await page.textContent("#report"));
assert.strictEqual(await page.isDisabled("#publish"), true, "publish stays locked until backup");
ok("workbook validated; publish locked until a backup is taken");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#backup")]);
const backup = JSON.parse(readFileSync(await dl.path(), "utf8"));
assert.strictEqual(backup.collections.emailSnapshotActions.length, 2);
ok("backup JSON contains the live snapshot");
await page.click("#publish"); await page.waitForFunction(() => /Published version/.test(document.getElementById("pubMsg").textContent), null, { timeout: 15000 });
st = await store();
const meta = st.docs["emailSnapshotMeta/current"], v1 = meta.version;
assert.ok(v1 && st.docs["emailSnapshots/" + v1].status === "published");
assert.strictEqual(Object.keys(st.docs).filter(k => k.startsWith("emailSnapshots/" + v1 + "/actions/")).length, 3);
assert.ok(Object.values(st.docs).some(d => d.action === "snapshot_published" && d.actor === "rashid"), "audit entry");
assert.strictEqual(Object.keys(st.docs).filter(k => k.startsWith("emailSnapshotActions/")).length, 3, "legacy mirror");
assert.ok(st.docs["tasks/team-1"] && st.docs["updates/u1"], "projects/tasks/updates untouched");
ok("version " + v1 + " staged, verified and made live; audit entry written; legacy copy mirrored; tasks untouched");

console.log("App against the versioned snapshot");
await signIn("zul@example.test");
await page.goto(BASE + "/index.html#actions"); await page.waitForTimeout(300); await page.click('[data-ashow="all"]'); await page.waitForTimeout(150);
assert.strictEqual(await page.isChecked('.row:has-text("Send synthetic DFM") .check'), true, "tick survives republish with reordered rows");
ok("tick made before the republish is still on the same action (rows were reordered)");
assert.strictEqual(await page.isChecked('.row:has-text("Confirm synthetic qty") .check'), true, "old index-ID tick follows its action by content");
assert.strictEqual(await page.isChecked('.row:has-text("Book synthetic trial") .check'), false, "an unrelated new action must not inherit an old tick");
ok("tick saved by v2.11 under email-action-002 follows its action by content, not by row");
assert.ok((await page.textContent("#syncStamp")).includes("14 Nov"));
ok("tracker shows the new snapshot date");

console.log("Publisher safety");
await adminPage();
await page.setInputFiles("#file", "/tmp/npi-smoke-2.xlsx"); await page.waitForTimeout(200);
await Promise.all([page.waitForEvent("download"), page.click("#backup")]);
await page.evaluate(() => { const s = window.__FS.state; s.docs["emailSnapshotMeta/current"].version = "someone-else"; window.__FS.save(); });
await page.click("#publish"); await page.waitForFunction(() => /NOT changed/.test(document.getElementById("pubMsg").textContent), null, { timeout: 15000 });
st = await store(); assert.strictEqual(st.docs["emailSnapshotMeta/current"].version, "someone-else");
assert.ok(Object.entries(st.docs).some(([k, d]) => /^emailSnapshots\/[^/]+$/.test(k) && d.status === "failed"));
ok("concurrent publish detected: pointer untouched, staged version marked failed");
await page.evaluate(v => { const s = window.__FS.state; s.docs["emailSnapshotMeta/current"].version = v; window.__FS.save(); }, v1);
await adminPage();
await page.setInputFiles("#file", "/tmp/npi-smoke-2.xlsx"); await page.waitForTimeout(200);
await Promise.all([page.waitForEvent("download"), page.click("#backup")]);
await page.evaluate(() => { window.__FS.state.deny = ["^emailSnapshots/[^/]+/evidence/[^_]"]; window.__FS.save(); });
await page.click("#publish"); await page.waitForFunction(() => /NOT changed/.test(document.getElementById("pubMsg").textContent), null, { timeout: 15000 });
st = await store(); assert.strictEqual(st.docs["emailSnapshotMeta/current"].version, v1);
ok("write failure part-way: live snapshot unchanged");
await page.evaluate(() => { window.__FS.state.deny = []; window.__FS.save(); });
await adminPage();
await page.setInputFiles("#file", "/tmp/npi-smoke-2.xlsx"); await page.waitForTimeout(200);
await Promise.all([page.waitForEvent("download"), page.click("#backup")]);
await page.click("#publish"); await page.waitForFunction(() => /Published version/.test(document.getElementById("pubMsg").textContent), null, { timeout: 15000 });
st = await store(); const v2 = st.docs["emailSnapshotMeta/current"].version; assert.notStrictEqual(v2, v1);
await page.waitForSelector(`[data-live="${v1}"]`); await page.click(`[data-live="${v1}"]`); await page.waitForTimeout(800);
st = await store(); assert.strictEqual(st.docs["emailSnapshotMeta/current"].version, v1);
assert.ok(Object.values(st.docs).some(d => d.action === "snapshot_rolled_back"));
assert.strictEqual(st.docs["emailSnapshots/" + v2].status, "superseded");
ok("rollback makes the earlier version live again in one step, with an audit entry");
await adminPage();
await page.setInputFiles("#file", { name: "bad.xlsx", mimeType: "application/octet-stream", buffer: (() => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Customer: "X" }]), "Latest Projects"); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Action: "a", Project: "b" }]), "Latest Actions"); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ "Email Date": "1 Nov 2026", "Email Subject": "s", Project: "p" }]), "Email Evidence"); return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }); })() });
await page.waitForTimeout(300);
assert.ok((await page.textContent("#report")).includes("missing column"));
assert.strictEqual(await page.isDisabled("#backup"), true);
ok("workbook with a missing column is blocked before anything is written");

console.log("Read-only account");
await page.evaluate(() => sessionStorage.clear());
await signIn("viewer@example.test");
await page.goto(BASE + "/index.html#actions"); await page.waitForTimeout(300);
assert.ok((await page.textContent("#banner")).includes("read-only"));
assert.strictEqual(await page.isDisabled('#actForm button'), true);
assert.strictEqual(await page.locator(".check:not([disabled])").count(), 0);
ok("viewer sees data but every write control is disabled");

const shot = process.env.SMOKE_SHOTS;
if (shot) { await page.goto(BASE + "/index.html#email-intel"); await page.waitForTimeout(300); await page.screenshot({ path: shot + "/email-intel.png", fullPage: true }); }
assert.deepStrictEqual(errors, [], "page errors: " + errors.join(" | "));
ok("no JavaScript errors on any page");
await browser.close(); server.close();
console.log(`All ${n} smoke checks passed.`);
