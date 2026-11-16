/**
 * Exzone NPI Tracker — email snapshot helpers.
 * Pure functions shared by the app (index.html), the publisher (latest.html) and Node tests.
 * No network access and no Firestore writes happen in this file.
 */
(function (root) {
  "use strict";

  var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  // Column names used by the prepared snapshot workbook (sheet → required columns).
  var SHEETS = {
    projects: { sheet: "Latest Projects", required: ["Project / Programme", "Customer", "Latest Status"] },
    actions: { sheet: "Latest Actions", required: ["Action", "Project"] },
    evidence: { sheet: "Email Evidence", required: ["Email Date", "Email Subject", "Project"] }
  };
  var LIMITS = { maxRows: 2000, maxCell: 4000 };

  /* ---------- text and identity ---------- */
  function text(v) {
    if (v == null) return "";
    if (v instanceof Date) return isNaN(v) ? "" : v.toISOString().slice(0, 10);
    if (typeof v === "object" && typeof v.toDate === "function") return text(v.toDate());
    if (typeof v === "object" && typeof v.seconds === "number") return text(new Date(v.seconds * 1000));
    return String(v).trim();
  }
  function norm(v) {
    return text(v).toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();
  }
  // cyrb53: fast, deterministic 53-bit string hash (not cryptographic; used only for stable record IDs).
  function hash(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, i, ch;
    for (i = 0; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function projectKey(row) { return norm(row.Customer) + "|" + norm(row["Project / Programme"]); }
  function actionKey(row) { return norm(row.Project) + "|" + norm(row.Action); }
  function evidenceKey(row) { return parseDate(row["Email Date"]) + "|" + norm(row["Email Subject"]) + "|" + norm(row["Evidence Extract"]) + "|" + norm(row.Project); }

  // Assigns a stable ID per row. Rows with identical keys get -2, -3 … in workbook order.
  function assignIds(rows, prefix, keyFn) {
    var seen = {};
    return rows.map(function (row) {
      var base = prefix + "-" + hash(keyFn(row));
      seen[base] = (seen[base] || 0) + 1;
      return seen[base] === 1 ? base : base + "-" + seen[base];
    });
  }

  /* ---------- dates ---------- */
  function iso(y, m, d) {
    if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return "";
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return "";
    return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  /** Returns YYYY-MM-DD or "" — accepts Date, Firestore Timestamp, Excel serial, ISO, "30 Oct 2026", "30-Oct-26", "30/10/2026" (day first). */
  function parseDate(v, fallbackYear) {
    if (v == null || v === "") return "";
    if (v instanceof Date) return isNaN(v) ? "" : iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === "object" && typeof v.toDate === "function") return parseDate(v.toDate());
    if (typeof v === "object" && typeof v.seconds === "number") return parseDate(new Date(v.seconds * 1000));
    if (typeof v === "number") {
      if (v > 20000 && v < 80000) { var x = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return iso(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); }
      return "";
    }
    var s = String(v).trim(), m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/(\d{1,2})[\s\-\/.]+([A-Za-z]{3,9})\.?(?:[\s\-\/.,]+(\d{2,4}))?/))) {
      var mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
      if (mi >= 0) {
        var y = m[3] ? +m[3] : (fallbackYear || new Date().getFullYear());
        if (y < 100) y += 2000;
        return iso(y, mi + 1, +m[1]);
      }
    }
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/))) {
      var yy = +m[3]; if (yy < 100) yy += 2000;
      return iso(yy, +m[2], +m[1]); // Malaysian convention: day first
    }
    return "";
  }

  /* ---------- rule-derived classification (labelled as inferred in the UI) ---------- */
  function stageOf(row) {
    var v = norm(row.Workstream) + " " + norm(row["Latest Status"]);
    if (/release|production|certif|submission/.test(v)) return 5;
    if (/build|pilot|shipment|sample|po received/.test(v)) return 4;
    if (/trial|\bfai\b|measurement|\bdoe\b|validation|\bis ?ir\b/.test(v)) return 3;
    if (/tool|jig|mold|mould/.test(v)) return 2;
    if (/\bdfm\b|design|gerber|artwork|\beco\b|regulatory/.test(v)) return 1;
    return 0;
  }
  function healthOf(status) {
    var v = norm(status);
    if (/risk|delay|paused|gated|urgent|challenged|not feasible|blocked|escalat/.test(v)) return "bad";
    if (/watch|pending|review|waiting|planned|open|not confirmed|quotation/.test(v)) return "warn";
    return "ok";
  }
  /** Action state → done. Negated or partial states ("not completed", "partially shipped", "pending closure") stay open. */
  function isDone(state) {
    var v = norm(state);
    if (!/\b(done|complete|completed|closed|accepted|shipped|submitted|finished|resolved)\b/.test(v)) return false;
    return !/\b(not|no|un|yet to|pending|partial|partially|partly|awaiting|to be|re-?opened?)\b/.test(v);
  }
  /** Finds a team member mentioned in free text. Returns {key, inferred} — key "" when nobody matches (never guesses). */
  function ownerOf(raw, team) {
    var v = norm(raw);
    if (!v) return { key: "", inferred: false };
    var keys = Object.keys(team || {});
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], t = team[k] || {};
      var names = [k, t.short, t.name].concat(t.aliases || []).map(norm).filter(function (n) { return n && n.length >= 3; });
      for (var j = 0; j < names.length; j++) {
        var re = new RegExp("(^|[^a-z])" + names[j].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z]|$)");
        if (re.test(v)) return { key: k, inferred: true };
      }
    }
    return { key: "", inferred: false };
  }

  /* ---------- workbook validation (publisher) ---------- */
  function validate(data) {
    var errors = [], warnings = [];
    Object.keys(SHEETS).forEach(function (kind) {
      var spec = SHEETS[kind], rows = data[kind] || [];
      if (!rows.length) { (kind === "evidence" ? errors : warnings).push(spec.sheet + ": no rows."); return; }
      if (rows.length > LIMITS.maxRows) errors.push(spec.sheet + ": " + rows.length + " rows exceeds the " + LIMITS.maxRows + "-row limit.");
      var cols = Object.keys(rows[0] || {});
      spec.required.forEach(function (c) { if (cols.indexOf(c) < 0) errors.push(spec.sheet + ": missing column \"" + c + "\"."); });
      rows.forEach(function (r, i) {
        Object.keys(r).forEach(function (c) {
          if (text(r[c]).length > LIMITS.maxCell) errors.push(spec.sheet + " row " + (i + 2) + ": \"" + c + "\" is longer than " + LIMITS.maxCell + " characters.");
          if (/^__.*__$/.test(c) || c.length > 1500) errors.push(spec.sheet + ": invalid column name \"" + c + "\".");
        });
      });
    });
    var projects = data.projects || [], actions = data.actions || [], evidence = data.evidence || [];
    projects.forEach(function (r, i) { if (!text(r["Project / Programme"])) errors.push("Latest Projects row " + (i + 2) + ": project name is empty."); });
    actions.forEach(function (r, i) { if (!text(r.Action)) errors.push("Latest Actions row " + (i + 2) + ": action text is empty."); });
    var dupP = duplicates(projects, projectKey), dupA = duplicates(actions, actionKey);
    if (dupP.length) warnings.push(dupP.length + " duplicate project row(s) (same customer + project). They are kept with -2, -3 suffixes: " + dupP.slice(0, 3).join("; "));
    if (dupA.length) warnings.push(dupA.length + " duplicate action row(s) (same project + action text): " + dupA.slice(0, 3).join("; "));
    var orphanA = actions.filter(function (a) { return !linkProject(a.Project, projects); }).length;
    var orphanE = evidence.filter(function (e) { return !linkProject(e.Project, projects); }).length;
    if (orphanA) warnings.push(orphanA + " action(s) do not match any project name exactly or by prefix.");
    if (orphanE) warnings.push(orphanE + " evidence row(s) do not match any project name.");
    var badDates = evidence.filter(function (e) { return !parseDate(e["Email Date"]); }).length;
    if (badDates) warnings.push(badDates + " evidence row(s) have an unreadable Email Date.");
    var srcCol = evidence.length && ["Source Message ID", "Message ID", "Internet Message ID", "Source Message Hash"].filter(function (c) { return c in evidence[0]; })[0];
    if (evidence.length && !srcCol) warnings.push("Email Evidence has no source message ID column, so evidence cannot be traced back to an exact Outlook message. Add a \"Source Message ID\" column (a hash is fine).");
    var dates = evidence.map(function (e) { return parseDate(e["Email Date"]); }).filter(Boolean).sort();
    return { ok: errors.length === 0, errors: errors, warnings: warnings, asOf: dates.length ? dates[dates.length - 1] : "",
      counts: { projects: projects.length, actions: actions.length, evidence: evidence.length } };
  }
  function duplicates(rows, keyFn) {
    var seen = {}, out = [];
    rows.forEach(function (r) { var k = keyFn(r); if (seen[k]) out.push(k.replace("|", " / ")); seen[k] = true; });
    return out;
  }
  /** Links a free-text project reference to a project row: exact name first, then unique prefix/containment. Ambiguous → null. */
  function linkProject(raw, projects) {
    var v = norm(raw);
    if (!v) return null;
    var exact = projects.filter(function (p) { return norm(p["Project / Programme"]) === v; });
    if (exact.length === 1) return exact[0];
    var loose = projects.filter(function (p) {
      var n = norm(p["Project / Programme"]);
      var head = n.split(/\s[-–\/]\s|\s\/\s|\//)[0].trim();
      return n && (n.indexOf(v) >= 0 || v.indexOf(n) >= 0 || (head.length >= 4 && v.indexOf(head) >= 0));
    });
    return loose.length === 1 ? loose[0] : null;
  }

  /** Builds the Firestore documents for a snapshot version: {projects:[{id,data}], actions:[…], evidence:[…]} with stable IDs. */
  function buildDocs(data) {
    var out = {};
    [["projects", "ep", projectKey], ["actions", "ea", actionKey], ["evidence", "ev", evidenceKey]].forEach(function (k) {
      var rows = data[k[0]] || [], ids = assignIds(rows, k[1], k[2]);
      out[k[0]] = rows.map(function (r, i) {
        var clean = {};
        Object.keys(r).forEach(function (c) {
          var v = r[c];
          clean[c] = v instanceof Date ? parseDate(v) : (typeof v === "string" ? v.trim() : v);
        });
        clean.rowNumber = i + 1; clean.stableId = ids[i];
        return { id: ids[i], data: clean };
      });
    });
    return out;
  }

  /**
   * Maps snapshot records into tracker projects/actions.
   * Record IDs are stable across re-publishes (content-derived), so ticks and project updates stay attached.
   * legacyId keeps the old index-based ID (email-action-001…) so ticks saved by v2.9–2.11 still show.
   */
  function mapSnapshot(intel, team) {
    var P = intel.projects || [], A = intel.actions || [];
    var pIds = assignIds(P, "ep", projectKey), aIds = assignIds(A, "ea", actionKey);
    var projects = P.map(function (x, i) {
      var status = text(x["Latest Status"]), health = healthOf(status), own = ownerOf(x["Mentioned Owner / Contact"], team);
      var lastEmail = parseDate(x["Latest Email Date"]);
      return {
        id: x.stableId || pIds[i], legacyId: "email-project-" + String(i + 1).padStart(3, "0"), source: "email-snapshot",
        name: text(x["Project / Programme"]) || "Unnamed project", customer: text(x.Customer),
        owner: own.key, ownerInferred: own.inferred, ownerText: text(x["Mentioned Owner / Contact"]),
        stage: stageOf(x), stageInferred: true, health: health, healthInferred: true,
        healthLabel: health === "bad" ? "At risk" : health === "warn" ? "Watch" : "On track",
        statusText: status, update: text(x["Latest Evidence / Update"]), next: text(x["Next Action"]),
        due: "", lastEmail: lastEmail, updatedAt: lastEmail,
        asap: /urgent|at risk|gated/i.test(status),
        complexity: /critical|paused|\beol\b|firmware/i.test(text(x["Risk / Notes"])) ? "high" : "medium",
        escalation: health === "bad", activities: [text(x.Workstream), text(x["Next Action"])].filter(Boolean),
        riskNotes: text(x["Risk / Notes"]), evidence: text(x["Latest Evidence / Update"])
      };
    });
    var actions = A.map(function (x, i) {
      var p = linkProject(x.Project, P), state = text(x["Latest State"]), own = ownerOf(x["Mentioned Owner / Team"], team);
      var pIndex = p ? P.indexOf(p) : -1;
      return {
        id: x.stableId || aIds[i], legacyId: "email-action-" + String(i + 1).padStart(3, "0"), source: "email-snapshot", src: "claude",
        text: text(x.Action), owner: own.key, ownerInferred: own.inferred, ownerText: text(x["Mentioned Owner / Team"]),
        tag: text(x.Project), project: pIndex >= 0 ? projects[pIndex].id : "",
        urgent: /urgent|critical|at risk|blocked/i.test(state + " " + text(x["Evidence / Notes"])),
        done: isDone(state),
        createdAt: "", emailState: state, dueText: text(x["Due / Target"]), due: parseDate(x["Due / Target"]),
        evidence: text(x["Evidence / Notes"])
      };
    });
    return { projects: projects, actions: actions };
  }

  var api = {
    SHEETS: SHEETS, LIMITS: LIMITS, text: text, norm: norm, hash: hash, parseDate: parseDate,
    projectKey: projectKey, actionKey: actionKey, evidenceKey: evidenceKey, assignIds: assignIds,
    stageOf: stageOf, healthOf: healthOf, isDone: isDone, ownerOf: ownerOf, linkProject: linkProject,
    validate: validate, buildDocs: buildDocs, mapSnapshot: mapSnapshot
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NPISnapshot = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
