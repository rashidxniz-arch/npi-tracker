/**
 * Exzone NPI Tracker — rule-based email intelligence engine.
 * Pure JavaScript; compatible with Apps Script V8 and Node.js.
 * No network, database writes, or mailbox access occur in this module.
 */
(function (root) {
  "use strict";

  var PROJECTS = [
    { code: "EGC", id: "ri-egc-pcba", aliases: ["eradico gate connect", "gate connect", "egc"] }
  ];

  var CATEGORY_RULES = [
    { category: "Material", terms: ["bare pcb", "pcb", "component", "material", "resin", "shortage", "smt"] },
    { category: "Tooling", terms: ["tooling", "mould", "mold", "tool repair", "cavity", "tool modification"] },
    { category: "Quality", terms: ["defect", "ncr", "nonconformance", "failure", "reject", "corrective action"] },
    { category: "Production", terms: ["production", "capacity", "output", "assembly", "pilot run", "build"] },
    { category: "Customer", terms: ["customer approval", "customer feedback", "requirement", "po received", "purchase order", "eco"] },
    { category: "Supplier", terms: ["supplier", "delivery", "shipment", "lead time", "quotation", "dispatch"] },
    { category: "Regulatory", terms: ["certification", "sirim", "bis", "isi marking", "cb certificate", "compliance"] }
  ];

  var RISK_TERMS = [
    { severity: "Critical", terms: ["line stopped", "production stopped", "shipment blocked", "customer escalation"] },
    { severity: "High", terms: ["delayed", "delay", "shortage", "missed delivery", "not received", "blocked", "cannot proceed"] },
    { severity: "Medium", terms: ["pending", "awaiting", "at risk", "concern", "slippage"] }
  ];

  var ACTION_TERMS = ["please arrange", "please confirm", "please provide", "follow up", "to be completed",
    "need to", "must", "action required", "target date", "by "];

  function clean(value) {
    return String(value == null ? "" : value).replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ").trim();
  }

  function normalize(value) {
    return clean(value).toLowerCase().replace(/[\u2010-\u2015]/g, "-");
  }

  function containsAny(text, terms) {
    return terms.some(function (term) { return text.indexOf(term) !== -1; });
  }

  function identifyProject(subject, body, explicitProjectId) {
    if (explicitProjectId) {
      var explicit = PROJECTS.find(function (p) { return p.id === explicitProjectId; });
      if (explicit) return { projectId: explicit.id, projectCode: explicit.code, matchedBy: "explicit-id", confidence: 1 };
    }
    var text = normalize(subject + " " + body);
    var matches = [];
    PROJECTS.forEach(function (p) {
      var hit = p.aliases.some(function (alias) {
        if (alias === "egc") return /(^|[^a-z0-9])egc([^a-z0-9]|$)/i.test(text);
        return text.indexOf(alias) !== -1;
      });
      if (hit) matches.push(p);
    });
    if (matches.length !== 1) return { projectId: null, projectCode: null, matchedBy: "unmatched", confidence: 0 };
    return { projectId: matches[0].id, projectCode: matches[0].code, matchedBy: "keyword", confidence: 0.95 };
  }

  function classifySender(senderEmail, internalDomains) {
    var email = normalize(senderEmail);
    var domains = internalDomains || ["exzone.com.my"];
    var domain = email.split("@")[1] || "";
    if (!email || email.indexOf("@") < 0) return "Unknown";
    if (domains.indexOf(domain) >= 0) return "Internal";
    return "External";
  }

  function classifyCategory(text) {
    var t = normalize(text);
    for (var i = 0; i < CATEGORY_RULES.length; i++) {
      if (containsAny(t, CATEGORY_RULES[i].terms)) return CATEGORY_RULES[i].category;
    }
    return "General";
  }

  function detectRisk(text) {
    var t = normalize(text);
    for (var i = 0; i < RISK_TERMS.length; i++) {
      if (containsAny(t, RISK_TERMS[i].terms)) {
        return { hasRisk: true, severity: RISK_TERMS[i].severity, evidenceStatus: "Rule-derived" };
      }
    }
    return { hasRisk: false, severity: "None", evidenceStatus: "Not detected" };
  }

  function detectAction(text) {
    var t = normalize(text);
    return containsAny(t, ACTION_TERMS);
  }

  function extractDates(text) {
    var t = clean(text);
    var iso = [];
    var re = /\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/g;
    var m;
    while ((m = re.exec(t)) !== null) iso.push(m[0]);
    var unique = [];
    iso.forEach(function (d) { if (unique.indexOf(d) < 0) unique.push(d); });
    return unique;
  }

  function extractInsights(email) {
    var subject = clean(email.subject);
    var body = clean(email.body);
    var combined = subject + ". " + body;
    var project = identifyProject(subject, body, email.projectId);
    var category = classifyCategory(combined);
    var risk = detectRisk(combined);
    var action = detectAction(combined);
    var dates = extractDates(combined);
    var insights = [];

    if (/(received|completed|finished|approved|released|submitted|ready)/i.test(combined)) {
      insights.push({
        insightType: "Progress", category: category,
        description: combined.slice(0, 500), evidenceStatus: "Rule-derived"
      });
    }
    if (risk.hasRisk) {
      insights.push({
        insightType: "Risk", category: category,
        description: combined.slice(0, 500), severity: risk.severity,
        evidenceStatus: "Rule-derived"
      });
    }
    if (action) {
      insights.push({
        insightType: "Action", category: category,
        description: combined.slice(0, 500),
        dueDateCandidates: dates, evidenceStatus: "Rule-derived"
      });
    }
    if (!insights.length && project.projectId) {
      insights.push({
        insightType: "Communication", category: category,
        description: combined.slice(0, 500), evidenceStatus: "Rule-derived"
      });
    }

    return {
      project: project,
      senderType: classifySender(email.senderEmail, email.internalDomains),
      category: category,
      risk: risk,
      actionDetected: action,
      dateCandidates: dates,
      insights: insights,
      isNpiRelated: project.projectId !== null || /npi|tooling|mould|mold|fai|dfm|trial|injection/i.test(normalize(combined)),
      processingStatus: project.projectId ? "ReadyForValidation" : "Unmatched"
    };
  }

  var api = {
    identifyProject: identifyProject,
    classifySender: classifySender,
    classifyCategory: classifyCategory,
    detectRisk: detectRisk,
    detectAction: detectAction,
    extractDates: extractDates,
    extractInsights: extractInsights
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NPIEmailRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
