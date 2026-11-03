/**
 * Exzone NPI Tracker — M2.3 isolated Apps Script backend.
 *
 * TEST MODE ONLY:
 * - No Outlook / Microsoft Graph connection.
 * - Writes only to *Test collections.
 * - Does not update projects, tasks, updates, or emailSnapshot collections.
 * - No full email body or full sender address is stored.
 *
 * Required Script Properties:
 *   FIRESTORE_PROJECT_ID = exzone-npi-tracker
 *   ENABLE_TEST_WRITES = false (set true only when ready to test writes)
 *   NPI_EMAIL_TEST_TOKEN = long random value (required only for deployed doPost)
 */

var M23_CONFIG = {
  databaseId: "(default)",
  emailCollection: "emailIntelligenceTest",
  insightCollection: "emailInsightsTest",
  logCollection: "emailProcessingLogsTest",
  timezone: "Asia/Kuala_Lumpur",
  maxSubjectLength: 180
};

function testRulesOnly() {
  var sample = m23SampleEmail_();
  var result = NPIEmailRules.extractInsights(sample);
  Logger.log(JSON.stringify({
    project: result.project,
    senderType: result.senderType,
    category: result.category,
    risk: result.risk,
    actionDetected: result.actionDetected,
    quantityCandidates: result.quantityCandidates,
    relativeDateCandidates: result.relativeDateCandidates,
    technicalIssue: result.technicalIssue,
    deliverableCandidates: result.deliverableCandidates,
    actionCandidates: result.actionCandidates
  }, null, 2));
  return result;
}

function testFirestoreConnection() {
  var projectId = m23Property_("FIRESTORE_PROJECT_ID");
  var url = m23FirestoreBase_(projectId) + "/" + M23_CONFIG.logCollection + "?pageSize=1";
  var response = m23Fetch_(url, "get");
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error("Firestore connection failed (" + status + "): " + response.getContentText());
  }
  Logger.log("Firestore test-collection access OK. No data written.");
  return { ok: true, collection: M23_CONFIG.logCollection, writePerformed: false };
}

function testM23Sample() {
  if (m23Property_("ENABLE_TEST_WRITES") !== "true") {
    throw new Error("Test writes are disabled. Set Script Property ENABLE_TEST_WRITES=true only after reviewing the README.");
  }
  var result = m23ProcessEmail_(m23SampleEmail_());
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Optional test endpoint. Do not deploy until you have configured a strong token.
 * Request JSON: { "token":"...", "email": { "messageId":"...", "subject":"...", "body":"...", "senderEmail":"...", "receivedAt":"..." } }
 */
function doPost(e) {
  try {
    var body = JSON.parse(e && e.postData && e.postData.contents || "{}");
    var expected = m23Property_("NPI_EMAIL_TEST_TOKEN");
    if (!expected || !body.token || !m23ConstantTimeEqual_(String(body.token), expected)) {
      return m23Json_({ ok: false, error: "unauthorized" });
    }
    if (m23Property_("ENABLE_TEST_WRITES") !== "true") {
      return m23Json_({ ok: false, error: "test_writes_disabled" });
    }
    return m23Json_(m23ProcessEmail_(body.email || {}));
  } catch (err) {
    return m23Json_({ ok: false, error: "processing_error", message: String(err.message || err) });
  }
}

function m23ProcessEmail_(email) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var messageHash = "";
  try {
    m23RequireTestWrites_();
    if (!email || !email.messageId) throw new Error("messageId is required for duplicate protection.");
    if (!email.subject && !email.body) throw new Error("Email subject or body is required.");

    messageHash = m23Sha256_(String(email.messageId));
    var existing = m23GetDocument_(M23_CONFIG.emailCollection, messageHash);
    if (existing) {
      m23WriteLog_(messageHash, "DuplicateSkipped", "Existing source message hash found.");
      return { ok: true, status: "duplicate_skipped", messageHash: messageHash };
    }

    var extracted = NPIEmailRules.extractInsights({
      subject: email.subject || "",
      body: email.body || "",
      senderEmail: email.senderEmail || "",
      projectId: email.projectId || null,
      internalDomains: email.internalDomains || ["exzone.com.my"],
      customerDomains: email.customerDomains || [],
      supplierDomains: email.supplierDomains || []
    });

    var emailDoc = {
      sourceMessageHash: messageHash,
      subject: String(email.subject || "").slice(0, M23_CONFIG.maxSubjectLength),
      senderDomain: m23SenderDomain_(email.senderEmail || ""),
      receivedAt: String(email.receivedAt || ""),
      projectId: extracted.project.projectId || "",
      projectCode: extracted.project.projectCode || "",
      matchedBy: extracted.project.matchedBy,
      senderType: extracted.senderType,
      category: extracted.category,
      riskSeverity: extracted.risk.severity,
      hasRisk: extracted.risk.hasRisk,
      actionDetected: extracted.actionDetected,
      processingStatus: extracted.processingStatus,
      quantityCandidates: extracted.quantityCandidates,
      dateCandidates: extracted.dateCandidates,
      relativeDateCandidates: extracted.relativeDateCandidates,
      technicalIssueDetected: extracted.technicalIssue.detected,
      deliverableCandidates: extracted.deliverableCandidates,
      processedAt: m23Now_(),
      engineVersion: "M2.2.1"
    };

    m23CreateDocument_(M23_CONFIG.emailCollection, messageHash, emailDoc);

    var insightCount = 0;
    extracted.insights.forEach(function (insight, index) {
      var insightId = messageHash + "_i" + String(index + 1).padStart(2, "0");
      m23CreateDocument_(M23_CONFIG.insightCollection, insightId, {
        sourceMessageHash: messageHash,
        projectId: extracted.project.projectId || "",
        insightType: insight.insightType,
        category: insight.category,
        severity: insight.severity || "None",
        evidenceStatus: insight.evidenceStatus || "Rule-derived",
        ownerCandidate: extracted.owner.ownerCandidate || "",
        dueDateCandidates: extracted.dateCandidates,
        status: "Candidate",
        createdAt: m23Now_()
      });
      insightCount++;
    });

    m23WriteLog_(messageHash, "Processed", "Email classified; " + insightCount + " insight candidate(s) stored.");
    return {
      ok: true,
      status: "processed_test_only",
      messageHash: messageHash,
      projectId: extracted.project.projectId,
      processingStatus: extracted.processingStatus,
      insightCount: insightCount
    };
  } catch (err) {
    if (messageHash) {
      try { m23WriteLog_(messageHash, "Error", String(err.message || err)); } catch (ignored) {}
    }
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function m23SampleEmail_() {
  return {
    messageId: "M23-SYNTHETIC-EGC-001",
    subject: "EGC Initial Component Trigger - Approval",
    senderEmail: "buyer@rentokil.example",
    receivedAt: "2026-11-03T09:00:00+08:00",
    customerDomains: ["rentokil.example"],
    body: "EGC. Please trigger components as required based on lead times to support an initial quantity of 7k devices. These 7k devices will likely be ordered over an estimated 3-4 month period."
  };
}

function m23RequireTestWrites_() {
  if (m23Property_("ENABLE_TEST_WRITES") !== "true") {
    throw new Error("Test writes are disabled.");
  }
}

function m23Property_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || "";
}

function m23FirestoreBase_(projectId) {
  return "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(projectId) + "/databases/" +
    encodeURIComponent(M23_CONFIG.databaseId) + "/documents";
}

function m23GetDocument_(collection, documentId) {
  var url = m23FirestoreBase_(m23Property_("FIRESTORE_PROJECT_ID")) + "/" +
    encodeURIComponent(collection) + "/" + encodeURIComponent(documentId);
  var response = m23Fetch_(url, "get");
  var status = response.getResponseCode();
  if (status === 404) return null;
  if (status < 200 || status >= 300) {
    throw new Error("Firestore read failed (" + status + "): " + response.getContentText());
  }
  return JSON.parse(response.getContentText());
}

function m23CreateDocument_(collection, documentId, data) {
  var url = m23FirestoreBase_(m23Property_("FIRESTORE_PROJECT_ID")) + "/" +
    encodeURIComponent(collection) + "?documentId=" + encodeURIComponent(documentId);
  var payload = { fields: m23ToFirestoreFields_(data) };
  var response = m23Fetch_(url, "post", payload);
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error("Firestore create failed (" + status + "): " + response.getContentText());
  }
  return JSON.parse(response.getContentText());
}

function m23WriteLog_(messageHash, status, detail) {
  var id = messageHash + "_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12);
  m23CreateDocument_(M23_CONFIG.logCollection, id, {
    sourceMessageHash: messageHash,
    status: status,
    detail: String(detail || "").slice(0, 300),
    processedAt: m23Now_(),
    engineVersion: "M2.2.1"
  });
}

function m23Fetch_(url, method, payload) {
  var options = {
    method: method,
    muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }
  };
  if (payload) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }
  return UrlFetchApp.fetch(url, options);
}

function m23ToFirestoreFields_(obj) {
  var fields = {};
  Object.keys(obj).forEach(function (key) {
    fields[key] = m23FirestoreValue_(obj[key]);
  });
  return fields;
}

function m23FirestoreValue_(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ?
    { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(m23FirestoreValue_) } };
  if (typeof value === "object") return { mapValue: { fields: m23ToFirestoreFields_(value) } };
  return { stringValue: String(value) };
}

function m23SenderDomain_(email) {
  var value = String(email || "").trim().toLowerCase();
  var at = value.lastIndexOf("@");
  return at >= 0 ? value.slice(at + 1) : "";
}

function m23Sha256_(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b + 256) % 256;
    return ("0" + v.toString(16)).slice(-2);
  }).join("");
}

function m23ConstantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var result = 0;
  for (var i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function m23Now_() {
  return Utilities.formatDate(new Date(), M23_CONFIG.timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function m23Json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
