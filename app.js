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
const VIEWS = ["summary","projects","actions","calendar","updates"];
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
  renderFilters(); renderKpis(); renderDash(); renderPeople(); renderProjects(); renderActions(); renderMeetings(); renderFeed(); renderView();
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
    <label for="c-${esc(x.id)}"><div class="t">${esc(x.text)}</div><div class="s">${x.urgent&&!x.done?'<span class="tag bad">Urgent</span>':""}${x.tag?`<span class="tag">${esc(x.tag)}</span>`:""}${esc(T(x.owner).short)}${x.src==="team"&&x.createdBy&&x.createdBy!==x.owner?` · added by ${esc(T(x.createdBy).short)}`:""}${x.done&&x.doneBy?` · done by ${esc(T(x.doneBy).short)}`:""}</div></label>
    ${x.src==="team"&&SCRIPT_URL&&(x.createdBy===me||x.owner===me)?`<button class="linkbtn" type="button" data-del="${esc(x.id)}" aria-label="Remove task">Remove</button>`:"<span></span>"}
  </div>`;
}
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

  const acts = allActions();
  const rows = teamKeys().map(k=>({k, open:acts.filter(a=>a.owner===k&&!a.done).length, urgent:acts.filter(a=>a.owner===k&&!a.done&&a.urgent).length, p:D.projects.filter(x=>x.owner===k).length, r:D.projects.filter(x=>x.owner===k&&x.health==="bad").length}))
    .sort((a,b)=>b.open-a.open || b.p-a.p);
  const wmax = Math.max(1,...rows.map(r=>r.open));
  $("workload").innerHTML = rows.map(r=>`<button type="button" class="hbar" data-k="${r.k}" aria-pressed="${filter===r.k}" data-tip="${esc(`<b>${esc(T(r.k).name)}</b><br>${r.open} open action${r.open===1?"":"s"}${r.urgent?` (${r.urgent} urgent)`:""}<br>${r.p} project${r.p===1?"":"s"}${r.r?`, ${r.r} at risk`:""}`)}" style="${filter!=="all"&&filter!==r.k?"opacity:.45":""}">
      <span class="lbl">${esc(T(r.k).short)}</span><span class="track"><span class="fill" style="width:${r.open/wmax*100}%"></span></span><span class="val">${r.open}${r.r?`<em>${r.r} risk</em>`:""}</span></button>`).join("");

  const byC = {}; projs.forEach(p=>{ const c=p.customer||"Internal / other"; (byC[c]=byC[c]||[]).push(p); });
  const crow = Object.entries(byC).sort((a,b)=>b[1].length-a[1].length);
  const cmax = Math.max(1,...crow.map(c=>c[1].length));
  $("customers").innerHTML = crow.length ? crow.map(([c,ps])=>{ const r=ps.filter(p=>p.health==="bad").length;
    return `<button type="button" class="hbar" data-cust="${esc(c)}" data-tip="${esc(`<b>${esc(c)}: ${ps.length}</b><br>`+ps.slice(0,6).map(p=>esc(p.name)).join("<br>")+(ps.length>6?`<br>+${ps.length-6} more`:""))}"><span class="lbl">${esc(c)}</span><span class="track"><span class="fill" style="width:${ps.length/cmax*100}%"></span></span><span class="val">${ps.length}${r?`<em>${r} risk</em>`:""}</span></button>`}).join("") : `<div class="empty" style="padding:0">No projects.</div>`;
}

/* ---------- project pop-up ---------- */
let popPid = "";
function openProject(pid){
  const x = D.projects.find(p=>p.id===pid); if(!x) return;
  popPid = pid;
  $("popTitle").textContent = x.name;
  $("popSub").textContent = [x.customer, "Owner: "+T(x.owner).name].filter(Boolean).join(" · ");
  const words = [x.customer, x.name].filter(Boolean).flatMap(s=>s.toLowerCase().split(/[^a-z0-9]+/)).filter(w=>w.length>3);
  const rel = allActions().filter(a=>a.project===pid || (a.tag && words.some(w=>a.tag.toLowerCase().includes(w)))).sort((a,b)=>(!!a.done)-(!!b.done));
  const notes = feedItems(pid).slice(0,15);
  const meets = D.meetings.filter(m=>m.date>=todayISO() && words.some(w=>(m.title+" "+(m.sub||"")).toLowerCase().includes(w))).slice(0,5);
  $("popBody").innerHTML = `
    <div class="facts">
      <div><span class="eyebrow">Stage</span><b>${esc(STAGES[x.stage]||"")}</b></div>
      <div><span class="eyebrow">Status</span><b><span class="pill ${esc(x.health)}">${esc(x.healthLabel||HL[x.health]||"")}</span></b></div>
      <div><span class="eyebrow">Due</span><b>${x.asap?'<span class="mono late">ASAP</span>':x.due?dueHtml(x):"—"}</b></div>
      <div><span class="eyebrow">Last update</span><b>${x.updatedAt?esc(fmtDate(x.updatedAt)):"—"}</b></div>
    </div>
    <div>${stageBar(x.stage)}</div>
    ${x.update?`<div><h3>Status</h3><p class="txt">${esc(x.update)}</p></div>`:""}
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
  if(e.key==="Escape") menu(false);
  const tr = e.target.closest && e.target.closest("tr[data-pid]");
  if(tr && (e.key==="Enter"||e.key===" ")){ e.preventDefault(); openProject(tr.dataset.pid); }
});
window.addEventListener("hashchange", ()=>{ const v=location.hash.slice(1); if(VIEWS.includes(v) && v!==view) go(v); });
$("q").addEventListener("input", e=>{ q=e.target.value.trim(); renderProjects(); });
$("hFilter").onchange = e=>{ hF=e.target.value; renderProjects(); };
$("sFilter").onchange = e=>{ sF=e.target.value; renderProjects(); };
$("whoami").onchange = e=>{ me=e.target.value; store.set("npi-me", me); render(); };
$("deskBtn").onclick = ()=>{ desk=!desk; store.set("npi-desk", desk?"1":""); renderView(); };
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
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
