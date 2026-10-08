/**
 * Exzone NPI Tracker — team data backend (Google Apps Script)
 *
 * Stores what the team adds in the app (tasks, ticks, progress updates)
 * in this Google Sheet. The app talks to it through the web app URL.
 *
 * SETUP (once):
 *  1. Change TEAM_CODE below to the same passcode the team uses in the app.
 *  2. Click Save, then run the "setup" function once (Run ▶) and allow access.
 *  3. Deploy → New deployment → type "Web app"
 *       Execute as: Me      Who has access: Anyone
 *     Copy the Web app URL and send it to Claude.
 *  If you change the code later: Deploy → Manage deployments → Edit → Version: New version.
 */

const TEAM_CODE = 'CHANGE-ME'; // set your passcode here (not stored in GitHub)

const TEAM = ['rashid','fadzmi','liyana','yusri','zul','fakrul','wajdi','hairus','rajoo','ainin','shamsuri','helen'];

const TABS = {
  Tasks:   ['id','owner','text','tag','urgent','createdAt','createdBy','deleted'],
  Status:  ['id','done','by','at'],
  Updates: ['id','at','owner','text','project'],
  Effort:  ['id','hours','by','at']
};

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const first = ss.getSheets()[0];
  if (!ss.getSheetByName('Tasks') && !TABS[first.getName()]) { first.clear(); first.setName('Tasks'); }
  Object.keys(TABS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.code !== TEAM_CODE) return out_({ ok: false, error: 'bad_code' });
  return out_(snapshot_());
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad_request' }); }
  if (!b || b.code !== TEAM_CODE) return out_({ ok: false, error: 'bad_code' });
  const who = clean_(b.me, 20);
  if (TEAM.indexOf(who) < 0) return out_({ ok: false, error: 'unknown_person' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const now = stamp_();
    if (b.op === 'addTask') {
      const owner = TEAM.indexOf(b.owner) >= 0 ? b.owner : who;
      const text = clean_(b.text, 200);
      if (!text) return out_({ ok: false, error: 'empty' });
      append_('Tasks', { id: 't-' + Utilities.getUuid().slice(0, 8), owner: owner, text: text, tag: clean_(b.tag, 30),
                         urgent: b.urgent ? 'TRUE' : 'FALSE', createdAt: now, createdBy: who, deleted: '' });
    } else if (b.op === 'setDone') {
      const id = clean_(b.id, 60);
      if (!id) return out_({ ok: false, error: 'no_id' });
      upsert_('Status', 'id', id, { id: id, done: b.done ? 'TRUE' : 'FALSE', by: who, at: now });
    } else if (b.op === 'deleteTask') {
      const id = clean_(b.id, 60);
      const sh = sheet_('Tasks'), rows = sh.getDataRange().getValues();
      for (let r = 1; r < rows.length; r++) if (String(rows[r][0]) === id) sh.getRange(r + 1, TABS.Tasks.indexOf('deleted') + 1).setValue(now);
    } else if (b.op === 'setHours') {
      const id = clean_(b.id, 60), h = Number(b.hours);
      if (!id || !(h >= 0 && h <= 200)) return out_({ ok: false, error: 'bad_hours' });
      upsert_('Effort', 'id', id, { id: id, hours: h, by: who, at: now });
    } else if (b.op === 'post') {
      const text = clean_(b.text, 600);
      if (!text) return out_({ ok: false, error: 'empty' });
      append_('Updates', { id: 'u-' + Utilities.getUuid().slice(0, 8), at: now, owner: who, text: text, project: clean_(b.project, 80) });
    } else {
      return out_({ ok: false, error: 'unknown_op' });
    }
  } finally {
    lock.releaseLock();
  }
  return out_(snapshot_());
}

/* ---------- helpers ---------- */
function snapshot_() {
  const tasks = read_('Tasks').filter(t => !t.deleted);
  const updates = read_('Updates');
  return { ok: true, tasks: tasks, status: read_('Status'), updates: updates.slice(-300), effort: read_('Effort') };
}
function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { setup(); sh = ss.getSheetByName(name); }
  return sh;
}
function read_(name) {
  const rows = sheet_(name).getDataRange().getDisplayValues();
  const head = rows.shift() || [];
  return rows.filter(r => r[0]).map(r => {
    const o = {};
    head.forEach((h, i) => o[h] = r[i]);
    ['urgent', 'done'].forEach(k => { if (k in o) o[k] = String(o[k]).toUpperCase() === 'TRUE'; });
    return o;
  });
}
function append_(name, obj) {
  sheet_(name).appendRow(TABS[name].map(k => obj[k] == null ? '' : obj[k]));
}
function upsert_(name, key, val, obj) {
  const sh = sheet_(name), rows = sh.getDataRange().getValues(), ki = TABS[name].indexOf(key);
  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][ki]) === val) {
      sh.getRange(r + 1, 1, 1, TABS[name].length).setValues([TABS[name].map(k => obj[k] == null ? '' : obj[k])]);
      return;
    }
  }
  append_(name, obj);
}
function clean_(s, max) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B-\u001F]/g, '').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;   // stop spreadsheet formulas
  return s;
}
function stamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', "yyyy-MM-dd'T'HH:mm");
}
function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
