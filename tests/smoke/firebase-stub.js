/* In-memory stand-in for the Firebase compat SDK, used ONLY by browser smoke tests (tests/smoke/run.mjs).
 * It never contacts Firebase. Data lives in localStorage so it survives page navigation inside one test.
 * Supports the subset the app and publisher use: auth (email/password), collections, docs, sub-collections,
 * batches, transactions, orderBy/limit, serverTimestamp, and simulated permission-denied paths. */
(function () {
  "use strict";
  var KEY = "__fsStore";
  function Ts(ms) { this._ms = ms; this.seconds = Math.floor(ms / 1000); }
  Ts.prototype.toDate = function () { return new Date(this._ms); };
  function enc(v) { if (v instanceof Ts) return { __ts: v._ms }; if (Array.isArray(v)) return v.map(enc); if (v && typeof v === "object" && !(v instanceof Date)) { var o = {}; Object.keys(v).forEach(function (k) { o[k] = enc(v[k]); }); return o; } if (v instanceof Date) return { __ts: v.getTime() }; return v; }
  function dec(v) { if (v && typeof v === "object" && "__ts" in v) return new Ts(v.__ts); if (Array.isArray(v)) return v.map(dec); if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function (k) { o[k] = dec(v[k]); }); return o; } return v; }
  function load() { try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {} return null; }
  var state = load() || { docs: {}, users: {}, deny: [], log: [] };
  if (!load() && window.__FS_SEED) state = JSON.parse(JSON.stringify(window.__FS_SEED));
  state.deny = state.deny || []; state.log = state.log || [];
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
  save();
  window.__FS = { state: state, save: save };
  var SERVER_TS = { __serverTs: true };
  function resolve(data) { var o = {}; Object.keys(data).forEach(function (k) { var v = data[k]; o[k] = v && v.__serverTs ? { __ts: Date.now() } : enc(v); }); return o; }
  function denied(path) { return state.deny.some(function (re) { return new RegExp(re).test(path); }); }
  function err() { var e = new Error("Missing or insufficient permissions."); e.code = "permission-denied"; return e; }
  function rid() { return Math.random().toString(36).slice(2, 12); }
  function snap(path) { var d = state.docs[path]; return { id: path.split("/").pop(), ref: docRef(path), exists: !!d, data: function () { return d ? dec(d) : undefined; } }; }
  function apply(op) {
    if (denied(op.path)) throw err();
    var cur = state.docs[op.path];
    if (op.type === "set") state.docs[op.path] = op.merge && cur ? Object.assign({}, cur, resolve(op.data)) : resolve(op.data);
    else if (op.type === "update") { if (!cur) { var e = new Error("No document to update: " + op.path); e.code = "not-found"; throw e; } state.docs[op.path] = Object.assign({}, cur, resolve(op.data)); }
    else if (op.type === "delete") delete state.docs[op.path];
    state.log.push(op.type + " " + op.path);
  }
  function commit(ops) { ops.forEach(function (op) { if (denied(op.path)) throw err(); }); ops.forEach(apply); save(); }
  function docRef(path) {
    return {
      id: path.split("/").pop(), path: path,
      get: function () { return Promise.resolve(snap(path)); },
      set: function (data, opt) { try { commit([{ type: "set", path: path, data: data, merge: !!(opt && opt.merge) }]); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
      update: function (data) { try { commit([{ type: "update", path: path, data: data }]); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
      delete: function () { try { commit([{ type: "delete", path: path }]); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
      collection: function (name) { return colRef(path + "/" + name); }
    };
  }
  function colRef(path, order, lim) {
    return {
      path: path,
      doc: function (id) { return docRef(path + "/" + (id || rid())); },
      add: function (data) { var r = docRef(path + "/" + rid()); return r.set(data).then(function () { return r; }); },
      orderBy: function (field, dir) { return colRef(path, { field: field, dir: dir || "asc" }, lim); },
      limit: function (n) { return colRef(path, order, n); },
      get: function () {
        if (denied(path + "/__read__")) return Promise.reject(err());
        var depth = path.split("/").length + 1;
        var docs = Object.keys(state.docs).filter(function (p) { return p.indexOf(path + "/") === 0 && p.split("/").length === depth; }).sort().map(snap);
        if (order) docs.sort(function (a, b) { var x = (a.data() || {})[order.field], y = (b.data() || {})[order.field]; x = x && x.seconds != null ? x._ms : x; y = y && y.seconds != null ? y._ms : y; var c = x < y ? -1 : x > y ? 1 : 0; return order.dir === "desc" ? -c : c; });
        if (lim) docs = docs.slice(0, lim);
        return Promise.resolve({ docs: docs, size: docs.length, empty: !docs.length });
      }
    };
  }
  var db = {
    collection: function (name) { return colRef(name); },
    batch: function () { var ops = []; return {
      set: function (ref, data, opt) { ops.push({ type: "set", path: ref.path, data: data, merge: !!(opt && opt.merge) }); },
      update: function (ref, data) { ops.push({ type: "update", path: ref.path, data: data }); },
      delete: function (ref) { ops.push({ type: "delete", path: ref.path }); },
      commit: function () { try { commit(ops); return Promise.resolve(); } catch (e) { return Promise.reject(e); } } }; },
    runTransaction: function (fn) {
      var ops = [];
      var tx = { get: function (ref) { return ref.get(); }, set: function (ref, data) { ops.push({ type: "set", path: ref.path, data: data }); return tx; },
        update: function (ref, data) { ops.push({ type: "update", path: ref.path, data: data }); return tx; } };
      return Promise.resolve(fn(tx)).then(function (r) { commit(ops); return r; });
    }
  };
  var listeners = [], current = null;
  try { var u = sessionStorage.getItem("__fsUser"); if (u) current = JSON.parse(u); } catch (e) {}
  var auth = {
    get currentUser() { return current; },
    onAuthStateChanged: function (cb) { listeners.push(cb); setTimeout(function () { cb(current); }, 0); return function () {}; },
    signInWithEmailAndPassword: function (email, pw) {
      var uid = state.users[String(email).toLowerCase()];
      if (!uid || pw !== "test-password") { var e = new Error("bad"); e.code = "auth/invalid-credential"; return Promise.reject(e); }
      current = { uid: uid, email: String(email).toLowerCase() }; sessionStorage.setItem("__fsUser", JSON.stringify(current));
      listeners.forEach(function (cb) { setTimeout(function () { cb(current); }, 0); });
      return Promise.resolve({ user: current });
    },
    signOut: function () { current = null; sessionStorage.removeItem("__fsUser"); listeners.forEach(function (cb) { cb(null); }); return Promise.resolve(); }
  };
  var fsFn = function () { return db; }; fsFn.FieldValue = { serverTimestamp: function () { return SERVER_TS; } }; fsFn.Timestamp = Ts;
  window.firebase = { apps: [], initializeApp: function (c) { this.apps.push(c); return { auth: function () { return auth; } }; }, auth: function () { return auth; }, firestore: fsFn };
})();
