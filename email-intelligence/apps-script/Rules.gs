/**
 * Exzone NPI Tracker — rule-based email intelligence engine (M2.2.1).
 * Pure JavaScript; compatible with Apps Script V8 and Node.js.
 * No network, mailbox access, or database writes occur in this module.
 */
(function (root) {
  "use strict";

  var PROJECTS = [
    { code: "EGC", id: "ri-egc-pcba", aliases: ["eradico gate connect", "gate connect", "egc"] }
  ];
  var CATEGORY_RULES = [
    { category: "Purchasing", terms: ["place po", "purchase order", "po placement", "component trigger", "trigger components", "purchase components"] },
    { category: "Engineering", terms: ["software", "firmware", "plp", "debug", "test setup", "troubleshoot", "waiting for device", "barcode"] },
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
  var ACTION_PATTERNS = [
    /\bplease\s+(?:arrange|confirm|provide|review|send|share|check|complete|submit|advise|trigger|proceed)\b/i,
    /\b(?:place|raise|issue)\s+(?:the\s+)?po\b/i,
    /\b(?:follow\s+up|action\s+required|to\s+be\s+completed|need\s+to|must\s+complete|please\s+proceed)\b/i,
    /\b(?:owner|assigned\s+to)\s*[:=-]\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/i,
    /\b(?:target|due|committed)\s+date\s*[:=-]?\s*(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]20\d{2})/i
  ];

  function clean(value) {
    return String(value == null ? "" : value).replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
  }
  function normalize(value) { return clean(value).toLowerCase().replace(/[\u2010-\u2015]/g, "-"); }
  function containsAny(text, terms) { return terms.some(function (term) { return text.indexOf(term) !== -1; }); }

  function identifyProject(subject, body, explicitProjectId) {
    if (explicitProjectId) {
      var explicit = PROJECTS.find(function (p) { return p.id === explicitProjectId; });
      if (explicit) return { projectId: explicit.id, projectCode: explicit.code, matchedBy: "explicit-id", confidence: 1 };
    }
    var text = normalize(subject + " " + body), matches = [];
    PROJECTS.forEach(function (p) {
      if (p.aliases.some(function (alias) {
        return alias === "egc" ? /(^|[^a-z0-9])egc([^a-z0-9]|$)/i.test(text) : text.indexOf(alias) !== -1;
      })) matches.push(p);
    });
    if (matches.length !== 1) return { projectId: null, projectCode: null, matchedBy: "unmatched", confidence: 0 };
    return { projectId: matches[0].id, projectCode: matches[0].code, matchedBy: "keyword", confidence: 0.95 };
  }

  function classifySender(senderEmail, config) {
    var email = normalize(senderEmail), domain = email.split("@")[1] || "";
    if (!email || email.indexOf("@") < 1 || !domain) return "Unknown";
    var cfg = config || {};
    var internal = (cfg.internalDomains || ["exzone.com.my"]).map(normalize);
    var customers = (cfg.customerDomains || []).map(normalize);
    var suppliers = (cfg.supplierDomains || []).map(normalize);
    if (internal.indexOf(domain) >= 0) return "Internal";
    if (customers.indexOf(domain) >= 0) return "Customer";
    if (suppliers.indexOf(domain) >= 0) return "Supplier";
    return "External";
  }

  function classifyCategory(text) {
    var t = normalize(text);
    for (var i = 0; i < CATEGORY_RULES.length; i++) {
      if (containsAny(t, CATEGORY_RULES[i].terms)) return CATEGORY_RULES[i].category;
    }
    return "General";
  }

  function removeNegatedRiskPhrases(text) {
    // Remove only local, explicit negations; this is deliberately conservative.
    return text
      .replace(/\b(?:no|without|not|never|isn\x27t|is not|hasn\x27t|has not)\s+(?:(?:any|material|component|parts?)\s+)*(?:delay|delays|delayed|shortage|shortages|block|blocked|slippage|concern|risk)\b/gi, " ")
      .replace(/\bdelay\s+(?:has been\s+)?(?:avoided|resolved|cleared)\b/gi, " ")
      .replace(/\b(?:can|will)\s+proceed\s+without\s+delay\b/gi, " ");
  }
  function detectRisk(text) {
    var t = normalize(text), riskText = removeNegatedRiskPhrases(t);
    for (var i = 0; i < RISK_TERMS.length; i++) {
      if (containsAny(riskText, RISK_TERMS[i].terms)) {
        return { hasRisk: true, severity: RISK_TERMS[i].severity, evidenceStatus: "Rule-derived" };
      }
    }
    return { hasRisk: false, severity: "None", evidenceStatus: "Not detected" };
  }

  function detectAction(text) {
    var t = clean(text);
    return ACTION_PATTERNS.some(function (pattern) { return pattern.test(t); });
  }

  function validDate(y, m, d) {
    var date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }
  function extractDates(text) {
    var t = clean(text), found = [], seen = {};
    function add(y, m, d) {
      y = Number(y); m = Number(m); d = Number(d);
      if (y < 2000 || y > 2099 || !validDate(y, m, d)) return;
      var iso = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      if (!seen[iso]) { seen[iso] = true; found.push(iso); }
    }
    var re = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b|\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/gi, m;
    while ((m = re.exec(t)) !== null) {
      if (m[1]) add(m[1], m[2], m[3]);
      else add(m[6], m[5], m[4]); // Malaysian numeric format: DD/MM/YYYY
    }
    var months = { jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, sept:9, september:9, oct:10, october:10, nov:11, november:11, dec:12, december:12 };
    var named = /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(20\d{2})\b/gi;
    while ((m = named.exec(t)) !== null) add(m[3], months[m[2].toLowerCase().replace(".", "")], m[1]);
    return found;
  }

  function extractOwner(text) {
    var source = clean(text);
    var labelled = source.match(/\b(?:owner|assigned\s+to)\s*[:=-]\s*([A-Za-z][A-Za-z'-]{1,30}(?:\s+[A-Za-z][A-Za-z'-]{1,30}){0,2})/i);
    if (labelled) {
      var candidate = labelled[1].trim().replace(/[.,;:]+$/, "");
      return { ownerCandidate: candidate, evidenceStatus: "Rule-derived" };
    }
    var assigned = source.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+to\s+(?:please\s+)?(?:arrange|confirm|provide|complete|follow\s+up)\b/);
    if (assigned) return { ownerCandidate: assigned[1], evidenceStatus: "Rule-derived" };
    return { ownerCandidate: null, evidenceStatus: "Not identified" };
  }


  function extractQuantities(text) {
    var source = clean(text), found = [], seen = {};
    var re = /\b(\d+(?:,\d{3})*(?:\.\d+)?)(k)?\s*(pcs?|pieces?|units?|devices?|sets?)\b/gi, m;
    while ((m = re.exec(source)) !== null) {
      var raw = m[1].replace(/,/g, ""), amount = Number(raw);
      if (m[2]) amount *= 1000;
      var unit = m[3].toLowerCase();
      if (/^pc|^piece/.test(unit)) unit = "pcs";
      else if (/^device/.test(unit)) unit = "devices";
      else if (/^set/.test(unit)) unit = "sets";
      else unit = "units";
      var key = amount + "|" + unit;
      if (!seen[key]) { seen[key] = true; found.push({ quantity: amount, unit: unit, sourceText: m[0] }); }
    }
    return found;
  }

  function extractRelativeDatePhrases(text) {
    var source = clean(text), patterns = [
      /\b(?:first|second|third|fourth|last)\s+week\s+of\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/gi,
      /\b(?:early|mid|late)\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:20\d{2})?\b/gi,
      /\b(?:next|this)\s+(?:week|month|quarter|Monday|Tuesday|Wednesday|Thursday|Friday)\b/gi,
      /\b(?:over|within)\s+an?\s+estimated\s+\d+\s*[-–]\s*\d+\s+months?(?:\s+period)?\b/gi
    ], found = [];
    patterns.forEach(function (re) {
      var m;
      while ((m = re.exec(source)) !== null) {
        var value = m[0].trim();
        if (found.indexOf(value) < 0) found.push(value);
      }
    });
    // Keep the longest phrase when a shorter match is contained in a fuller phrase.
    return found.filter(function (value) {
      return !found.some(function (other) {
        return other.length > value.length && other.toLowerCase().indexOf(value.toLowerCase()) === 0;
      });
    });
  }

  function detectTechnicalIssue(text) {
    var t = normalize(text);
    var terms = ["issue", "error", "failed", "failure", "stuck at", "waiting for device", "not responding", "cannot connect", "cannot scan", "refused to", "problem"];
    var matches = terms.filter(function (term) { return t.indexOf(term) >= 0; });
    return { detected: matches.length > 0, terms: matches, evidenceStatus: matches.length ? "Rule-derived" : "Not detected" };
  }

  function extractDeliverables(text) {
    var source = clean(text), terms = [
      "process flow diagram", "control plan", "process fmea", "pfmea",
      "process capability baseline", "cpk", "gage r&r", "standard operating procedures",
      "sop", "certificates of analysis", "material test reports", "calibration records",
      "test video", "video"
    ];
    return terms.filter(function (term) { return normalize(source).indexOf(term) >= 0; });
  }

  function extractActionCandidates(text) {
    var source = clean(text), sentences = source.split(/(?<=[.!?])\s+/), candidates = [];
    var actionRe = /\b(?:please\s+(?:arrange|confirm|provide|review|send|share|check|complete|submit|proceed|trigger)|will\s+(?:repeat|record|share|provide|complete|revise|arrange)|to\s+(?:place|prepare|complete|confirm|share|ship)|must\s+(?:complete|provide)|required\s+to)\b/i;
    sentences.forEach(function (sentence) {
      if (actionRe.test(sentence) && candidates.indexOf(sentence) < 0) candidates.push(sentence.slice(0, 300));
    });
    return candidates;
  }

  function extractInsights(email) {
    var subject = clean(email.subject), body = clean(email.body), combined = subject + ". " + body;
    var project = identifyProject(subject, body, email.projectId);
    var category = classifyCategory(combined), risk = detectRisk(combined);
    var action = detectAction(combined), dates = extractDates(combined), owner = extractOwner(combined);
    var quantities = extractQuantities(combined), relativeDates = extractRelativeDatePhrases(combined);
    var technicalIssue = detectTechnicalIssue(combined), deliverables = extractDeliverables(combined);
    var actionCandidates = extractActionCandidates(combined);
    var insights = [];
    if (/(received|completed|finished|approved|released|submitted|ready)/i.test(combined)) {
      insights.push({ insightType: "Progress", category: category, description: combined.slice(0, 500), evidenceStatus: "Rule-derived" });
    }
    if (risk.hasRisk) {
      insights.push({ insightType: "Risk", category: category, description: combined.slice(0, 500), severity: risk.severity, evidenceStatus: "Rule-derived" });
    }
    if (action) {
      insights.push({ insightType: "Action", category: category, description: combined.slice(0, 500),
        dueDateCandidates: dates, ownerCandidate: owner.ownerCandidate, evidenceStatus: "Rule-derived" });
    }
    if (!insights.length && project.projectId) {
      insights.push({ insightType: "Communication", category: category, description: combined.slice(0, 500), evidenceStatus: "Rule-derived" });
    }
    return {
      project: project,
      senderType: classifySender(email.senderEmail, {
        internalDomains: email.internalDomains,
        customerDomains: email.customerDomains,
        supplierDomains: email.supplierDomains
      }),
      category: category, risk: risk, actionDetected: action, owner: owner,
      dateCandidates: dates, relativeDateCandidates: relativeDates, quantityCandidates: quantities,
      technicalIssue: technicalIssue, deliverableCandidates: deliverables, actionCandidates: actionCandidates,
      commitmentCandidate: action && dates.length > 0 ? {
        committedDateCandidates: dates, ownerCandidate: owner.ownerCandidate,
        status: "Unconfirmed", evidenceStatus: "Rule-derived"
      } : null,
      insights: insights,
      isNpiRelated: project.projectId !== null || /npi|tooling|mould|mold|fai|dfm|trial|injection/i.test(normalize(combined)),
      processingStatus: project.projectId ? "ReadyForValidation" : "Unmatched"
    };
  }

  var api = { identifyProject: identifyProject, classifySender: classifySender,
    classifyCategory: classifyCategory, detectRisk: detectRisk, detectAction: detectAction,
    extractDates: extractDates, extractOwner: extractOwner, extractQuantities: extractQuantities,
    extractRelativeDatePhrases: extractRelativeDatePhrases, detectTechnicalIssue: detectTechnicalIssue,
    extractDeliverables: extractDeliverables, extractActionCandidates: extractActionCandidates, extractInsights: extractInsights };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NPIEmailRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
