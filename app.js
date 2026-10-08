/* Exzone NPI Tracker — team app */
"use strict";
const STAGES = ["RFQ","DFM","Tooling","Trial / FAI","Build","Release"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const SCRIPT_URL = (window.NPI_CONFIG && window.NPI_CONFIG.scriptUrl) || "";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const dt = s => new Date(String(s).slice(0,10)+"T00:00:00");
const fmtDate = s => { const d=dt(s); return isNaN(d) ? "" : `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` };
function todayISO(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` }
const store = { get(k){ try{return localStorage.getItem(k)||""}catch(e){return ""} }, set(k,v){ try{ v?localStorage.setItem(k,v):localStorage.removeItem(k) }catch(e){} } };

let code = store.get("npi-code"), me = store.get("npi-me");
let D = null;                                   // tracker from Claude
let TD = {tasks:[], status:[], updates:[]};     // team data from Google Sheet
let teamOk = !!SCRIPT_URL, filter = "all", feedLimit = 25;

/* ---------- decryption ---------- */
const b64 = s => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
async function decrypt(enc, pass){
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({name:"PBKDF2", salt:b64(enc.salt), iterations:enc.iter, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({name:"AES-GCM", iv:b64(enc.iv)}, key, b64(enc.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function loadTracker(pass){
  const r = await fetch("data/tracker.enc.json?t="+Date.now(), {cache:"no-store"}).catch(()=>fetch("data/tracker.enc.json"));
  if(!r || !r.ok) throw new Error("network");
  const enc = await r.json();
  try { return await decrypt(enc, pass); } catch(e){ throw new Error("badcode"); }
}

/* ---------- team data (Google Sheet via Apps Script) ---------- */
async function loadTeam(){
  if(!SCRIPT_URL) return;
  try{
    const r = await fetch(SCRIPT_URL+"?code="+encodeURIComponent(code));
    const j = await r.json();
    if(j.ok){ TD = j; teamOk = true; store.set("npi-team-cache", JSON.stringify(j)); }
    else teamOk = false;
  }catch(e){
    teamOk = false;
    try{ const c = JSON.parse(store.get("npi-team-cache")||"null"); if(c) TD = c; }catch(_){}
  }
}
async function send(payload, okMsg){
  if(!SCRIPT_URL){ toast("Team input isn't switched on yet"); return false; }
  if(!me){ toast("Choose your name first (top right)"); menu(true); $("whoami").focus(); return false; }
  try{
    const r = await fetch(SCRIPT_URL, {method:"POST", body:JSON.stringify({...payload, code, me})});
    const j = await r.json();
    if(!j.ok){ toast(j.error==="bad_code" ? "Passcode was changed. Lock and re-enter the new one." : "Couldn't save. Please try again."); return false; }
    TD = j; store.set("npi-team-cache", JSON.stringify(j)); teamOk = true;
    if(okMsg) toast(okMsg);
    render(); return true;
  }catch(e){ toast("No connection. Please try again when you're online."); return false; }
}

/* ---------- derived view ---------- */
const T = k => (D && D.team[k]) || {name:k||"Unassigned", short:k||"—", ini:"?", role:""};
function teamKeys(){ return Object.keys(D.team).sort((a,b)=>(D.team[a].order??99)-(D.team[b].order??99)) }
const match = o => filter==="all" || o===filter;
const av = k => `<span class="av" aria-hidden="true">${esc(T(k).ini)}</span>`;
function statusMap(){ const m={}; (TD.status||[]).forEach(s=>{ if(!m[s.id] || s.at>m[s.id].at) m[s.id]=s }); return m; }
function allActions(){
  const st = statusMap();
  const claude = (D.actions||[]).map(a=>({...a, src:"claude"}));
  const team = (TD.tasks||[]).map(t=>({...t, src:"team"}));
  return claude.concat(team).map(a=>{ const s=st[a.id]; return {...a, done: s ? !!s.done : !!a.done, doneBy: s ? s.by : a.doneBy}; });
}
function latestNote(pid, after){
  return (TD.updates||[]).filter(u=>u.project===pid && (!after || u.at > after)).sort((a,b)=>b.at.localeCompare(a.at))[0];
}
function ownerOptions(sel, withBlank){ return (withBlank?`<option value="">— Choose your name —</option>`:"") + teamKeys().map(k=>`<option value="${k}" ${k===sel?"selected":""}>${esc(T(k).name)}</option>`).join("") }


/* ---------- view state ---------- */
const VIEWS = ["summary","projects","actions","calendar","workload","updates"];
const HL = {ok:"On track", warn:"Watch", bad:"At risk"};
const HORDER = {bad:0, warn:1, ok:2};
let view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : (store.get("npi-view") || "summary");
let layout = store.get("npi-layout") || "cards";
let aShow = "open", q = "", hF = "", sF = "", sortK = "", sortDir = 1;
let desk = store.get("npi-desk") === "1";
const addDays = (iso, n) => { const d = new Date(dt(iso).getTime()+n*864e5); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const pname = id => (D.projects.find(p=>p.id===id)||{}).name;

/* ---------- render ---------- */
function render(){
  $("whoami").innerHTML = ownerOptions(me, true);
  const mb = $("meBtn"); mb.classList.toggle("need", !me);
  mb.innerHTML = me ? `${av(me)}<span class="nm">${esc(T(me).short)}</span>` : `<span class="nm">Choose name</span>`;
  $("syncStamp").textContent = D.lastSync ? `${fmtDate(D.lastSync)} ${D.lastSync.slice(11,16)}` : "—";
  const cv = D.coverage;
  $("covStamp").textContent = cv ? `Read ${cv.inbox} inbox + ${cv.sent} sent emails since ${fmtDate(cv.from)}` : "";
  $("covLine").textContent = cv ? `Team posts and project emails · last refresh read every email since ${fmtDate(cv.from)} (${cv.inbox} inbox, ${cv.sent} sent; ${cv.skipped} skipped as ${cv.note})` : "Team posts and project emails";
  const ao = $("actOwner").value; $("actOwner").innerHTML = ownerOptions(ao || me || (filter!=="all"?filter:"rashid"), false);
  const pp = $("postProj").value;
  $("postProj").innerHTML = projOptions(pp);
  if(!$("sFilter").options.length) $("sFilter").innerHTML = `<option value="">All stages</option>` + STAGES.map((s,i)=>`<option value="${i}">${s}</option>`).join("");
  const b = $("banner");
  if(!SCRIPT_URL){ b.hidden=false; b.className="banner"; b.textContent="Adding tasks and posting updates will be switched on shortly. You can view the tracker now."; }
  else if(!teamOk){ b.hidden=false; b.className="banner warn"; b.textContent="Couldn't reach the team list. Showing the last saved copy; tasks and ticks may be out of date."; }
  else b.hidden=true;
  document.querySelectorAll("#actForm button,#postForm button").forEach(x=>x.disabled=!SCRIPT_URL);
  const acts = allActions();
  $("nProj").textContent = D.projects.length;
  const nOpen = acts.filter(a=>!a.done && (!me || a.owner===me)).length;
  $("nAct").textContent = nOpen || ""; $("nAct").title = me ? "Your open actions" : "Open actions";
  $("nAct").classList.toggle("bad", acts.some(a=>!a.done && a.urgent && (!me || a.owner===me)));
  renderFilters(); renderKpis(); renderDash(); renderPeople(); renderProjects(); renderActions(); renderMeetings(); renderFeed(); renderWorkload(); renderView();
}
function projOptions(sel){
  return `<option value="">General update (no project)</option>` + D.projects.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${esc(p.id)}" ${p.id===sel?"selected":""}>${esc(p.name)}</option>`).join("");
}
function renderView(){
  VIEWS.forEach(v=>{ $("v-"+v).hidden = v!==view; });
  document.querySelectorAll("#nav a").forEach(a=>{ if(a.dataset.view===view) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  document.querySelectorAll("[data-layout]").forEach(x=>x.setAttribute("aria-pressed", String(x.dataset.layout===layout)));
  document.querySelectorAll("[data-ashow]").forEach(x=>x.setAttribute("aria-pressed", String(x.dataset.ashow===aShow)));
  document.body.classList.toggle("desk", desk); $("deskBtn").setAttribute("aria-checked", String(desk));
}
function go(v){ view=v; store.set("npi-view", v); if(location.hash!=="#"+v) history.replaceState(null,"","#"+v); renderView(); window.scrollTo({top:0}); }
function renderFilters(){
  const html = ["all",...teamKeys()].map(k=>`<button class="chip" type="button" aria-pressed="${filter===k}" data-k="${k}">${k==="all"?"Whole team":av(k)+esc(T(k).short)}</button>`).join("");
  document.querySelectorAll("[data-filters]").forEach(el=>el.innerHTML=html);
}
function renderKpis(){
  const p = D.projects.filter(x=>match(x.owner)), acts = allActions().filter(a=>match(a.owner)&&!a.done);
  const t = todayISO(), wk = addDays(t,7);
  const m = D.meetings.filter(x=>(filter==="all"||(x.who||[]).includes(filter)) && x.date>=t && x.date<=wk).length
          + p.filter(x=>x.due && x.due>=t && x.due<=wk).length;
  const late = p.filter(x=>x.asap || (x.due && x.due<t)).length;
  $("sumSub").textContent = filter==="all" ? "Where every NPI project stands today." : `Showing ${T(filter).name}'s projects and actions.`;
  $("kpis").innerHTML = `
    <button class="kpi" type="button" data-kpi="all"><span class="eyebrow">Active projects</span><b>${p.length}</b><small>${STAGES.map((s,i)=>p.filter(x=>x.stage===i).length).join(" · ")} by stage</small></button>
    <button class="kpi bad" type="button" data-kpi="bad"><span class="eyebrow">At risk</span><b>${p.filter(x=>x.health==="bad").length}</b><small>${late} overdue / ASAP</small></button>
    <button class="kpi warn" type="button" data-kpi="warn"><span class="eyebrow">Watch</span><b>${p.filter(x=>x.health==="warn").length}</b><small>${p.filter(x=>x.health==="ok").length} on track</small></button>
    <button class="kpi blue" type="button" data-kpi="actions"><span class="eyebrow">Open actions</span><b>${acts.length}</b><small>${acts.filter(a=>a.urgent).length} urgent</small></button>
    <button class="kpi ok" type="button" data-kpi="calendar"><span class="eyebrow">Next 7 days</span><b>${m}</b><small>meetings &amp; due dates</small></button>`;
}
function renderPeople(){
  const acts = allActions();
  $("people").innerHTML = teamKeys().map(k=>{
    const p = D.projects.filter(x=>x.owner===k), a = acts.filter(x=>x.owner===k&&!x.done).length, r = p.filter(x=>x.health==="bad").length;
    return `<button class="person" type="button" data-k="${k}" aria-pressed="${filter===k}">${av(k)}<h3>${esc(T(k).name)}</h3><div class="role">${esc(T(k).role||"Role not set")}</div>
      <div class="nums"><span><b>${p.length}</b> project${p.length===1?"":"s"}</span><span><b>${a}</b> action${a===1?"":"s"}</span>${r?`<span class="r"><b>${r}</b> at risk</span>`:""}</div></button>`;
  }).join("");
}
function dueHtml(p){
  if(p.asap) return `<span class="mono late">ASAP</span>`;
  if(!p.due) return "";
  const late = p.due < todayISO();
  return `<span class="mono ${late?"late":""}">${fmtDate(p.due)}${late?" · overdue":""}</span>`;
}
const stageBar = s => `<div class="stages" aria-label="Stage: ${STAGES[s]||""}">${STAGES.map((x,i)=>`<span class="${i<s?"done":i===s?"now":""}"></span>`).join("")}</div><div class="stage-labels" aria-hidden="true">${STAGES.map((x,i)=>`<span class="${i===s?"now":""}">${x.replace(" / ","/")}</span>`).join("")}</div>`;
function projList(){
  const ql = q.toLowerCase();
  let list = D.projects.filter(x=>match(x.owner) && (!hF || x.health===hF) && (sF==="" || String(x.stage)===sF)
    && (!ql || [x.name,x.customer,x.update,x.next,T(x.owner).name].join(" ").toLowerCase().includes(ql)));
  const key = { name:x=>x.name, customer:x=>x.customer||"", owner:x=>T(x.owner).short, stage:x=>x.stage, health:x=>HORDER[x.health]??3, due:x=>x.asap?"0":(x.due||"9") };
  if(sortK && key[sortK]) list.sort((a,b)=>{ const A=key[sortK](a), B=key[sortK](b); return (A<B?-1:A>B?1:0)*sortDir; });
  else list.sort((a,b)=>(HORDER[a.health]??3)-(HORDER[b.health]??3) || (a.asap?"0":(a.due||"9")).localeCompare(b.asap?"0":(b.due||"9")));
  return list;
}
function renderProjects(){
  const list = projList(), total = D.projects.filter(x=>match(x.owner)).length;
  $("projCount").textContent = list.length===total ? `${total} active project${total===1?"":"s"}${filter!=="all"?" for "+T(filter).short:""}` : `${list.length} of ${total} shown`;
  if(!list.length){ $("projects").innerHTML = `<div class="panel empty">No projects match. ${filter!=="all"?"Try “Whole team”, or post":"Post"} an update and Rashid's Claude will add new ones.</div>`; return; }
  if(layout==="table"){
    const th = (k,l) => `<th data-sort="${k}" class="${sortK===k?(sortDir>0?"asc":"desc"):""}" scope="col">${l}</th>`;
    $("projects").innerHTML = `<div class="tbl-wrap"><table class="reg"><thead><tr>${th("name","Project")}${th("customer","Customer")}${th("owner","Owner")}${th("stage","Stage")}${th("health","Status")}<th scope="col">Next step</th>${th("due","Due")}</tr></thead><tbody>${
      list.map(x=>`<tr data-pid="${esc(x.id)}" data-h="${esc(x.health)}" tabindex="0">
        <td class="name">${esc(x.name)}</td><td>${esc(x.customer||"")}</td><td class="nowrap">${esc(T(x.owner).short)}</td>
        <td class="nowrap">${esc(STAGES[x.stage]||"")}<div class="stg">${STAGES.map((s,i)=>`<i class="${i<x.stage?"done":i===x.stage?"now":""}"></i>`).join("")}</div></td>
        <td><span class="pill ${esc(x.health)}">${esc(x.healthLabel||HL[x.health]||"")}</span></td>
        <td>${esc(x.next||"")}</td><td class="nowrap">${dueHtml(x)}</td></tr>`).join("")}</tbody></table></div>`;
    return;
  }
  $("projects").innerHTML = `<div class="proj-grid">${list.map(x=>{
    const n = latestNote(x.id, x.updatedAt);
    return `<button type="button" class="proj" data-h="${esc(x.health)}" data-pid="${esc(x.id)}">
      <div class="top"><div><h3>${esc(x.name)}</h3><div class="meta"><span>${esc(x.customer||"")}</span><span>Owner: ${esc(T(x.owner).short)}</span></div></div><span class="pill ${esc(x.health)}">${esc(x.healthLabel||HL[x.health]||"")}</span></div>
      ${stageBar(x.stage)}
      ${x.update?`<div class="update">${esc(x.update)}</div>`:""}
      ${n?`<div class="note"><b>${esc(T(n.owner).short)}, ${fmtDate(n.at)}:</b> ${esc(n.text)}</div>`:""}
      ${x.next||x.due||x.asap?`<div class="next"><span class="eyebrow">Next</span><span>${esc(x.next||"")}</span>${dueHtml(x)}</div>`:""}
    </button>`}).join("")}</div>`;
}
function actionRow(x){
  return `<div class="row ${x.done?"done":""}">
    <input type="checkbox" class="check" id="c-${esc(x.id)}" data-id="${esc(x.id)}" ${x.done?"checked":""} ${SCRIPT_URL?"":"disabled"} aria-label="Done">
    <label for="c-${esc(x.id)}"><div class="t">${esc(x.text)}</div><div class="s">${x.urgent&&!x.done?'<span class="tag bad">Urgent</span>':""}${x.tag?`<span class="tag">${esc(x.tag)}</span>`:""}${esc(T(x.owner).short)}${x.src==="team"&&x.createdBy&&x.createdBy!==x.owner?` · added by ${esc(T(x.createdBy).short)}`:""}${x.done&&x.doneBy?` · done by ${esc(T(x.doneBy).short)}`:""}${!x.done&&SCRIPT_URL?hrsChip(x):""}</div></label>
    ${x.src==="team"&&SCRIPT_URL&&(x.createdBy===me||x.owner===me)?`<button class="linkbtn" type="button" data-del="${esc(x.id)}" aria-label="Remove task">Remove</button>`:"<span></span>"}
  </div>`;
}
function hrsChip(x){ const e=effortMap()[x.id]; const h=e&&+e.hours>0?+e.hours:""; return `<button type="button" class="hrs ${h?"set":""}" data-hrs="${esc(x.id)}" data-cur="${h}" title="Estimated hours to finish">${h?h+"h":"+ hrs"}</button>`; }
function renderActions(){
  const list = allActions().filter(x=>match(x.owner) && (aShow==="all" || (aShow==="done") === !!x.done))
    .sort((x,y)=>(!!x.done)-(!!y.done) || (!!y.urgent)-(!!x.urgent) || String(x.createdAt||"").localeCompare(String(y.createdAt||"")));
  if(!list.length){ $("actions").innerHTML = `<div class="empty">${aShow==="done"?"Nothing ticked off yet.":"No open actions."}</div>`; return; }
  if(filter!=="all"){ $("actions").innerHTML = list.map(actionRow).join(""); return; }
  const groups = teamKeys().map(k=>[k, list.filter(a=>a.owner===k)]).filter(g=>g[1].length);
  $("actions").innerHTML = groups.map(([k,as])=>`<div class="grp">${esc(T(k).name)} · ${as.length}</div>${as.map(actionRow).join("")}`).join("");
}
function renderMeetings(){
  const t = todayISO(), tm = addDays(t,1);
  const items = D.meetings.filter(x=>x.date>=t && (filter==="all"||(x.who||[]).includes(filter)))
    .map(x=>({date:x.date, time:x.time||"", t:x.title, s:[x.sub, (x.who||[]).map(k=>T(k).short).join(", ")].filter(Boolean).join(" · ")}))
    .concat(D.projects.filter(p=>p.due && p.due>=t && match(p.owner)).map(p=>({date:p.due, time:"", t:`Due: ${p.next||p.name}`, s:`${p.name} · ${T(p.owner).short}`, pid:p.id})))
    .sort((a,b)=>(a.date+(a.time||"~")).localeCompare(b.date+(b.time||"~"))).slice(0,40);
  if(!items.length){ $("meetings").innerHTML = `<div class="empty">Nothing scheduled.</div>`; return; }
  let last = "", html = "";
  items.forEach(x=>{
    if(x.date!==last){ last=x.date; html += `<div class="grp">${x.date===t?"Today · ":x.date===tm?"Tomorrow · ":""}${fmtDate(x.date)}</div>`; }
    html += `<div class="row two"${x.pid?` data-pid="${esc(x.pid)}" style="cursor:pointer"`:""}><div class="when"><b>${esc(x.time||"—")}</b>${x.pid?"due":x.time?"MYT":"all day"}</div><div><div class="t">${esc(x.t)}</div><div class="s">${esc(x.s)}</div></div></div>`;
  });
  $("meetings").innerHTML = html;
}
function feedItems(pid){
  return (D.feed||[]).map(f=>({...f})).concat((TD.updates||[]).map(u=>({...u, kind:"post"})))
    .filter(x=>pid ? x.project===pid : match(x.owner)).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
}
const feedRow = x => { const d=dt(x.at); return `
  <div class="row">${av(x.owner)}
    <div class="when">${d.getDate()} ${MON[d.getMonth()]}<br>${esc(String(x.at).slice(11,16))}</div>
    <div><div class="t">${esc(x.text)}</div><div class="s">${x.kind==="post"?'<span class="tag post">Update</span>':'<span class="tag">Email</span>'}${esc(T(x.owner).short)}${x.sub?" · "+esc(x.sub):""}${x.project&&pname(x.project)?` · <a class="linkbtn" href="#" data-pid="${esc(x.project)}">${esc(pname(x.project))}</a>`:""}</div></div>
  </div>`; };
function renderFeed(){
  const all = feedItems(), list = all.slice(0, feedLimit);
  $("feed").innerHTML = (list.length ? list.map(feedRow).join("") : `<div class="empty">No activity yet.</div>`)
    + (all.length>feedLimit?`<div class="more"><button class="linkbtn" type="button" id="moreFeed">Show more</button></div>`:"");
}

/* ---------- summary dashboard ---------- */
function renderDash(){
  const projs = D.projects.filter(x=>match(x.owner));
  $("pipeLegend").innerHTML = ["bad","warn","ok"].map(h=>`<span><i class="c-${h}"></i>${HL[h]}</span>`).join("");
  const cols = STAGES.map((s,i)=>{ const p=projs.filter(x=>x.stage===i); return {i, s, p, bad:p.filter(x=>x.health==="bad"), warn:p.filter(x=>x.health==="warn"), ok:p.filter(x=>x.health==="ok")}; });
  const max = Math.max(1, ...cols.map(c=>c.p.length)), H = 140;
  $("pipeline").innerHTML = cols.map(c=>{
    const seg = h => c[h].length ? `<b class="c-${h}" style="height:${Math.round(c[h].length/max*H)}px"></b>` : "";
    const tip = `<b>${c.s}: ${c.p.length} project${c.p.length===1?"":"s"}</b>` + (c.p.length ? "<br>"+["bad","warn","ok"].filter(h=>c[h].length).map(h=>`${HL[h]}: ${c[h].length}`).join(" · ") + "<br>" + c.p.slice(0,6).map(x=>esc(x.name)).join("<br>") + (c.p.length>6?`<br>+${c.p.length-6} more`:"") + "<br><i>Click to open list</i>" : "");
    return `<button type="button" class="pcol" data-stage="${c.i}" data-tip="${esc(tip)}" aria-label="${c.s}: ${c.p.length} projects"><span class="n">${c.p.length||""}</span><div class="pstack">${seg("ok")}${seg("warn")}${seg("bad")}</div></button>`;
  }).join("");
  $("plabels").innerHTML = STAGES.map(s=>`<span>${s}</span>`).join("");

  const t = todayISO(), att = [];
  projs.forEach(p=>{
    const late = !p.asap && p.due && p.due < t;
    if(p.health==="bad" || late || p.asap) att.push({lvl: p.health==="bad"?0:1, color: p.health==="bad"?"bad":"warn", t:p.name, s:`${p.customer?p.customer+" · ":""}${T(p.owner).short} · ${p.healthLabel||HL[p.health]}`, d: p.asap?"ASAP": late?"Overdue":fmtDate(p.due), late: p.asap||late, pid:p.id});
  });
  allActions().filter(a=>match(a.owner) && a.urgent && !a.done).forEach(a=>att.push({lvl:2, color:"warn", t:a.text, s:`Urgent action · ${T(a.owner).short}${a.tag?" · "+a.tag:""}`, d:"", late:false, go:"actions"}));
  att.sort((a,b)=>a.lvl-b.lvl);
  $("attention").innerHTML = att.length ? `<div class="alist">${att.slice(0,8).map(a=>`<button type="button" class="aitem" ${a.pid?`data-pid="${esc(a.pid)}"`:`data-go="${a.go}"`}><span class="dot c-${a.color}" aria-hidden="true"></span><div><div class="t">${esc(a.t)}</div><div class="s">${esc(a.s)}</div></div><span class="d ${a.late?"late":""}">${esc(a.d)}</span></button>`).join("")}</div>${att.length>8?`<button class="linkbtn" type="button" data-go="projects" style="align-self:flex-start">+${att.length-8} more → Projects</button>`:""}` : `<div class="empty" style="padding:0">Nothing needs attention right now.</div>`;

  const endS = addDays(t,14);
  const items = projs.filter(p=>p.due && p.due>=t && p.due<=endS).map(p=>({d:p.due, t:p.next||p.name, s:`${p.name} · ${T(p.owner).short}`, kind:"Due", pid:p.id}))
    .concat(D.meetings.filter(m=>m.date>=t && m.date<=endS && !m.time && (filter==="all"||(m.who||[]).includes(filter))).map(m=>({d:m.date, t:m.title, s:(m.sub||"").replace(/^Milestone$/i,""), kind:"Milestone"})))
    .sort((a,b)=>a.d.localeCompare(b.d));
  $("deadlines").innerHTML = items.length ? `<div class="alist">${items.slice(0,8).map(i=>`<button type="button" class="aitem" ${i.pid?`data-pid="${esc(i.pid)}"`:`data-go="calendar"`}><span class="dot" style="background:var(--blue)" aria-hidden="true"></span><div><div class="t">${esc(i.t)}</div><div class="s">${i.kind}${i.s&&i.s!==i.kind?" · "+esc(i.s):""}</div></div><span class="d">${fmtDate(i.d)}</span></button>`).join("")}</div>` : `<div class="empty" style="padding:0">No due dates in the next 14 days.</div>`;

  const rows = teamKeys().map(personModel).sort((a,b)=>b.load-a.load);
  $("workload").innerHTML = rows.map(r=>`<button type="button" class="hbar" data-who="${r.k}" data-tip="${esc(`<b>${esc(T(r.k).name)}</b> · ${r.status}<br>Est. ${r.est}h/week vs ~${r.cap}h<br>${r.activeProjects} projects · ${r.openActions} open actions · ${r.critical} critical<br><i>Click for evidence</i>`)}" style="${filter!=="all"&&filter!==r.k?"opacity:.45":""}">
      <span class="lbl">${esc(T(r.k).short)}</span><span class="track"><span class="fill" style="width:${Math.min(100,r.load*100)}%;${r.load>1?"background:var(--bad)":r.load>0.85?"background:var(--warn)":""}"></span></span><span class="val">${r.est}h${r.status!=="NOT OVERLOADED"?`<em>${r.status==="OVERLOADED"?"over":"watch"}</em>`:""}</span></button>`).join("");

  const byC = {}; projs.forEach(p=>{ const c=p.customer||"Internal / other"; (byC[c]=byC[c]||[]).push(p); });
  const crow = Object.entries(byC).sort((a,b)=>b[1].length-a[1].length);
  const cmax = Math.max(1,...crow.map(c=>c[1].length));
  $("customers").innerHTML = crow.length ? crow.map(([c,ps])=>{ const r=ps.filter(p=>p.health==="bad").length;
    return `<button type="button" class="hbar" data-cust="${esc(c)}" data-tip="${esc(`<b>${esc(c)}: ${ps.length}</b><br>`+ps.slice(0,6).map(p=>esc(p.name)).join("<br>")+(ps.length>6?`<br>+${ps.length-6} more`:""))}"><span class="lbl">${esc(c)}</span><span class="track"><span class="fill" style="width:${ps.length/cmax*100}%"></span></span><span class="val">${ps.length}${r?`<em>${r} risk</em>`:""}</span></button>`}).join("") : `<div class="empty" style="padding:0">No projects.</div>`;
}


/* ---------- workload assessment (evidence-based) ---------- */
const CXW = {critical:4, high:3, medium:2, low:1};
function effortMap(){ const m={}; (TD.effort||[]).forEach(e=>{ if(!m[e.id] || e.at>m[e.id].at) m[e.id]=e }); return m; }
function capCfg(){ return Object.assign({weekHours:40, projectShare:0.75, mgmtHours:{}, weights:{critical:10,high:6,medium:3,low:1}, actionHours:0.5, urgentHours:1, meetingHours:1}, D.capacity||{}); }
function personModel(k){
  const C = capCfg(), t = todayISO(), wk = addDays(t,7), eff = effortMap();
  const projs = D.projects.filter(p=>p.owner===k);
  const acts = allActions().filter(a=>a.owner===k && !a.done);
  const meets = D.meetings.filter(m=>m.date>=t && m.date<=wk && (m.who||[]).includes(k));
  const withH = acts.filter(a=>eff[a.id] && +eff[a.id].hours>0);
  const actH = acts.reduce((s,a)=> s + (eff[a.id] && +eff[a.id].hours>0 ? +eff[a.id].hours : (a.urgent?C.urgentHours:C.actionHours)), 0);
  const projH = projs.reduce((s,p)=> s + (C.weights[p.complexity||"low"]||1), 0);
  const mgmtH = (C.mgmtHours||{})[k] || 0;
  const est = Math.round((projH + actH + meets.length*C.meetingHours + mgmtH)*10)/10;
  const cap = Math.round(C.weekHours*C.projectShare);
  const crit = projs.filter(p=>p.complexity==="critical");
  const ev = {
    k, projs, acts, meets, est, cap, mgmtH,
    activeProjects: projs.length,
    openActions: acts.length,
    urgent: acts.filter(a=>a.urgent).length,
    atRisk: projs.filter(p=>p.health==="bad").length,
    custIssues: projs.filter(p=>p.customerIssue).length,
    suppIssues: projs.filter(p=>p.supplier).length,
    threads: projs.reduce((s,p)=>s+(p.threads||0),0),
    escalations: projs.filter(p=>p.escalation).length,
    due7: projs.filter(p=>p.asap || (p.due && p.due<=wk)).length,
    customers: new Set(projs.map(p=>p.customer).filter(Boolean)).size,
    critical: crit.length,
    highPlus: projs.filter(p=>p.complexity==="critical"||p.complexity==="high").length,
    hoursCoverage: acts.length ? withH.length/acts.length : 1
  };
  // independent indicators
  const sig = [];
  if(est > cap) sig.push(`estimated ${est}h/week vs ~${cap}h available`);
  else if(est > cap*0.85) sig.push(`estimated ${est}h/week, close to ~${cap}h available`);
  if(ev.critical>=1) sig.push(`${ev.critical} critical issue${ev.critical>1?"s":""} (${crit.map(p=>p.name.split(" ·")[0]).join(", ")})`);
  if(ev.highPlus>=3) sig.push(`${ev.highPlus} high/critical-complexity projects at once`);
  if(ev.activeProjects>=5) sig.push(`${ev.activeProjects} concurrent projects`);
  if(ev.customers>=3) sig.push(`${ev.customers} customers in parallel`);
  if(ev.escalations>=1) sig.push(`${ev.escalations} customer escalation${ev.escalations>1?"s":""}`);
  if(ev.due7>=3) sig.push(`${ev.due7} projects due or overdue within 7 days`);
  if(ev.urgent>=2) sig.push(`${ev.urgent} urgent actions`);
  ev.signals = sig;
  const effortKnown = ev.hoursCoverage>=0.7 && acts.length>0;
  const strong = sig.length;
  if(strong>=3 && est>cap && effortKnown){ ev.status="OVERLOADED"; ev.conf = strong>=5?"HIGH":"MEDIUM"; }
  else if(strong>=3 || (est>cap && strong>=2)){ ev.status="POTENTIAL OVERLOAD"; ev.conf = effortKnown ? "MEDIUM" : (strong>=5 ? "MEDIUM" : "LOW"); }
  else { ev.status="NOT OVERLOADED"; ev.conf = strong===0 ? (ev.activeProjects? "MEDIUM":"LOW") : "MEDIUM"; }
  if(!effortKnown && ev.status!=="NOT OVERLOADED") ev.why = "Several workload indicators are high, but effort hours are estimated, not entered by the team.";
  ev.load = cap ? est/cap : 0;
  ev.driver = mainDriver(projs);
  return ev;
}
const DRIVERS = [
  ["Customer issue resolution", /waiver|rcca|complaint|escalat|out[- ]of[- ]spec|rib broken|failure|not working|containment|concession/i],
  ["Engineering investigation", /investigat|dimension|dfm|mould[- ]flow|test|measurement|fair|root|feasib|firmware/i],
  ["Tooling / trial activity", /trial|tool|insert|rectif|jig|fot|isir|gate|t-2|t1/i],
  ["Supplier coordination", /toolmaker|supplier|tokyo|zhang|sunrise|vision|ek advanced|silcotech|sourcing|rfqs|vendor|resin|label sample/i],
  ["Customer communication", /keysight|broadcom|customer|marelli|rentokil|agilent|communication|call|meeting|visit/i],
  ["Urgent delivery recovery", /delivery|shipment|ship|crd|120 pcs|lot/i],
  ["Quotation / commercial", /quot|cost|po\b|price|moq/i],
  ["Documentation / ECO", /eco|drawing|drf|os\/is|documentation|artwork|manual|package/i]
];
function mainDriver(projs){
  const sc = {}; projs.forEach(p=>(p.activities||[]).forEach(a=>DRIVERS.forEach(([n,re])=>{ if(re.test(a)) sc[n]=(sc[n]||0)+(CXW[p.complexity]||1); })));
  const top = Object.entries(sc).sort((a,b)=>b[1]-a[1])[0];
  return top ? top[0] : "—";
}
function teamModel(){
  const people = teamKeys().map(personModel);
  const C = capCfg();
  const active = people.filter(p=>p.activeProjects||p.openActions);
  const est = people.reduce((s,p)=>s+p.est,0), cap = active.length*Math.round(C.weekHours*C.projectShare);
  const over = people.filter(p=>p.status==="OVERLOADED"), pot = people.filter(p=>p.status==="POTENTIAL OVERLOAD");
  const crit = D.projects.filter(p=>p.complexity==="critical"), esc = D.projects.filter(p=>p.escalation);
  const top3 = people.slice().sort((a,b)=>b.est-a.est).slice(0,3), top3share = est ? top3.reduce((s,p)=>s+p.est,0)/est : 0;
  const cov = (()=>{ const a=allActions().filter(x=>!x.done), e=effortMap(); return a.length ? a.filter(x=>e[x.id]&&+e[x.id].hours>0).length/a.length : 0; })();
  let status, conf;
  const flagged = over.length + pot.length, util = cap ? est/cap : 0;
  if((est>cap || over.length>=2) && crit.length>=3 && esc.length>=2){ status="CRITICAL"; conf="MEDIUM"; }
  else if(est>cap && over.length>=2){ status="OVERLOADED"; conf= cov>=0.7?"HIGH":"MEDIUM"; }
  else if((util>0.85 && flagged>=2) || flagged >= Math.max(3, Math.ceil(active.length*0.4))){ status="POTENTIAL OVERLOAD"; conf="MEDIUM"; }
  else if(flagged>=1 || crit.length>=2){ status="HIGH"; conf="MEDIUM"; }
  else { status="NORMAL"; conf= cov>=0.7?"HIGH":"MEDIUM"; }
  if(cov<0.3 && status!=="NORMAL") conf = conf==="HIGH"?"MEDIUM":conf;
  // drivers
  const sc = {}; D.projects.forEach(p=>(p.activities||[]).forEach(a=>DRIVERS.forEach(([n,re])=>{ if(re.test(a)) sc[n]=(sc[n]||0)+(CXW[p.complexity]||1); })));
  const drivers = Object.entries(sc).sort((a,b)=>b[1]-a[1]);
  return {people, active, est:Math.round(est), cap, over, pot, crit, esc, top3, top3share, cov, status, conf, drivers, util};
}
function renderWorkload(){
  if(!$("wlExec")) return;
  const M = teamModel(), C = capCfg();
  $("wlAsOf").textContent = `Data as of ${fmtDate(D.lastSync)} ${String(D.lastSync).slice(11,16)}`;
  const names = a => a.map(p=>T(p.k).short).join(", ");
  const why = [
    `NPI has ${M.active.length} active team members supporting ${D.projects.length} active projects across ${new Set(D.projects.map(p=>p.customer).filter(Boolean)).size} customers.`,
    `Estimated load is about ${M.est}h/week against roughly ${M.cap}h of project time (${Math.round(C.projectShare*100)}% of a ${C.weekHours}h week per active member${(C.mgmtHours||{}).rashid?`, plus ${(C.mgmtHours||{}).rashid}h management for Rashid`:""}).`,
    `Work is concentrated: ${names(M.top3)} carry ${Math.round(M.top3share*100)}% of the estimated load.`,
    M.crit.length ? `${M.crit.length} critical issue${M.crit.length>1?"s":""} (${M.crit.map(p=>p.name.split(" ·")[0]).join("; ")}) drive most of the pressure${M.esc.length?`, with ${M.esc.length} customer escalation${M.esc.length>1?"s":""}`:""}.` : "",
    M.over.length ? `${names(M.over)}: overloaded on multiple independent indicators.` : "",
    M.util<=0.85 && (M.over.length+M.pot.length) ? `Team-wide load is about ${Math.round(M.util*100)}% of estimated capacity, so the pressure is concentrated on a few people rather than the whole department.` : "",
    M.pot.length ? `${names(M.pot)}: potential overload — several indicators are high.` : "",
    `Action count alone is not used to judge overload. ${M.cov<0.7 ? `Effort hours are entered for only ${Math.round(M.cov*100)}% of open actions, so hours are estimated from issue complexity; more effort-hour data is needed before concluding the department is structurally overloaded.` : "Effort hours are entered for most open actions."}`
  ].filter(Boolean);
  $("wlExec").innerHTML = `<div class="exec"><div class="exec-top"><span class="badge ${M.status.split(" ")[0]}">${M.status}</span><span class="conf">Confidence: <b>${M.conf}</b></span></div>
    <p style="margin-top:10px">${why.map(esc).join(" ")}</p></div>`;
  const dmax = Math.max(1,...M.drivers.map(d=>d[1]));
  $("wlDrivers").innerHTML = M.drivers.map(([n,v])=>`<div class="hbar" style="grid-template-columns:minmax(150px,190px) minmax(0,1fr) auto"><span class="lbl" title="${esc(n)}">${esc(n)}</span><span class="track"><span class="fill" style="width:${v/dmax*100}%"></span></span><span class="val">${v}</span></div>`).join("");
  // people requiring review
  const rev = M.people.filter(p=>p.status!=="NOT OVERLOADED" || p.signals.length>=2 || p.load>1).sort((a,b)=>b.load-a.load);
  $("wlReview").innerHTML = rev.length ? `<div class="tbl-scroll"><table class="wl"><thead><tr><th>Person</th><th>Workload</th><th>Main driver</th><th>Evidence</th><th>Assessment</th></tr></thead><tbody>${rev.map(p=>`
    <tr data-who="${p.k}"><td><b>${esc(T(p.k).name)}</b></td><td style="min-width:120px">${meter(p)}<div class="conf">${p.est}h / ~${p.cap}h</div></td><td>${esc(p.driver)}</td><td>${esc(p.signals.slice(0,4).join("; "))}</td>
    <td><span class="badge ${p.status.split(" ")[0]}" style="font-size:12px;padding:2px 8px">${p.status}</span><div class="conf">Confidence: <b>${p.conf}</b></div></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No one currently shows several high workload indicators.</div>`;
  // resource opportunity
  const spare = M.people.filter(p=>p.status==="NOT OVERLOADED" && p.load<0.6).sort((a,b)=>a.load-b.load);
  $("wlSpare").innerHTML = spare.length ? `<div class="tbl-scroll"><table class="wl"><thead><tr><th>Person</th><th>Available capacity (est.)</th><th>Suitable support area</th></tr></thead><tbody>${spare.map(p=>`
    <tr data-who="${p.k}"><td><b>${esc(T(p.k).name)}</b><div class="conf">${esc(T(p.k).role||"")}</div></td><td>~${Math.max(0,Math.round(p.cap-p.est))}h/week${p.activeProjects<2?'<div class="conf">Low confidence: little of this person’s work is in the tracker</div>':""}</td><td>${esc(supportArea(p.k))}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No clear spare capacity in the estimate.</div>`;
  if(spare.length) $("wlSpare").innerHTML += `<div class="conf" style="padding:8px 14px">Only work recorded in the NPI Tracker is counted. Production, tooling-room and purchasing work outside the tracker is not visible here, so confirm with the person before reassigning anything.</div>`;
  // recommendations
  const recs = [];
  if(M.cov<0.7) recs.push(`Add estimated hours to every open action (tap “+ hrs” in Actions). Only ${Math.round(M.cov*100)}% have hours today, which keeps confidence at ${M.conf}.`);
  if(M.over.length+M.pot.length) recs.push(`Redistribute routine follow-ups (quotes, label samples, documentation, supplier chasing) away from ${names(M.over.concat(M.pot))} so they can focus on ${M.crit.length?"the critical customer issues":"their high-complexity projects"}.`);
  if(M.crit.length) recs.push(`Separate engineering work from administrative follow-up on critical issues: one owner for the technical fix, another for customer/supplier communication and delivery coordination.`);
  if(M.top3share>0.45) recs.push(`Review projects per engineer: ${names(M.top3)} carry ${Math.round(M.top3share*100)}% of the estimated load.`);
  if(spare.length) recs.push(`Use available capacity from ${names(spare.slice(0,4))} for suitable support areas (see Resource opportunity).`);
  if(C.mgmtHours && C.mgmtHours.rashid) recs.push(`Review management/coordination workload separately from engineering workload (Rashid's oversight of ${D.projects.length} projects).`);
  recs.push(`Consider extra manpower only if overload is still shown after redistribution and with real effort hours for 4+ weeks.`);
  $("wlRecs").innerHTML = `<ol class="recs">${recs.map(r=>`<li>${esc(r)}</li>`).join("")}</ol>`;
  // full table
  const cols = [["activeProjects","Projects"],["openActions","Open actions"],["urgent","Urgent"],["atRisk","At risk"],["custIssues","Customer issues"],["suppIssues","Supplier issues"],["threads","Issue threads"],["escalations","Escalations"],["due7","Due ≤7d"],["customers","Customers"],["critical","Critical"]];
  const hot = {urgent:2,atRisk:1,escalations:1,critical:1,activeProjects:5,customers:3,due7:3};
  $("wlTable").innerHTML = `<div class="tbl-scroll"><table class="wl"><thead><tr><th>Person</th>${cols.map(c=>`<th style="text-align:right">${c[1]}</th>`).join("")}<th>Est. h/week</th><th>Assessment</th></tr></thead><tbody>${
    M.people.slice().sort((a,b)=>b.load-a.load).map(p=>`<tr data-who="${p.k}"><td><b>${esc(T(p.k).short)}</b></td>${cols.map(([c])=>`<td class="n ${hot[c]&&p[c]>=hot[c]?"hot":""}">${p[c]}</td>`).join("")}<td style="min-width:110px">${meter(p)}<div class="conf">${p.est}h / ~${p.cap}h</div></td><td><span class="cx ${p.status==="OVERLOADED"?"critical":p.status==="POTENTIAL OVERLOAD"?"medium":"low"}">${p.status}</span></td></tr>`).join("")}</tbody></table></div>`;
  $("wlNote").innerHTML = `<b>How this is worked out.</b> Each project carries an issue complexity (Low / Medium / High / Critical) and the activities needed to close it, taken from the related email threads — a 20-message thread counts as one issue, not 20 tasks. Estimated hours = complexity weight per project (${Object.entries(C.weights).map(([k,v])=>`${k} ${v}h`).join(", ")}) + open actions (${C.actionHours}h, urgent ${C.urgentHours}h, or the hours the team enters) + meetings this week. Nobody is marked overloaded on action count alone. <b>Email activity is used only to understand what work an issue needs, never to measure or rank individual performance.</b>`;
}
function supportArea(k){
  const r = (T(k).role||"").toLowerCase();
  if(/tool/.test(r)) return "Tooling follow-up and trial support on critical tooling issues";
  if(/rfq|quot/.test(r)) return "Quotation and supplier follow-ups for other engineers";
  if(/doc|dcc|drawing/.test(r)) return "ECO, drawing and documentation follow-ups";
  if(/market|sales|customer/.test(r)) return "Customer communication and quotation follow-up";
  return "Supplier chasing, samples, documentation and meeting follow-ups";
}
function meter(p){ const w=Math.min(100,p.load*100); return `<div class="meter"><i class="${p.load>1?"over":p.load>0.85?"near":""}" style="width:${w}%"></i></div>`; }
function openEvidence(k){
  const p = personModel(k), t = todayISO();
  $("popTitle").textContent = `Workload evidence · ${T(k).name}`;
  $("popSub").textContent = T(k).role || "";
  const box = (l,v,h) => `<div><span class="eyebrow">${l}</span><b class="${h?"hot":""}">${v}</b></div>`;
  const rows = p.projs.slice().sort((a,b)=>(CXW[b.complexity]||0)-(CXW[a.complexity]||0)).map(x=>`<tr data-pid="${esc(x.id)}"><td><b>${esc(x.name)}</b></td><td>${esc(x.customer||"—")}</td><td><span class="cx ${esc(x.complexity||"low")}">${esc((x.complexity||"low").toUpperCase())}</span><div class="conf">${esc(x.healthLabel||"")}</div></td><td style="min-width:200px">${(x.activities||[]).map(a=>"• "+esc(a)).join("<br>")}</td><td class="nowrap">${x.asap?'<span class="mono late">ASAP</span>':x.due?dueHtml(x):"—"}</td><td><span class="pill ${esc(x.health)}">${esc({ok:"Low",warn:"Medium",bad:"High"}[x.health]||"")}</span></td></tr>`).join("");
  $("popBody").innerHTML = `
    <div class="exec-top"><span class="badge ${p.status.split(" ")[0]}">${p.status}</span><span class="conf">Confidence: <b>${p.conf}</b></span></div>
    <p class="txt">${p.signals.length ? "Evidence: "+esc(p.signals.join("; "))+"." : "No independent workload indicator is high."} ${p.why?esc(p.why):""}</p>
    <div class="ev-grid">
      ${box("Active projects",p.activeProjects,p.activeProjects>=5)}${box("Open actions",p.openActions)}${box("Est. hours/week",p.est+"h",p.load>1)}${box("Urgent",p.urgent,p.urgent>=2)}${box("At risk",p.atRisk,p.atRisk>=1)}
      ${box("Customer issues",p.custIssues,p.custIssues>=1)}${box("Supplier issues",p.suppIssues)}${box("Issue threads",p.threads)}${box("Escalations",p.escalations,p.escalations>=1)}${box("Due ≤ 7 days",p.due7,p.due7>=3)}
    </div>
    <div class="conf">Estimate: ${p.est}h/week vs ~${p.cap}h available for project work${p.mgmtH?` (incl. ${p.mgmtH}h management)`:""}. Hours entered by the team for ${Math.round(p.hoursCoverage*100)}% of open actions.</div>
    <div><h3>Current major activities</h3>${rows?`<div class="tbl-scroll" style="margin-top:6px"><table class="wl"><thead><tr><th>Project</th><th>Customer</th><th>Issue</th><th>Activity</th><th>Deadline</th><th>Risk</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<p class="txt">No projects owned.</p>`}</div>
    ${p.acts.length?`<div><h3>Open actions (${p.acts.length})</h3><div class="panel" style="margin-top:6px">${p.acts.map(actionRow).join("")}</div></div>`:""}
    ${p.meets.length?`<div><h3>Meetings in the next 7 days</h3><p class="txt">${p.meets.map(m=>`${fmtDate(m.date)} ${esc(m.time||"")} · ${esc(m.title)}`).join("<br>")}</p></div>`:""}
    <p class="conf">Used for workload planning only — not a performance measure.</p>`;
  popPid = ""; const dlg=$("pop"); if(!dlg.open) dlg.showModal(); $("popBody").scrollTop=0;
}

/* ---------- project pop-up ---------- */
let popPid = "";
function openProject(pid){
  const x = D.projects.find(p=>p.id===pid); if(!x) return;
  popPid = pid;
  $("popTitle").textContent = x.name;
  $("popSub").textContent = [x.customer, "Owner: "+T(x.owner).name].filter(Boolean).join(" · ");
  const STOP = new Set(["project","tool","tools","tooling","sample","samples","parts","part","range","trial","build","label","labels","quote","with","from","after","new","order","spec","rentokil","keysight","agilent","broadcom","almy","exzone","lumnia","assembly","cover","body","update","issue","validation","dimension","measurement"]);
  const words = x.name.toLowerCase().split(/[^a-z0-9-]+/).filter(w=>w.length>3 && !STOP.has(w));
  const hit = t => { t=(t||"").toLowerCase(); return words.some(w=>t.includes(w)); };
  const rel = allActions().filter(a=>a.project===pid || hit(a.text) || hit(a.tag)).sort((a,b)=>(!!a.done)-(!!b.done));
  const notes = feedItems(pid).slice(0,15);
  const meets = D.meetings.filter(m=>m.date>=todayISO() && hit(m.title+" "+(m.sub||""))).slice(0,5);
  $("popBody").innerHTML = `
    <div class="facts">
      <div><span class="eyebrow">Stage</span><b>${esc(STAGES[x.stage]||"")}</b></div>
      <div><span class="eyebrow">Status</span><b><span class="pill ${esc(x.health)}">${esc(x.healthLabel||HL[x.health]||"")}</span></b></div>
      <div><span class="eyebrow">Due</span><b>${x.asap?'<span class="mono late">ASAP</span>':x.due?dueHtml(x):"—"}</b></div>
      <div><span class="eyebrow">Last update</span><b>${x.updatedAt?esc(fmtDate(x.updatedAt)):"—"}</b></div>
    </div>
    <div>${stageBar(x.stage)}</div>
    ${x.update?`<div><h3>Status</h3><p class="txt">${esc(x.update)}</p></div>`:""}
    ${(x.activities||[]).length?`<div><h3>Issue activity <span class="cx ${esc(x.complexity||"low")}" style="vertical-align:1px">${esc((x.complexity||"low").toUpperCase())}</span></h3><p class="txt">${x.activities.map(esc).join(" · ")}${x.threads?` <span class="conf">(${x.threads} email thread${x.threads>1?"s":""})</span>`:""}</p></div>`:""}
    ${x.next?`<div><h3>Next step</h3><p class="txt">${esc(x.next)} ${dueHtml(x)}</p></div>`:""}
    ${meets.length?`<div><h3>Coming up</h3><div class="panel">${meets.map(m=>`<div class="row two"><div class="when">${fmtDate(m.date).split(" ").slice(1).join(" ")}<b>${esc(m.time||"—")}</b></div><div><div class="t">${esc(m.title)}</div><div class="s">${esc(m.sub||"")}</div></div></div>`).join("")}</div></div>`:""}
    ${rel.length?`<div><h3>Related actions</h3><div class="panel" id="popActs">${rel.slice(0,10).map(actionRow).join("")}</div></div>`:""}
    <div><h3>Updates on this project</h3><div class="panel">
      <form class="addrow" id="popPost" autocomplete="off"><textarea class="field" id="popText" placeholder="Post a progress update on ${esc(x.name)}…" maxlength="600" aria-label="Progress update"></textarea><div class="line"><button class="btn primary" type="submit" ${SCRIPT_URL?"":"disabled"}>Post update</button></div></form>
      <div class="feed">${notes.length?notes.map(feedRow).join(""):`<div class="empty">No updates yet.</div>`}</div>
    </div></div>`;
  const dlg = $("pop"); if(!dlg.open) dlg.showModal();
  $("popBody").scrollTop = 0;
}
$("popX").onclick = ()=>$("pop").close();
$("pop").addEventListener("click", e=>{ if(e.target===$("pop")) $("pop").close(); });
$("pop").addEventListener("close", ()=>{ popPid=""; });
$("pop").addEventListener("submit", async e=>{
  if(e.target.id!=="popPost") return;
  e.preventDefault();
  const text=$("popText").value.trim(); if(!text){ $("popText").focus(); return; }
  if(await send({op:"post", text, project:popPid}, "Update posted")) openProject(popPid);
});
$("pop").addEventListener("change", async e=>{
  const c = e.target.closest(".check"); if(!c) return;
  const ok = await send({op:"setDone", id:c.dataset.id, done:c.checked});
  if(!ok) c.checked = !c.checked; else if(popPid) openProject(popPid);
});

/* tooltip */
(function(){
  const tip=$("tip");
  function show(el, x, y){ tip.innerHTML=el.dataset.tip; tip.hidden=false; const r=tip.getBoundingClientRect(); let L=x+12, T2=y+12; if(L+r.width>innerWidth-8) L=x-r.width-12; if(T2+r.height>innerHeight-8) T2=y-r.height-12; tip.style.left=Math.max(8,L)+"px"; tip.style.top=Math.max(8,T2)+"px"; }
  document.addEventListener("pointermove", e=>{ if(e.pointerType==="touch") return; const el=e.target.closest("[data-tip]"); if(el) show(el,e.clientX,e.clientY); else tip.hidden=true; });
  document.addEventListener("focusin", e=>{ const el=e.target.closest("[data-tip]"); if(el && el.matches(":focus-visible")){ const r=el.getBoundingClientRect(); show(el, r.left+r.width/2, r.bottom); } });
  document.addEventListener("focusout", ()=>tip.hidden=true);
  document.addEventListener("scroll", ()=>tip.hidden=true, {passive:true});
})();

/* clock (Malaysia time) */
(function(){
  const fd = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kuala_Lumpur",weekday:"short",day:"2-digit",month:"short",year:"numeric"});
  const ft = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kuala_Lumpur",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
  const tick = ()=>{ const n=new Date(); $("clkD").textContent=fd.format(n).replace(/,/g,""); $("clkT").textContent=ft.format(n); };
  tick(); setInterval(tick, 1000);
})();

/* ---------- interactions ---------- */
let toastT;
function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2800) }
function menu(open){ $("meMenu").hidden=!open; $("meBtn").setAttribute("aria-expanded", String(open)); }
document.addEventListener("click", e=>{
  if(!e.target.closest(".menu")) menu(false);
  if(e.target.closest("#meBtn")){ menu($("meMenu").hidden); return; }
  const nv = e.target.closest("#nav a, a.brand");
  if(nv){ e.preventDefault(); go(nv.dataset.view || "summary"); return; }
  const f = e.target.closest(".chip,.person,button.hbar[data-k]");
  if(f){ const k=f.dataset.k; filter=(filter===k&&k!=="all")?"all":k; render(); return; }
  const wh = e.target.closest("[data-who]");
  if(wh){ openEvidence(wh.dataset.who); return; }
  const hb = e.target.closest("[data-hrs]");
  if(hb){ e.preventDefault(); const cur=hb.dataset.cur||""; const v=prompt("Estimated hours still needed to finish this action?", cur); if(v!==null){ const h=parseFloat(v); if(isNaN(h)||h<0||h>200){ toast("Enter hours between 0 and 200"); } else send({op:"setHours", id:hb.dataset.hrs, hours:h}, "Hours saved"); } return; }
  const pid = e.target.closest("[data-pid]");
  if(pid && !e.target.closest(".check,label,[data-del]")){ e.preventDefault(); openProject(pid.dataset.pid); return; }
  const g = e.target.closest("[data-go]"); if(g){ go(g.dataset.go); return; }
  const kp = e.target.closest("[data-kpi]");
  if(kp){ const k=kp.dataset.kpi; if(k==="actions"||k==="calendar"){ aShow="open"; go(k); } else { hF = k==="all"?"":k; sF=""; $("hFilter").value=hF; $("sFilter").value=""; renderProjects(); go("projects"); } return; }
  const st = e.target.closest("[data-stage]");
  if(st){ sF=st.dataset.stage; hF=""; $("sFilter").value=sF; $("hFilter").value=""; renderProjects(); go("projects"); return; }
  const cu = e.target.closest("[data-cust]");
  if(cu){ q=cu.dataset.cust==="Internal / other"?"":cu.dataset.cust; $("q").value=q; hF="";sF=""; $("hFilter").value="";$("sFilter").value=""; renderProjects(); go("projects"); return; }
  const lb = e.target.closest("[data-layout]"); if(lb){ layout=lb.dataset.layout; store.set("npi-layout",layout); renderProjects(); renderView(); return; }
  const as = e.target.closest("[data-ashow]"); if(as){ aShow=as.dataset.ashow; renderActions(); renderView(); return; }
  const th = e.target.closest("th[data-sort]"); if(th){ const k=th.dataset.sort; sortDir = sortK===k ? -sortDir : 1; sortK=k; renderProjects(); return; }
  const d = e.target.closest("[data-del]");
  if(d){ if(d.dataset.armed){ send({op:"deleteTask", id:d.dataset.del}, "Task removed"); } else { d.dataset.armed="1"; d.textContent="Tap again"; } return; }
  if(e.target.id==="moreFeed"){ feedLimit+=25; renderFeed(); }
});
document.addEventListener("keydown", e=>{
  if(e.key==="Escape"){ menu(false); }
  const tr = e.target.closest && e.target.closest("tr[data-pid]");
  if(tr && (e.key==="Enter"||e.key===" ")){ e.preventDefault(); openProject(tr.dataset.pid); }
});
window.addEventListener("hashchange", ()=>{ const v=location.hash.slice(1); if(VIEWS.includes(v) && v!==view) go(v); });
$("q").addEventListener("input", e=>{ q=e.target.value.trim(); renderProjects(); });
$("hFilter").onchange = e=>{ hF=e.target.value; renderProjects(); };
$("sFilter").onchange = e=>{ sF=e.target.value; renderProjects(); };
$("whoami").onchange = e=>{ me=e.target.value; store.set("npi-me", me); render(); };
$("deskBtn").onclick = ()=>{ desk=!desk; store.set("npi-desk-set","1"); store.set("npi-desk", desk?"1":""); renderView(); };
$("actions").addEventListener("change", async e=>{
  const c = e.target.closest(".check"); if(!c) return;
  const ok = await send({op:"setDone", id:c.dataset.id, done:c.checked});
  if(!ok) c.checked = !c.checked;
});
$("actForm").onsubmit = async e=>{
  e.preventDefault();
  const text=$("actText").value.trim(); if(!text){ $("actText").focus(); return; }
  if(await send({op:"addTask", text, owner:$("actOwner").value, tag:$("actTag").value.trim(), urgent:$("actUrgent").checked}, "Task added")){
    $("actText").value=""; $("actTag").value=""; $("actUrgent").checked=false;
  }
};
$("postForm").onsubmit = async e=>{
  e.preventDefault();
  const text=$("postText").value.trim(); if(!text){ $("postText").focus(); return; }
  if(await send({op:"post", text, project:$("postProj").value}, "Update posted")) $("postText").value="";
};
$("refresh").onclick = async ()=>{ menu(false); try{ D = await loadTracker(code); }catch(e){} await loadTeam(); render(); toast("Up to date"); };
$("logout").onclick = ()=>{ store.set("npi-code",""); location.reload(); };

/* ---------- start ---------- */
document.body.classList.toggle("desk", desk);
async function open(pass){
  D = await loadTracker(pass);
  code = pass; store.set("npi-code", pass);
  $("lock").hidden = true; $("app").hidden = false;
  render();
  await loadTeam(); render();
  if(!me) setTimeout(()=>{ menu(true); $("whoami").focus(); }, 300);
}
$("lockForm").onsubmit = async e=>{
  e.preventDefault();
  const btn=$("lockBtn"), err=$("lockErr"); btn.disabled=true; err.hidden=true; btn.textContent="Signing in…";
  try{ await open($("code").value.trim()); }
  catch(x){ err.hidden=false; err.textContent = x.message==="badcode" ? "That passcode isn't right. Check with Rashid." : "Couldn't load the tracker. Check your connection."; }
  btn.disabled=false; btn.textContent="Sign in";
};
if(code){ open(code).catch(()=>{ store.set("npi-code",""); }); }
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && D) loadTeam().then(render); });

/* ---------- version, updates, install ---------- */
const APP_VERSION = "2.2";
const CHANGES = [
  {v:"2.2", date:"8 Oct 2026", items:["New Workload page: evidence-based assessment (Normal / High / Potential overload / Overloaded / Critical) with confidence level","Overload is judged on effort, issue complexity, concurrent projects and customers, escalations and due dates — not on action count","Tap a person (Workload page or Summary) for their workload evidence and current major activities","Each project shows its issue complexity and the activities needed to close it, from grouped email threads","Add estimated hours to any open action with “+ hrs”"]},
  {v:"2.1", date:"5 Oct 2026", items:["Tracker now reads every email in the inbox and sent items, not only team emails","Shows how many emails the last refresh read (name menu and Updates page)","Added missed projects: Sustainable hygiene range, Project Sub Zero, Bail Handle, IR cover, Avialite, Front Frame waiver, Eliminair, Gear Housing 166"]},
  {v:"2.0", date:"5 Oct 2026", items:[
    "New look matching BOM Studio: top menu, live clock and a name menu",
    "Summary tiles, pipeline and customer bars open the matching project list when clicked",
    "Projects register with search, status and stage filters, and Cards / Table view (sortable)",
    "Click any project for a pop-up with status, related actions, meetings and an update box",
    "Actions grouped by person with Open / Done / All; Calendar grouped by day with due dates",
    "Desktop mode (full width) and Install on this computer",
    "Update notice when a new version is published, plus this What's new page"]},
  {v:"1.1", date:"30 Sep 2026", items:["Summary dashboard: pipeline, needs attention, next 14 days, workload, customers","New Gen NPI branding"]},
  {v:"1.0", date:"26 Sep 2026", items:["First release: projects, actions, meetings and team updates"]}
];
$("verTag").textContent = "v"+APP_VERSION; $("verFoot").textContent = "NPI Tracker v"+APP_VERSION;
function showNews(){
  $("newsSub").textContent = "You're on version "+APP_VERSION;
  $("newsBody").innerHTML = CHANGES.map(c=>`<div class="news-ver"><h3>v${c.v} <span class="eyebrow" style="text-transform:none">${c.date}</span></h3><ul>${c.items.map(i=>`<li>${esc(i)}</li>`).join("")}</ul></div>`).join("");
  menu(false); if(!$("news").open) $("news").showModal();
  store.set("npi-ver", APP_VERSION);
}
$("newsBtn").onclick = showNews;
$("newsX").onclick = ()=>$("news").close();
$("news").addEventListener("click", e=>{ if(e.target===$("news")) $("news").close(); });
// Show "What's new" once after an update (existing users only)
(function(){ const seen = store.get("npi-ver"); if(seen===APP_VERSION) return;
  if(seen || store.get("npi-code")){ const t=setInterval(()=>{ if(!$("app").hidden){ clearInterval(t); setTimeout(showNews, 700); } }, 400); }
  else store.set("npi-ver", APP_VERSION); })();

let swReg = null, reloading = false, updating = false;
function offerUpdate(){ $("toast").hidden = true; $("updBar").hidden = false; }
$("updLater").onclick = ()=>{ $("updBar").hidden = true; };
$("updNow").onclick = ()=>{
  const w = swReg && swReg.waiting;
  updating = true;
  if(w) w.postMessage({type:"SKIP_WAITING"}); else location.reload();
  $("updNow").disabled = true; $("updNow").textContent = "Updating…";
};
$("checkBtn").onclick = async ()=>{
  menu(false);
  if(!swReg){ location.reload(); return; }
  toast("Checking for updates…");
  try{ await swReg.update(); }catch(e){}
  setTimeout(()=>{ if(swReg.waiting || swReg.installing) offerUpdate(); else toast("You're on the latest version (v"+APP_VERSION+")"); }, 1500);
};
if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").then(reg=>{
    swReg = reg;
    if(reg.waiting && navigator.serviceWorker.controller) offerUpdate();
    reg.addEventListener("updatefound", ()=>{
      const nw = reg.installing; if(!nw) return;
      nw.addEventListener("statechange", ()=>{ if(nw.state==="installed" && navigator.serviceWorker.controller) offerUpdate(); });
    });
    setInterval(()=>reg.update().catch(()=>{}), 30*60*1000);          // check every 30 min
    document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) reg.update().catch(()=>{}); });
  }).catch(()=>{});
  navigator.serviceWorker.addEventListener("controllerchange", ()=>{ if(!updating || reloading) return; reloading = true; location.reload(); });
}
// Install as a desktop / phone app (Chrome, Edge)
let installEvt = null;
window.addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); installEvt = e; $("installBtn").hidden = false; });
window.addEventListener("appinstalled", ()=>{ $("installBtn").hidden = true; toast("Installed. Open NPI Tracker from your desktop or Start menu."); });
$("installBtn").onclick = async ()=>{ menu(false); if(!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(()=>{}); installEvt = null; $("installBtn").hidden = true; };
// Default to full width on large screens the first time
if(!store.get("npi-desk-set") && window.innerWidth >= 1600){ desk = true; store.set("npi-desk","1"); }
store.set("npi-desk-set","1");
