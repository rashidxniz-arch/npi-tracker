// Firestore security rules tests — run against the local emulator only (never production):
//   npm install && npx firebase emulators:exec --only firestore --project demo-npi "node tests/firestore.rules.test.mjs"
// Uses a demo-* project ID, so nothing can reach the real Firebase project. All data is synthetic.
import { readFileSync } from "node:fs";
import assert from "node:assert";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, collection, runTransaction } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-npi",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 }
});

const USERS = {
  admin1: { active: true, role: "admin", teamKey: "rashid" },
  eng1: { active: true, role: "engineer", teamKey: "fadzmi" },
  mem1: { active: true, role: "member", teamKey: "zul" },
  view1: { active: true, role: "viewer", teamKey: "wajdi" },
  off1: { active: false, role: "member", teamKey: "fakrul" },
  nokey: { active: true, role: "member" }
};
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  for (const [uid, data] of Object.entries(USERS)) await setDoc(doc(db, "users", uid), data);
  await setDoc(doc(db, "tasks", "t-zul"), { source: "google-sheets", owner: "zul", text: "x", createdBy: "zul", createdByUid: "mem1" });
  await setDoc(doc(db, "tasks", "t-other"), { source: "google-sheets", owner: "yusri", text: "y", createdBy: "yusri", createdByUid: "someone" });
  // Left untouched by every other test (t-other is reassigned to zul by the reassignment test).
  await setDoc(doc(db, "tasks", "t-keep"), { source: "google-sheets", owner: "yusri", text: "z", createdBy: "yusri", createdByUid: "someone" });
  await setDoc(doc(db, "emailSnapshots", "v-pub"), { status: "published", asOf: "2026-11-01" });
});
const as = uid => env.authenticatedContext(uid).firestore();
const task = (uid, extra) => ({ source: "google-sheets", owner: "zul", text: "Send DFM", createdBy: USERS[uid].teamKey || "zul", createdByUid: uid, ...extra });
let passed = 0;
async function it(name, fn) { await fn(); passed++; console.log("  ✓ " + name); }

console.log("Identity binding");
await it("member creates a task as themselves", () => assertSucceeds(setDoc(doc(as("mem1"), "tasks", "a1"), task("mem1"))));
await it("member cannot create a task as someone else", () => assertFails(setDoc(doc(as("mem1"), "tasks", "a2"), task("mem1", { createdBy: "fadzmi" }))));
await it("ticks must be signed with your own key", async () => {
  await assertSucceeds(setDoc(doc(as("mem1"), "status", "ea-1"), { id: "ea-1", done: true, by: "zul", actorUid: "mem1" }));
  await assertFails(setDoc(doc(as("mem1"), "status", "ea-2"), { id: "ea-2", done: true, by: "rashid", actorUid: "mem1" }));
});
await it("updates are posted as yourself only", async () => {
  await assertSucceeds(setDoc(doc(as("eng1"), "updates", "u1"), { owner: "fadzmi", text: "ok", createdByUid: "eng1" }));
  await assertFails(setDoc(doc(as("eng1"), "updates", "u2"), { owner: "zul", text: "spoof", createdByUid: "eng1" }));
});
await it("account without teamKey cannot write", () => assertFails(setDoc(doc(as("nokey"), "status", "ea-3"), { id: "ea-3", done: true, by: "zul", actorUid: "nokey" })));
await it("reassigning a task is signed as yourself", async () => {
  await assertSucceeds(updateDoc(doc(as("mem1"), "tasks", "t-other"), { owner: "zul", updatedAt: "2026-11-16", updatedBy: "zul", updatedByUid: "mem1" }));
  await assertFails(updateDoc(doc(as("mem1"), "tasks", "t-other"), { owner: "fadzmi", updatedAt: "2026-11-16", updatedBy: "rashid", updatedByUid: "mem1" }));
  await assertFails(updateDoc(doc(as("mem1"), "tasks", "t-other"), { text: "rewritten", updatedBy: "zul", updatedByUid: "mem1" }));
});
await it("task write and audit entry in one batch (as the app does)", async () => {
  const db = as("mem1"), b = writeBatch(db);
  b.set(doc(db, "tasks", "a3"), task("mem1"));
  b.set(doc(collection(db, "auditLogs")), { actorUid: "mem1", actor: "zul", action: "task_created", entityId: "a3" });
  await assertSucceeds(b.commit());
});
await it("audit actor must be yourself", async () => {
  await assertSucceeds(setDoc(doc(as("mem1"), "auditLogs", "l1"), { actorUid: "mem1", actor: "zul", action: "task_created" }));
  await assertFails(setDoc(doc(as("mem1"), "auditLogs", "l2"), { actorUid: "mem1", actor: "rashid", action: "task_created" }));
});
await it("hours must be a number between 0 and 200", async () => {
  await assertSucceeds(setDoc(doc(as("mem1"), "workload", "w1"), { id: "w1", hours: 4, by: "zul", actorUid: "mem1" }));
  await assertFails(setDoc(doc(as("mem1"), "workload", "w2"), { id: "w2", hours: 999, by: "zul", actorUid: "mem1" }));
});

console.log("Roles");
await it("viewer can read but not write", async () => {
  await assertSucceeds(getDoc(doc(as("view1"), "tasks", "t-zul")));
  await assertFails(setDoc(doc(as("view1"), "auditLogs", "lv"), { actorUid: "view1", actor: "wajdi", action: "x" }));
  await assertFails(setDoc(doc(as("view1"), "tasks", "v1"), task("view1")));
  await assertFails(setDoc(doc(as("view1"), "status", "ea-4"), { id: "ea-4", done: true, by: "wajdi", actorUid: "view1" }));
});
await it("inactive account cannot read", () => assertFails(getDoc(doc(as("off1"), "tasks", "t-zul"))));
await it("task removal: creator/owner yes, others no", async () => {
  await assertFails(deleteDoc(doc(as("mem1"), "tasks", "t-keep")));
  await assertSucceeds(deleteDoc(doc(as("mem1"), "tasks", "t-zul")));
});
await it("users cannot change their own role", () => assertFails(updateDoc(doc(as("mem1"), "users", "mem1"), { role: "admin" })));

console.log("Versioned snapshots");
await it("admin stages a version and adds records", async () => {
  const db = as("admin1");
  await assertSucceeds(setDoc(doc(db, "emailSnapshots", "v1"), { status: "staging", asOf: "2026-11-15" }));
  const b = writeBatch(db);
  b.set(doc(collection(db, "emailSnapshots", "v1", "projects"), "ep-1"), { "Project / Programme": "Synthetic A" });
  b.set(doc(collection(db, "emailSnapshots", "v1", "actions"), "ea-1"), { Action: "Synthetic action" });
  await assertSucceeds(b.commit());
});
await it("records cannot be added to a published version", () =>
  assertFails(setDoc(doc(as("admin1"), "emailSnapshots", "v-pub", "projects", "ep-x"), { "Project / Programme": "late" })));
await it("records cannot be edited or deleted", async () => {
  await assertFails(updateDoc(doc(as("admin1"), "emailSnapshots", "v1", "projects", "ep-1"), { "Project / Programme": "changed" }));
  await assertFails(deleteDoc(doc(as("admin1"), "emailSnapshots", "v1", "projects", "ep-1")));
});
await it("records of an unknown kind are refused; evidence is allowed", async () => {
  await assertFails(setDoc(doc(as("admin1"), "emailSnapshots", "v1", "secrets", "s1"), { a: 1 }));
  await assertSucceeds(setDoc(doc(as("admin1"), "emailSnapshots", "v1", "evidence", "ev-1"), { "Email Subject": "Synthetic" }));
});
await it("a full 400-record batch is accepted (rules get() limits)", async () => {
  const db = as("admin1");
  await assertSucceeds(setDoc(doc(db, "emailSnapshots", "vbig"), { status: "staging" }));
  const b = writeBatch(db);
  for (let i = 0; i < 400; i++) b.set(doc(db, "emailSnapshots", "vbig", "actions", "ea-" + i), { Action: "Synthetic " + i });
  await assertSucceeds(b.commit());
});
await it("a failed version can never be published", async () => {
  const db = as("admin1");
  await assertSucceeds(setDoc(doc(db, "emailSnapshots", "vfail"), { status: "staging" }));
  await assertSucceeds(updateDoc(doc(db, "emailSnapshots", "vfail"), { status: "failed", error: "synthetic" }));
  await assertFails(updateDoc(doc(db, "emailSnapshots", "vfail"), { status: "published" }));
});
await it("version status can move to published; other fields are locked", async () => {
  await assertSucceeds(updateDoc(doc(as("admin1"), "emailSnapshots", "v1"), { status: "published", publishedBy: "admin" }));
  await assertFails(updateDoc(doc(as("admin1"), "emailSnapshots", "v1"), { asOf: "2020-01-01" }));
  await assertFails(deleteDoc(doc(as("admin1"), "emailSnapshots", "v1")));
});
await it("non-admins cannot stage, publish or move the pointer", async () => {
  await assertFails(setDoc(doc(as("eng1"), "emailSnapshots", "v2"), { status: "staging" }));
  await assertFails(setDoc(doc(as("eng1"), "emailSnapshotMeta", "current"), { version: "v1" }));
  await assertSucceeds(getDoc(doc(as("mem1"), "emailSnapshots", "v1", "projects", "ep-1")));
});
await it("publish transaction: pointer + new version published + old superseded + audit", async () => {
  const db = as("admin1");
  await assertSucceeds(runTransaction(db, async tx => {
    await tx.get(doc(db, "emailSnapshotMeta", "current"));
    tx.set(doc(db, "emailSnapshotMeta", "current"), { version: "vbig", asOf: "2026-11-16", previousVersion: "v-pub" });
    tx.update(doc(db, "emailSnapshots", "vbig"), { status: "published", publishedAt: "2026-11-16", publishedBy: "admin" });
    tx.update(doc(db, "emailSnapshots", "v-pub"), { status: "superseded" });
    tx.set(doc(collection(db, "auditLogs")), { actorUid: "admin1", actor: "rashid", action: "snapshot_published", entityId: "vbig" });
  }));
});
await it("pointer can be set by admin but never deleted", async () => {
  await assertSucceeds(setDoc(doc(as("admin1"), "emailSnapshotMeta", "current"), { version: "v1", asOf: "2026-11-15" }));
  await assertFails(deleteDoc(doc(as("admin1"), "emailSnapshotMeta", "current")));
});

await env.cleanup();
assert.ok(passed > 0);
console.log(`All ${passed} rules checks passed.`);
