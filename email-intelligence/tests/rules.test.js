"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const rules = require("../rules.js");
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/egc-samples.json"), "utf8"));

let passed = 0;
const failures = [];
fixtures.forEach(test => {
  const result = rules.extractInsights(test.email);
  const checks = [
    ["project", result.project.projectId, test.expectedProjectId],
    ["category", result.category, test.expectedCategory],
    ["risk", result.risk.severity, test.expectedRisk],
    ["action", result.actionDetected, test.expectedAction]
  ];
  checks.forEach(([name, actual, expected]) => {
    try { assert.equal(actual, expected, test.caseId + " " + name); passed++; }
    catch (e) { failures.push(e.message); }
  });
});

assert.equal(rules.classifySender("rashid@exzone.com.my"), "Internal");
assert.equal(rules.classifySender("supplier@example.com"), "External");
assert.deepEqual(rules.extractDates("Target 2026-11-05; revised 2026-11-08."), ["2026-11-05","2026-11-08"]);
assert.equal(rules.identifyProject("EGC update", "").projectId, "ri-egc-pcba");

console.log("Assertions passed: " + (passed + 4));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("All EGC rule-engine tests passed.");
}
