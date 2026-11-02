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
check("negated component shortage", rules.detectRisk("There is no component shortage.").severity, "None");
check("positive delay", rules.detectRisk("Bare PCB delivery is delayed.").severity, "High");
check("action phrase", rules.detectAction("Please confirm the revised delivery date."), true);
check("ordinary by phrase not action", rules.detectAction("The report was prepared by the engineering team."), false);
check("owner candidate", rules.extractOwner("Owner: Fadzmi").ownerCandidate, "Fadzmi");
check("owner candidate with punctuation", rules.extractOwner("Owner: Fadzmi. Please confirm.").ownerCandidate, "Fadzmi");
const commitment = rules.extractInsights({subject:"EGC action",body:"Owner: Fadzmi. Please confirm delivery by 05/11/2026.",senderEmail:"rashid@exzone.com.my"});
check("commitment candidate date", commitment.commitmentCandidate.committedDateCandidates, ["2026-11-05"]);
check("commitment remains unconfirmed", commitment.commitmentCandidate.status, "Unconfirmed");
check("unmatched remains unmatched", rules.extractInsights({subject:"Delivery status",body:"Please confirm delivery.",senderEmail:"supplier@example.com"}).processingStatus, "Unmatched");

const approvalEmail = {
  subject: "EGC Initial Component Trigger - Approval",
  senderEmail: "customer@rentokil.example",
  customerDomains: ["rentokil.example"],
  body: "Please trigger components as required based on lead times to support an initial quantity of 7k devices. These 7k devices will likely be ordered over an estimated 3-4 month period. Once you have an estimate of when components will be in stock and ready for production I will share a supply plan."
};
const approval = rules.extractInsights(approvalEmail);
check("M2.2 approval project", approval.project.projectId, "ri-egc-pcba");
check("M2.2 purchasing category", approval.category, "Purchasing");
check("M2.2 PO trigger detected as action", approval.actionDetected, true);
check("M2.2 quantity 7k", approval.quantityCandidates[0], {quantity:7000,unit:"devices",sourceText:"7k devices"});
check("M2.2 estimated period retained", approval.relativeDateCandidates, ["over an estimated 3-4 month period"]);
check("M2.2 customer sender configured", approval.senderType, "Customer");
check("M2.2 action sentence extracted", approval.actionCandidates.some(x => /trigger components/i.test(x)), true);

const technicalEmail = {
  subject: "EGC PCBA move to Exzone - technical follow-up",
  senderEmail: "engineer@exzone.com.my",
  body: "We completed assembly and testing of 6 pcs. We encountered an issue scanning the barcode using the PLP software. The PCBA is stuck at waiting for device and refused to enter waiting for barcode. I will repeat the test and record a video to demonstrate the setup and results. MVB SMT is planned for 4 January 2027, followed by assembly on 8 January 2027. Customer requested Process Flow Diagram, Control Plan, Process FMEA, Cpk baseline, Gage R&R reports, Standard Operating Procedures, Certificates of Analysis, Material Test Reports and calibration records."
};
const technical = rules.extractInsights(technicalEmail);
check("M2.2 engineering category", technical.category, "Engineering");
check("M2.2 technical issue detected", technical.technicalIssue.detected, true);
check("M2.2 6 pcs quantity", technical.quantityCandidates.some(q => q.quantity === 6 && q.unit === "pcs"), true);
check("M2.2 dates extracted", technical.dateCandidates, ["2027-01-04","2027-01-08"]);
check("M2.2 deliverables extracted", technical.deliverableCandidates.includes("process fmea"), true);
check("M2.2 action evidence extracted", technical.actionCandidates.some(x => /repeat the test/i.test(x)), true);

console.log("Assertions passed: " + passed);
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log("All M2.1 rule-engine tests passed.");
