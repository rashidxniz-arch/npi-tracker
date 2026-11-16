// Firestore security rules tests — run against the local emulator only (never production):
//   npm install && npx firebase emulators:exec --only firestore --project demo-npi "node tests/firestore.rules.test.mjs"
// Uses a demo-* project ID, so nothing can reach the real Firebase project. All data is synthetic.
import { readFileSync } from "node:fs";
import assert from "node:assert";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, collection } from "firebase/firestore";

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
  await assertFails(setDoc(doc(as("view1"), "tasks", "v1"), task("view1")));
  await assertFails(setDoc(doc(as("view1"), "status", "ea-4"), { id: "ea-4", done: true, by: "wajdi", actorUid: "view1" }));
});
await it("inactive account cannot read", () => assertFails(getDoc(doc(as("off1"), "tasks", "t-zul"))));
await it("task removal: creator/owner yes, others no", async () => {
  await assertFails(deleteDoc(doc(as("mem1"), "tasks", "t-other")));
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
await it("only an unknown kind is refused", () => assertFails(setDoc(doc(as("admin1"), "emailSnapshots", "v1", "secrets", "s1"), { a: 1 })));
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
await it("pointer can be set by admin but never deleted", async () => {
  await assertSucceeds(setDoc(doc(as("admin1"), "emailSnapshotMeta", "current"), { version: "v1", asOf: "2026-11-15" }));
  await assertFails(deleteDoc(doc(as("admin1"), "emailSnapshotMeta", "current")));
});

await env.cleanup();
assert.ok(passed > 0);
console.log(`All ${passed} rules checks passed.`);
