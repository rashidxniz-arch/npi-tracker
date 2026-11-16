/* Unit tests for lib/snapshot.js — run with: node tests/snapshot.test.js (no dependencies). All data below is synthetic. */
"use strict";
const assert = require("assert");
const S = require("../lib/snapshot.js");
let n = 0;
const t = (name, fn) => { fn(); n++; };

const TEAM = { rashid: { name: "Rashid", short: "Rashid" }, fadzmi: { name: "Ahmad Fadzmi", short: "Fadzmi" }, zul: { name: "Zul Azri", short: "Zul" } };
const P = [
  { "Project / Programme": "Alpha Housing", Customer: "Cust A", "Latest Status": "Pending review", "Mentioned Owner / Contact": "Fadzmi", "Latest Email Date": "30 Oct 2026", Workstream: "Tooling" },
  { "Project / Programme": "Beta Lens", Customer: "Cust B", "Latest Status": "At risk - delay", "Mentioned Owner / Contact": "supplier contact", "Latest Email Date": "2026-10-28" }
];
const A = [
  { Action: "Send DFM reply", Project: "Alpha Housing", "Mentioned Owner / Team": "Zul / NPI", "Latest State": "Open", "Due / Target": "6 Nov 2026" },
  { Action: "Confirm sample qty", Project: "Beta", "Latest State": "Completed" }
];
const E = [{ "Email Date": "31 Oct 2026", "Email Subject": "Re: Alpha", "Evidence Extract": "DFM v2 attached", Project: "Alpha Housing" }];

t("dates: common formats", () => {
  assert.strictEqual(S.parseDate("30 Oct 2026"), "2026-10-30");
  assert.strictEqual(S.parseDate("30-Oct-26"), "2026-10-30");
  assert.strictEqual(S.parseDate("2026-11-02T08:00:00Z"), "2026-11-02");
  assert.strictEqual(S.parseDate("02/11/2026"), "2026-11-02", "day-first");
  assert.strictEqual(S.parseDate(46325), "2026-10-30", "Excel serial");
  assert.strictEqual(S.parseDate({ seconds: new Date(2026, 9, 30, 12).getTime() / 1000 }), "2026-10-30", "Timestamp-like");
  assert.strictEqual(S.parseDate("31 Feb 2026"), "", "invalid day");
  assert.strictEqual(S.parseDate("next week"), "");
  assert.strictEqual(S.parseDate(""), "");
  assert.strictEqual(S.parseDate("5 Jan 2027"), "2027-01-05", "not limited to 2026");
});

t("dates: review regressions (run with TZ=Asia/Kuala_Lumpur)", () => {
  // SheetJS cellDates can give local midnight minus seconds — must stay on the intended day.
  const sheetJsLike = new Date(new Date(2025, 9, 31).getTime() - 25000);
  assert.strictEqual(S.parseDate(sheetJsLike), "2025-10-31");
  assert.strictEqual(S.text(new Date(2025, 9, 31)), "2025-10-31", "text() uses the local calendar date");
  assert.strictEqual(S.parseDate(45961.6), "2025-10-31", "afternoon serial stays on its day");
  assert.strictEqual(S.parseDate("send 2 decks"), "", "not a month");
  assert.strictEqual(S.parseDate("3 marks"), "");
  assert.strictEqual(S.parseDate("ETA 3 pcs by 15 Nov 2026"), "2026-11-15", "keeps looking after a non-date");
  assert.strictEqual(S.parseDate("5 Jan", 2026), "2026-01-05");
  const dec = new Date(2026, 11, 20); const realNow = Date; // nearest-year: "5 Jan" read in December is next January
  global.Date = class extends realNow { constructor(...a) { if (!a.length) return new realNow(dec); return new realNow(...a); } static UTC(...a) { return realNow.UTC(...a); } };
  try { assert.strictEqual(S.parseDate("5 Jan"), "2027-01-05"); } finally { global.Date = realNow; }
});

t("stable IDs do not depend on row order", () => {
  const a = S.mapSnapshot({ projects: P, actions: A }, TEAM);
  const b = S.mapSnapshot({ projects: P.slice().reverse(), actions: A.slice().reverse() }, TEAM);
  const idOf = (list, name) => list.find(x => x.name === name || x.text === name).id;
  assert.strictEqual(idOf(a.projects, "Alpha Housing"), idOf(b.projects, "Alpha Housing"));
  assert.strictEqual(idOf(a.actions, "Send DFM reply"), idOf(b.actions, "Send DFM reply"));
  assert.notStrictEqual(a.actions[0].id, a.actions[1].id);
  assert.ok(/^ep-/.test(a.projects[0].id) && /^ea-/.test(a.actions[0].id));
});

t("legacy IDs: row position only for the legacy flat layout, otherwise carried by content", () => {
  const flat = S.mapSnapshot({ projects: P, actions: A }, TEAM, { legacyIndex: true });
  assert.strictEqual(flat.actions[0].legacyId, "email-action-001");
  assert.strictEqual(flat.projects[1].legacyId, "email-project-002");
  const versioned = S.mapSnapshot({ projects: P, actions: A }, TEAM);
  assert.strictEqual(versioned.actions[0].legacyId, "", "no positional guess for versioned data");
  // Publisher: the next workbook has the rows in a different order plus a new action.
  const map = S.legacyIdMap({ projects: P, actions: A }, null);
  const next = S.buildDocs({ projects: P.slice().reverse(), actions: [{ Action: "New one", Project: "Beta Lens" }, A[1], A[0]], evidence: E }, map);
  const byText = t => next.actions.find(d => d.data.Action === t).data.legacyId;
  assert.strictEqual(byText("Send DFM reply"), "email-action-001", "follows the content, not the row");
  assert.strictEqual(byText("Confirm sample qty"), "email-action-002");
  assert.strictEqual(byText("New one"), undefined, "new rows get no legacy ID");
  // And the following publish carries it forward from the live version.
  const carried = S.legacyIdMap(null, { projects: next.projects, actions: next.actions });
  assert.strictEqual(carried[next.actions.find(d => d.data.Action === "Send DFM reply").id], "email-action-001");
  const mapped = S.mapSnapshot({ projects: next.projects.map(d => d.data), actions: next.actions.map(d => d.data) }, TEAM);
  assert.strictEqual(mapped.actions.find(a => a.text === "Send DFM reply").legacyId, "email-action-001");
});

t("duplicate keys get suffixes, not collisions", () => {
  const ids = S.assignIds([A[0], A[0], A[1]], "ea", S.actionKey);
  assert.strictEqual(new Set(ids).size, 3);
  assert.ok(ids[1].endsWith("-2"));
});

t("owner: matches team names only, never defaults to Rashid", () => {
  assert.deepStrictEqual(S.ownerOf("Fadzmi / QA", TEAM), { key: "fadzmi", inferred: true });
  assert.deepStrictEqual(S.ownerOf("supplier contact", TEAM), { key: "", inferred: false });
  assert.deepStrictEqual(S.ownerOf("Zulkarnain (supplier)", TEAM), { key: "", inferred: false }, "no substring match inside another name");
  assert.deepStrictEqual(S.ownerOf("", TEAM), { key: "", inferred: false });
});

t("latest email date is not used as a due date", () => {
  const m = S.mapSnapshot({ projects: P, actions: A }, TEAM);
  assert.strictEqual(m.projects[0].due, "");
  assert.strictEqual(m.projects[0].lastEmail, "2026-10-30");
  assert.strictEqual(m.actions[0].due, "2026-11-06", "action due comes from Due / Target");
});

t("health and done detection", () => {
  const m = S.mapSnapshot({ projects: P, actions: A }, TEAM);
  assert.strictEqual(m.projects[1].health, "bad");
  assert.strictEqual(m.projects[0].health, "warn");
  assert.strictEqual(m.actions[1].done, true);
  assert.strictEqual(m.actions[0].done, false);
  ["Not completed yet", "Partially shipped", "Pending closure", "To be submitted", "Reopened"].forEach(st => assert.strictEqual(S.isDone(st), false, st));
  ["Done", "Completed", "Closed - accepted", "Shipped 3 Nov"].forEach(st => assert.strictEqual(S.isDone(st), true, st));
});

t("project linking: exact first, ambiguous → none", () => {
  assert.strictEqual(S.linkProject("Alpha Housing", P), P[0]);
  assert.strictEqual(S.linkProject("beta lens", P), P[1]);
  assert.strictEqual(S.linkProject("", P), null);
  assert.strictEqual(S.linkProject("lens", P), P[1], "4+ letters can link loosely");
  assert.strictEqual(S.linkProject("bet", P), null, "too short to link loosely");
  const twins = [{ "Project / Programme": "Gamma One" }, { "Project / Programme": "Gamma Two" }];
  assert.strictEqual(S.linkProject("gamma", twins), null);
});

t("validation catches missing columns and empty names", () => {
  const ok = S.validate({ projects: P, actions: A, evidence: E });
  assert.strictEqual(ok.ok, true, ok.errors.join("\n"));
  assert.strictEqual(ok.asOf, "2026-10-31");
  assert.ok(ok.warnings.some(w => /source message ID/.test(w)), "traceability warning");
  const bad = S.validate({ projects: [{ Customer: "X" }], actions: [{ Action: "" , Project: "x"}], evidence: [] });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.some(e => /missing column "Project \/ Programme"/.test(e)));
  assert.ok(bad.errors.some(e => /Email Evidence: no rows/.test(e)));
});

t("buildDocs: stable IDs stored with the data, dates normalised", () => {
  const d = S.buildDocs({ projects: [{ ...P[0], "Latest Email Date": new Date(2026, 9, 30) }], actions: A, evidence: E });
  assert.strictEqual(d.projects[0].data["Latest Email Date"], "2026-10-30");
  assert.strictEqual(d.projects[0].data.stableId, d.projects[0].id);
  const m = S.mapSnapshot({ projects: d.projects.map(x => x.data), actions: d.actions.map(x => x.data) }, TEAM);
  assert.strictEqual(m.projects[0].id, d.projects[0].id, "app and publisher agree on IDs");
});

console.log("Assertions groups passed: " + n);
console.log("All snapshot tests passed.");
