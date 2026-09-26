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
  if(!me){ toast("Choose your name under “I am” first"); $("whoami").focus(); return false; }
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

/* ---------- render ---------- */
function render(){
  $("whoami").innerHTML = ownerOptions(me, true);
  $("whoWrap").classList.toggle("need", !me);
  $("syncStamp").textContent = D.lastSync ? `${fmtDate(D.lastSync)} ${D.lastSync.slice(11,16)}` : "—";
  const ao = $("actOwner").value; $("actOwner").innerHTML = ownerOptions(ao || me || (filter!=="all"?filter:"rashid"), false);
  const pp = $("postProj").value;
  $("postProj").innerHTML = `<option value="">General update (no project)</option>` + D.projects.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${esc(p.id)}" ${p.id===pp?"selected":""}>${esc(p.name)}</option>`).join("");
  const b = $("banner");
  if(!SCRIPT_URL){ b.hidden=false; b.className="banner"; b.textContent="Adding tasks and posting updates will be switched on shortly. You can view the tracker now."; }
  else if(!teamOk){ b.hidden=false; b.className="banner warn"; b.textContent="Couldn't reach the team list. Showing the last saved copy; tasks and ticks may be out of date."; }
  else b.hidden=true;
  document.querySelectorAll("#actForm button,#postForm button").forEach(x=>x.disabled=!SCRIPT_URL);
  renderFilters(); renderSummary(); renderPeople(); renderProjects(); renderActions(); renderMeetings(); renderFeed();
}
function renderFilters(){
  $("filters").innerHTML = ["all",...teamKeys()].map(k=>`<button class="chip" type="button" aria-pressed="${filter===k}" data-k="${k}">${k==="all"?"Whole team":av(k)+esc(T(k).short)}</button>`).join("");
}
function renderSummary(){
  const p = D.projects.filter(x=>match(x.owner));
  const open = allActions().filter(a=>match(a.owner)&&!a.done).length;
  const t = todayISO(), wk = new Date(dt(t).getTime()+7*864e5); const wkS = `${wk.getFullYear()}-${pad(wk.getMonth()+1)}-${pad(wk.getDate())}`;
  const m = D.meetings.filter(x=>(filter==="all"||(x.who||[]).includes(filter)) && x.date>=t && x.date<=wkS).length;
  $("summary").innerHTML = `
    <div><span class="eyebrow">Active projects</span><b>${p.length}</b></div>
    <div class="bad"><span class="eyebrow">At risk / blocked</span><b>${p.filter(x=>x.health==="bad").length}</b></div>
    <div class="warn"><span class="eyebrow">Open actions</span><b>${open}</b></div>
    <div><span class="eyebrow">Next 7 days</span><b>${m}</b></div>`;
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
function renderProjects(){
  const order={bad:0,warn:1,ok:2}, hl={ok:"On track",warn:"Watch",bad:"At risk"};
  const list = D.projects.filter(x=>match(x.owner)).sort((a,b)=>(order[a.health]??3)-(order[b.health]??3) || (a.due||"9").localeCompare(b.due||"9"));
  $("projCount").textContent = `${list.length} shown`;
  $("projects").innerHTML = list.length ? list.map(x=>{
    const n = latestNote(x.id, x.updatedAt);
    return `<article class="proj" data-h="${esc(x.health)}">
      <div><h3>${esc(x.name)}</h3><div class="meta"><span>${esc(x.customer||"")}</span><span>Owner: ${esc(T(x.owner).short)}</span></div></div>
      <div class="side"><span class="pill ${esc(x.health)}">${esc(x.healthLabel||hl[x.health]||"")}</span><button class="linkbtn" type="button" data-post="${esc(x.id)}">Post update</button></div>
      <div class="stages" aria-label="Stage: ${STAGES[x.stage]||""}">${STAGES.map((s,i)=>`<span class="${i<x.stage?"done":i===x.stage?"now":""}"></span>`).join("")}</div>
      <div class="stage-labels" aria-hidden="true">${STAGES.map((s,i)=>`<span class="${i===x.stage?"now":""}">${s}</span>`).join("")}</div>
      ${x.update?`<div class="update">${esc(x.update)}</div>`:""}
      ${n?`<div class="note"><b>${esc(T(n.owner).short)}, ${fmtDate(n.at)}:</b> ${esc(n.text)}</div>`:""}
      ${x.next||x.due||x.asap?`<div class="next"><span class="eyebrow">Next</span><span>${esc(x.next||"")}</span>${dueHtml(x)}</div>`:""}
    </article>`}).join("") : `<div class="empty">No projects for ${esc(T(filter).short)} yet. Post an update and Rashid's Claude will add it.</div>`;
}
function renderActions(){
  const list = allActions().filter(x=>match(x.owner)).sort((x,y)=>(!!x.done)-(!!y.done) || (!!y.urgent)-(!!x.urgent) || String(x.createdAt||"").localeCompare(String(y.createdAt||"")));
  const shown = list.filter(x=>!x.done).concat(list.filter(x=>x.done).slice(0,5));
  $("actions").innerHTML = shown.length ? shown.map(x=>`
    <div class="row ${x.done?"done":""}">
      <input type="checkbox" class="check" id="c-${esc(x.id)}" data-id="${esc(x.id)}" ${x.done?"checked":""} ${SCRIPT_URL?"":"disabled"} aria-label="Done">
      <label for="c-${esc(x.id)}"><div class="t">${esc(x.text)}</div><div class="s">${x.urgent&&!x.done?'<span class="tag bad">Urgent</span>':""}${x.tag?`<span class="tag">${esc(x.tag)}</span>`:""}${esc(T(x.owner).short)}${x.done&&x.doneBy?` · done by ${esc(T(x.doneBy).short)}`:""}</div></label>
      ${x.src==="team"&&SCRIPT_URL&&(x.createdBy===me||x.owner===me)?`<button class="linkbtn" type="button" data-del="${esc(x.id)}" aria-label="Remove task">Remove</button>`:"<span></span>"}
    </div>`).join("") : `<div class="empty">No actions.</div>`;
}
function renderMeetings(){
  const t = todayISO();
  const list = D.meetings.filter(x=>x.date>=t && (filter==="all"||(x.who||[]).includes(filter))).sort((a,b)=>(a.date+(a.time||"")).localeCompare(b.date+(b.time||""))).slice(0,12);
  $("meetings").innerHTML = list.length ? list.map(x=>{ const d=dt(x.date); return `
    <div class="row two"><div class="when">${DOW[d.getDay()]}<b>${d.getDate()} ${MON[d.getMonth()]}</b>${esc(x.time||"")}</div>
    <div><div class="t">${esc(x.title)}</div><div class="s">${esc(x.sub||"")}${(x.who||[]).length?" · "+x.who.map(k=>esc(T(k).short)).join(", "):""}</div></div></div>`}).join("")
    : `<div class="empty">Nothing scheduled.</div>`;
}
function renderFeed(){
  const pname = id => (D.projects.find(p=>p.id===id)||{}).name;
  const all = (D.feed||[]).map(f=>({...f})).concat((TD.updates||[]).map(u=>({...u, kind:"post"})))
    .filter(x=>match(x.owner)).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  const list = all.slice(0, feedLimit);
  $("feed").innerHTML = (list.length ? list.map(x=>{ const d=dt(x.at); return `
    <div class="row">${av(x.owner)}
      <div class="when">${d.getDate()} ${MON[d.getMonth()]}<br>${esc(String(x.at).slice(11,16))}</div>
      <div><div class="t">${esc(x.text)}</div><div class="s">${x.kind==="post"?'<span class="tag post">Update</span>':'<span class="tag">Email</span>'}${esc(T(x.owner).short)}${x.sub?" · "+esc(x.sub):""}${x.project&&pname(x.project)?" · "+esc(pname(x.project)):""}</div></div>
    </div>`}).join("") : `<div class="empty">No activity yet.</div>`)
    + (all.length>feedLimit?`<div class="more"><button class="linkbtn" type="button" id="moreFeed">Show more</button></div>`:"");
}

/* ---------- interactions ---------- */
let toastT;
function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2800) }
document.addEventListener("click", e=>{
  const f = e.target.closest(".chip,.person");
  if(f){ const k=f.dataset.k; filter=(filter===k&&k!=="all")?"all":k; render(); return; }
  const p = e.target.closest("[data-post]");
  if(p){ $("postProj").value=p.dataset.post; $("updates").scrollIntoView({behavior:"smooth"}); setTimeout(()=>$("postText").focus(),350); return; }
  const d = e.target.closest("[data-del]");
  if(d){ if(d.dataset.armed){ send({op:"deleteTask", id:d.dataset.del}, "Task removed"); } else { d.dataset.armed="1"; d.textContent="Tap again"; } return; }
  if(e.target.id==="moreFeed"){ feedLimit+=25; renderFeed(); }
});
$("whoami").onchange = e=>{ me=e.target.value; store.set("npi-me", me); render(); };
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
$("refresh").onclick = async ()=>{ $("refresh").disabled=true; try{ D = await loadTracker(code); }catch(e){} await loadTeam(); render(); $("refresh").disabled=false; toast("Up to date"); };
$("logout").onclick = ()=>{ store.set("npi-code",""); location.reload(); };

/* ---------- start ---------- */
async function open(pass){
  D = await loadTracker(pass);
  code = pass; store.set("npi-code", pass);
  $("lock").hidden = true; $("app").hidden = false;
  render();
  await loadTeam(); render();
}
$("lockForm").onsubmit = async e=>{
  e.preventDefault();
  const btn=$("lockBtn"), err=$("lockErr"); btn.disabled=true; err.hidden=true; btn.textContent="Opening…";
  try{ await open($("code").value.trim()); }
  catch(x){ err.hidden=false; err.textContent = x.message==="badcode" ? "That passcode isn't right. Check with Rashid." : "Couldn't load the tracker. Check your connection."; }
  btn.disabled=false; btn.textContent="Open tracker";
};
if(code){ open(code).catch(()=>{ store.set("npi-code",""); }); }
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && D) loadTeam().then(render); });
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
