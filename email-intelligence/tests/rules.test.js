"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const rules = require("../rules.js");
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/egc-samples.json"), "utf8"));
let passed = 0;
const failures = [];
function check(label, actual, expected) {
  try { assert.deepEqual(actual, expected, label); passed++; }
  catch (e) { failures.push(e.message); }
}
fixtures.forEach(test => {
  const result = rules.extractInsights(test.email);
  check(test.caseId + " project", result.project.projectId, test.expectedProjectId);
  check(test.caseId + " category", result.category, test.expectedCategory);
  check(test.caseId + " risk", result.risk.severity, test.expectedRisk);
  check(test.caseId + " action", result.actionDetected, test.expectedAction);
});
check("internal sender", rules.classifySender("rashid@exzone.com.my"), "Internal");
check("customer sender", rules.classifySender("buyer@customer.example", {customerDomains:["customer.example"]}), "Customer");
check("supplier sender", rules.classifySender("sales@supplier.example", {supplierDomains:["supplier.example"]}), "Supplier");
check("unknown sender", rules.classifySender(""), "Unknown");
check("ISO dates", rules.extractDates("Target 2026-11-05; revised 2026-11-08."), ["2026-11-05","2026-11-08"]);
check("slash dates", rules.extractDates("Due 05/11/2026 and 2026/11/08."), ["2026-11-05","2026-11-08"]);
check("named date", rules.extractDates("Please complete by 5 Nov 2026."), ["2026-11-05"]);
check("invalid date ignored", rules.extractDates("Due 31/02/2026."), []);
check("project code", rules.identifyProject("EGC update", "").projectId, "ri-egc-pcba");
check("negated delay", rules.detectRisk("There is no delay to the pilot run.").severity, "None");
check("negated shortage", rules.detectRisk("No material shortage has been reported.").severity, "None");
check("positive delay", rules.detectRisk("Bare PCB delivery is delayed.").severity, "High");
check("action phrase", rules.detectAction("Please confirm the revised delivery date."), true);
check("ordinary by phrase not action", rules.detectAction("The report was prepared by the engineering team."), false);
check("owner candidate", rules.extractOwner("Owner: Fadzmi").ownerCandidate, "Fadzmi");
const commitment = rules.extractInsights({subject:"EGC action",body:"Owner: Fadzmi. Please confirm delivery by 05/11/2026.",senderEmail:"rashid@exzone.com.my"});
check("commitment candidate date", commitment.commitmentCandidate.committedDateCandidates, ["2026-11-05"]);
check("commitment remains unconfirmed", commitment.commitmentCandidate.status, "Unconfirmed");
check("unmatched remains unmatched", rules.extractInsights({subject:"Delivery status",body:"Please confirm delivery.",senderEmail:"supplier@example.com"}).processingStatus, "Unmatched");
console.log("Assertions passed: " + passed);
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log("All M2.1 rule-engine tests passed.");
