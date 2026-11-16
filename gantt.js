/* Exzone NPI Tracker — Projects Gantt (portfolio timeline), styled after NPI Project Planner's Portfolio view.
 * Loaded after app.js and uses its globals (D, TD, S, allActions, projList, T, esc, fmtDate, todayISO, dt, addDays, STAGES, HL, sameProject, store).
 * The tracker has no planned schedule, so each bar is the project's ACTIVITY WINDOW: first dated evidence → latest due date / meeting.
 * Everything drawn comes from recorded dates; nothing is invented. */
"use strict";
const GANTT = {
  zoom: store.get("npi-gz") || "week",       // day | week | month
  group: store.get("npi-gg") || "customer",  // customer | owner | stage | health | none
  open: new Set(), scrolledOnce: false
};
const GZ = { day: 26, week: 7, month: 2.4 };   // pixels per day
const DAY = 864e5;

const isoOf = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const dayN = iso => Math.round(dt(iso).getTime()/DAY);

/** Distinctive words of a project name, for matching meetings (same rule as the project pop-up). */
function ganttWords(p){
  const STOP = new Set(["project","tool","tools","tooling","sample","samples","parts","part","range","trial","build","label","labels","quote","with","from","after","new","order","spec","rentokil","keysight","agilent","broadcom","almy","exzone","lumnia","assembly","cover","body","update","issue","validation","dimension","measurement"]);
  return String(p.name||"").toLowerCase().split(/[^a-z0-9-]+/).filter(w=>w.length>3 && !STOP.has(w));
}

/** Every dated thing we know about each project → {start, end, events[]} — from recorded dates only. */
function ganttModel(list){
  const t = todayISO(), acts = allActions(), byId = {};
  list.forEach(p => { byId[p.id] = { p, ev: [] }; });
  const add = (pid, date, kind, label, extra) => { if(byId[pid] && date) byId[pid].ev.push({ date, kind, label, ...(extra||{}) }); };
  // Email evidence (snapshot mode): link each evidence row to its project row, which has the same index as D.projects.
  const raw = (D.emailIntel && D.emailIntel.projects) || [];
  ((D.emailIntel && D.emailIntel.evidence) || []).forEach(e => {
    const rp = S.linkProject(e.Project, raw), i = rp ? raw.indexOf(rp) : -1, p = i >= 0 && D.projects[i] && D.projects[i].source === "email-snapshot" ? D.projects[i] : null;
    if(p) add(p.id, S.parseDate(e["Email Date"]), "email", S.text(e["Email Subject"]) || "Email");
  });
  // A meeting is linked only by words that belong to one project, so a word shared by several names links none of them.
  const wc = {}; D.projects.forEach(p => new Set(ganttWords(p)).forEach(w => { wc[w] = (wc[w]||0) + 1; }));
  list.forEach(p => {
    add(p.id, p.lastEmail, "email", "Latest email");
    if(p.due) add(p.id, p.due, "pdue", "Due: " + (p.next || p.name));
    if(!p.lastEmail && p.updatedAt) add(p.id, String(p.updatedAt).slice(0,10), "update", "Last update");
    const words = ganttWords(p).filter(w => wc[w] === 1), hit = s => { s = String(s||"").toLowerCase(); return words.some(w => s.includes(w)); };
    D.meetings.filter(m => m.date && hit(m.title + " " + (m.sub||""))).forEach(m => add(p.id, m.date, "meet", (m.time ? m.time + " · " : "") + m.title));
  });
  acts.forEach(a => { if(a.project && byId[a.project] && a.due) add(a.project, a.due, "due", a.text, { done: !!a.done, late: !a.done && a.due < t }); });
  (TD.updates || []).forEach(u => list.forEach(p => { if(sameProject(u.project, p.id)) add(p.id, String(u.at||"").slice(0,10), "post", (T(u.owner).short||"") + ": " + u.text); }));
  return list.map(p => {
    const ev = byId[p.id].ev.filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).sort((a,b) => a.date.localeCompare(b.date));
    const dates = ev.map(e => e.date);
    const start = dates[0] || "", end = dates.length ? dates[dates.length-1] : "";
    const openActs = acts.filter(a => a.project === p.id && !a.done);
    const nextDue = openActs.map(a => a.due).filter(Boolean).sort()[0] || p.due || "";
    const quiet = p.lastEmail ? Math.floor((dt(t) - dt(p.lastEmail)) / DAY) : null;
    return { p, ev, start, end, openActs, nextDue, quiet,
      progress: Math.max(0, Math.min(1, (Number(p.stage)||0) / (STAGES.length-1))),
      acts: acts.filter(a => a.project === p.id).sort((a,b) => (!!a.done)-(!!b.done) || String(a.due||"9").localeCompare(String(b.due||"9"))) };
  });
}

function ganttGroups(rows){
  const key = { customer: r => r.p.customer || "Internal / other", owner: r => r.p.owner ? T(r.p.owner).name : "Not matched to a team member",
    stage: r => STAGES[r.p.stage] || "RFQ", health: r => HL[r.p.health] || "On track", none: () => "All projects" }[GANTT.group] || (() => "All projects");
  const order = { stage: g => STAGES.indexOf(g), health: g => ["At risk","Watch","On track"].indexOf(g) }[GANTT.group];
  const m = new Map();
  rows.forEach(r => { const k = key(r); if(!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return [...m.entries()].sort((a,b) => order ? order(a[0]) - order(b[0]) : (b[1].length - a[1].length) || a[0].localeCompare(b[0]));
}

function renderGantt(list){
  const el = $("projects"), t = todayISO(), px = GZ[GANTT.zoom] || GZ.week;
  const rows = ganttModel(list), dated = rows.filter(r => r.start);
  // Range: Monday before the earliest date (at most 9 months back) → 3 weeks after the latest date or today.
  const firstIso = dated.length ? dated.map(r => r.start).sort()[0] : addDays(t, -28);
  const lastIso = [t, ...dated.map(r => r.end)].sort().pop();
  let from = dt(firstIso < addDays(t, -270) ? addDays(t, -270) : firstIso); from = new Date(from.getTime() - ((from.getDay()+6)%7) * DAY);
  GANTT.days = 0;
  const fromN = dayN(isoOf(from)), toN = dayN(addDays(lastIso, 21)), days = Math.max(28, toN - fromN + 1); GANTT.days = days; const W = Math.round(days * px);
  const X = iso => Math.round((dayN(iso) - fromN) * px);
  const clampIso = iso => iso < isoOf(from) ? isoOf(from) : iso;

  // Header: months on top, then weeks (or days when zoomed in). Weekends shaded in day/week zoom.
  let months = "", ticks = "", shade = "";
  for(let n = fromN; n <= fromN + days; n++){
    const dd = new Date(from.getFullYear(), from.getMonth(), from.getDate() + (n - fromN)), x = Math.round((n-fromN)*px);
    if(dd.getDate() === 1 || n === fromN) months += `<span class="gt-m" style="left:${x}px">${MON[dd.getMonth()]} ${dd.getFullYear()}</span>`;
    if(GANTT.zoom === "day") ticks += `<span class="gt-d${dd.getDay()%6===0?" we":""}" style="left:${x}px;width:${px}px">${dd.getDate()}</span>`;
    else if(GANTT.zoom === "week" && dd.getDay() === 1) ticks += `<span class="gt-w" style="left:${x}px">${dd.getDate()} ${MON[dd.getMonth()]}</span>`;
    else if(GANTT.zoom === "month" && dd.getDay() === 1 && Math.floor((n-fromN)/7) % 2 === 0) ticks += `<span class="gt-w" style="left:${x}px">${dd.getDate()}/${dd.getMonth()+1}</span>`;
    if(GANTT.zoom !== "month" && dd.getDay() === 6) shade += `<i class="gt-we" style="left:${x}px;width:${Math.round(px*2)}px"></i>`;
  }
  const todayLine = `<i class="gt-today" style="left:${X(t)}px" title="Today"></i>`;
  const grid = `<div class="gt-bg" style="width:${W}px">${shade}${todayLine}</div>`;
  const tip = s => esc(s);

  const mark = (e) => {
    const x = X(clampIso(e.date)), when = fmtDate(e.date) + " " + e.date.slice(0,4);
    if(e.kind === "email") return `<i class="gt-em" style="left:${x}px" data-tip="${tip(`<b>Email · ${esc(when)}</b><br>${esc(e.label)}`)}"></i>`;
    if(e.kind === "post") return `<i class="gt-po" style="left:${x}px" data-tip="${tip(`<b>Team update · ${esc(when)}</b><br>${esc(e.label)}`)}"></i>`;
    if(e.kind === "meet") return `<i class="gt-mt" style="left:${x}px" data-tip="${tip(`<b>Meeting · ${esc(when)}</b><br>${esc(e.label)}`)}"></i>`;
    if(e.kind === "pdue") return `<i class="gt-pd" style="left:${x}px" data-tip="${tip(`<b>Project due · ${esc(when)}</b><br>${esc(e.label)}`)}"></i>`;
    if(e.kind === "due") return `<i class="gt-ms${e.done?" done":e.late?" late":""}" style="left:${x}px" data-tip="${tip(`<b>Action due · ${esc(when)}${e.done?" · done":e.late?" · overdue":""}</b><br>${esc(e.label)}`)}"></i>`;
    return "";
  };
  const bar = r => {
    if(!r.start) return `<span class="gt-none">No dated activity yet</span>`;
    const x1 = X(clampIso(r.start)), x2 = Math.max(x1 + Math.max(px, 6), X(r.end) + px), w = x2 - x1, h = r.p.health || "ok";
    const lbl = `${STAGES[r.p.stage]||"RFQ"}${r.p.owner?" · "+T(r.p.owner).short:""}`;
    return `<span class="gt-bar h-${esc(h)}" style="left:${x1}px;width:${w}px" data-tip="${tip(`<b>${esc(r.p.name)}</b><br>${esc(HL[h]||"")} · ${esc(STAGES[r.p.stage]||"")} (stage ${Number(r.p.stage||0)+1} of ${STAGES.length})<br>Activity ${esc(fmtDate(r.start))} → ${esc(fmtDate(r.end))}${r.quiet!=null?`<br>Last email ${r.quiet} day${r.quiet===1?"":"s"} ago`:""}<br><i>Click for details</i>`)}"><b style="width:${Math.round(r.progress*100)}%"></b></span>`
      + `<span class="gt-lbl" style="left:${x2 + 6}px">${esc(lbl)}</span>` + r.ev.map(mark).join("");
  };
  const short = iso => { const d = dt(iso); return `${d.getDate()} ${MON[d.getMonth()]}`; };
  const due = r => r.nextDue ? `<span class="mono${r.nextDue < t ? " late" : ""}" title="${esc(fmtDate(r.nextDue))}">${short(r.nextDue)}</span>` : `<span class="gt-mute">—</span>`;
  const quiet = r => r.quiet != null && r.quiet > 14 ? ` <span class="tag" title="No email for ${r.quiet} days">quiet ${r.quiet}d</span>` : "";

  let body = "", n = 0;
  ganttGroups(rows).forEach(([name, rs]) => {
    const gs = rs.filter(r => r.start).map(r => r.start).sort()[0], ge = rs.filter(r => r.end).map(r => r.end).sort().pop();
    const risk = rs.filter(r => r.p.health === "bad").length;
    body += `<div class="gt-row gt-grp"><div class="gt-l"><b>${esc(name)}</b><span class="gt-mute"> · ${rs.length} project${rs.length===1?"":"s"}${risk?` · <span class="late">${risk} at risk</span>`:""}</span></div>
      <div class="gt-r" style="width:${W}px">${gs ? `<span class="gt-bracket" style="left:${X(clampIso(gs))}px;width:${Math.max(8, X(ge) + px - X(clampIso(gs)))}px"></span>` : ""}</div></div>`;
    rs.forEach(r => {
      n++;
      const isOpen = GANTT.open.has(r.p.id), nActs = r.acts.length;
      body += `<div class="gt-row" data-pid="${esc(r.p.id)}" data-h="${esc(r.p.health)}" tabindex="0">
        <div class="gt-l"><span class="gt-n">${n}</span>${nActs ? `<button type="button" class="gt-tg" data-gx="${esc(r.p.id)}" aria-expanded="${isOpen}" aria-label="${isOpen?"Hide":"Show"} actions">${isOpen?"▾":"▸"}</button>` : `<span class="gt-tg"></span>`}
          <span class="gt-name"><b>${esc(r.p.name)}</b><small>${esc(r.p.customer||"")}${quiet(r)}</small></span>
          <span class="gt-c gt-own">${r.p.owner ? esc(T(r.p.owner).short) : '<span class="gt-mute">—</span>'}</span>
          <span class="gt-c gt-stg">${esc(STAGES[r.p.stage]||"")}</span>
          <span class="gt-c"><span class="pill ${esc(r.p.health)}">${esc(r.p.healthLabel || HL[r.p.health] || "")}</span></span>
          <span class="gt-c gt-due">${due(r)}</span>
          <span class="gt-c gt-act">${r.openActs.length || '<span class="gt-mute">0</span>'}</span></div>
        <div class="gt-r" style="width:${W}px">${bar(r)}</div></div>`;
      if(isOpen) r.acts.slice(0, 15).forEach(a => {
        body += `<div class="gt-row gt-sub${a.done?" done":""}" data-pid="${esc(r.p.id)}"><div class="gt-l"><span class="gt-n"></span><span class="gt-tg"></span>
          <span class="gt-name"><span>${a.done?"✓ ":""}${esc(a.text)}</span><small>${a.owner?esc(T(a.owner).short):"Unassigned"}${a.dueText?" · due "+esc(a.dueText):" · no due date"}</small></span></div>
          <div class="gt-r" style="width:${W}px">${a.due ? `<i class="gt-ms${a.done?" done":a.due<t?" late":""}" style="left:${X(clampIso(a.due))}px"></i><span class="gt-lbl" style="left:${X(clampIso(a.due)) + 12}px">${esc(fmtDate(a.due))}</span>` : ""}</div></div>`;
      });
    });
  });

  el.innerHTML = `
    <div class="gt-tools">
      <div class="seg" role="group" aria-label="Zoom">${["day","week","month"].map(z => `<button type="button" data-gz="${z}" aria-pressed="${GANTT.zoom===z}">${z[0].toUpperCase()+z.slice(1)}</button>`).join("")}</div>
      <button type="button" class="btn" data-gtoday>Today</button>
      <button type="button" class="btn" data-gfit>Fit</button>
      <button type="button" class="btn" data-gall>${GANTT.open.size ? "Collapse all" : "Expand all"}</button>
      <label class="gt-gb">Group by <select class="field" id="gGroup">${[["customer","Customer"],["owner","Owner"],["stage","Stage"],["health","Status"],["none","None"]].map(([v,l]) => `<option value="${v}" ${GANTT.group===v?"selected":""}>${l}</option>`).join("")}</select></label>
    </div>
    <div class="gt-legend"><span><i class="gt-k bar"></i>Activity window (dark = stage reached)</span><span><i class="gt-k ms"></i>Action due</span><span><i class="gt-k ms late"></i>Overdue</span><span><i class="gt-k mt"></i>Meeting</span><span><i class="gt-k em"></i>Email</span><span><i class="gt-k po"></i>Team update</span><span><i class="gt-k pd"></i>Project due</span><span><i class="gt-k td"></i>Today</span></div>
    <div class="gt" id="gtScroll" style="--gw:${W}px">
      <div class="gt-row gt-head"><div class="gt-l"><span class="gt-n">#</span><span class="gt-tg"></span><span class="gt-name">Project</span><span class="gt-c gt-own">Owner</span><span class="gt-c gt-stg">Stage</span><span class="gt-c">Status</span><span class="gt-c gt-due">Next due</span><span class="gt-c gt-act">Open</span></div>
        <div class="gt-r" style="width:${W}px"><div class="gt-months">${months}</div><div class="gt-ticks">${ticks}</div></div></div>
      <div class="gt-body">${grid}${body}</div>
    </div>
    <p class="gt-note">Bars are not a planned schedule: each runs from the project's first dated email or update to its latest due date or meeting, using only dates recorded in the tracker. For planned dates and baselines use NPI Project Planner.</p>`;
  const sc = $("gtScroll");
  if(GANTT.fit){ sc.scrollLeft = 0; GANTT.fit = false; }
  else if(!GANTT.scrolledOnce || GANTT.jumpToday){ sc.scrollLeft = Math.max(0, X(t) - sc.clientWidth * 0.45); GANTT.scrolledOnce = true; GANTT.jumpToday = false; }
}

/* Gantt toolbar and row toggles (captured before the page-wide click handler, so a toggle doesn't open the project). */
$("projects").addEventListener("click", e => {
  const g = e.target.closest("[data-gx],[data-gz],[data-gtoday],[data-gfit],[data-gall]");
  if(!g) return;
  e.stopPropagation(); e.preventDefault();
  if(g.dataset.gx){ const id = g.dataset.gx; GANTT.open.has(id) ? GANTT.open.delete(id) : GANTT.open.add(id); }
  else if(g.dataset.gz){ GANTT.zoom = g.dataset.gz; store.set("npi-gz", GANTT.zoom); GANTT.jumpToday = true; }
  else if("gtoday" in g.dataset){ GANTT.jumpToday = true; }
  else if("gfit" in g.dataset){
    // Pick the most detailed zoom that shows the whole range without scrolling.
    const sc = $("gtScroll"), left = sc ? sc.querySelector(".gt-head .gt-l").offsetWidth : 0, visible = sc ? sc.clientWidth - left - 8 : 600;
    GANTT.zoom = ["day","week","month"].find(z => GANTT.days * GZ[z] <= visible) || "month";
    store.set("npi-gz", GANTT.zoom); GANTT.scrolledOnce = true; GANTT.fit = true;
  }
  else if("gall" in g.dataset){ if(GANTT.open.size) GANTT.open.clear(); else projList().forEach(p => GANTT.open.add(p.id)); }
  renderProjects();
}, true);
$("projects").addEventListener("change", e => { if(e.target.id === "gGroup"){ GANTT.group = e.target.value; store.set("npi-gg", GANTT.group); renderProjects(); } });
$("projects").addEventListener("keydown", e => { const r = e.target.closest(".gt-row[data-pid]"); if(r && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); openProject(r.dataset.pid); } });

/* Hover tips (desktop) — the text is escaped when the bar is drawn. */
(() => {
  let tipEl = null;
  const hide = () => { if(tipEl){ tipEl.remove(); tipEl = null; } };
  $("projects").addEventListener("mouseover", e => {
    const h = e.target.closest("[data-tip]"); if(!h){ hide(); return; }
    if(!tipEl){ tipEl = document.createElement("div"); tipEl.className = "gt-tip"; tipEl.setAttribute("role","tooltip"); document.body.appendChild(tipEl); }
    tipEl.innerHTML = h.dataset.tip;
  });
  $("projects").addEventListener("mousemove", e => { if(tipEl){ const x = Math.min(e.clientX + 14, innerWidth - tipEl.offsetWidth - 8); tipEl.style.left = x + "px"; tipEl.style.top = (e.clientY + 16) + "px"; } });
  $("projects").addEventListener("mouseleave", hide);
  $("projects").addEventListener("scroll", hide, true);
})();
// app.js may already have drawn the Projects page before this file loaded.
if(typeof D !== "undefined" && D && layout === "gantt") renderProjects();
