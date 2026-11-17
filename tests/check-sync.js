/* Release consistency checks — run by `npm test`. */
"use strict";
const fs = require("fs"), path = require("path"), root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const fail = m => { console.error("✗ " + m); process.exitCode = 1; };
if (read("email-intelligence/rules.js") !== read("email-intelligence/apps-script/Rules.gs")) fail("email-intelligence/rules.js and apps-script/Rules.gs differ — copy rules.js over Rules.gs.");
const sw = read("sw.js"), shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]*\])/)[1]);
shell.filter(f => f !== "./").forEach(f => { if (!fs.existsSync(path.join(root, f))) fail("sw.js SHELL lists a missing file: " + f); });
const appVer = read("app.js").match(/const APP_VERSION = "([^"]+)"/)[1];
const topChange = read("app.js").match(/const CHANGES = \[\s*\{v:"([^"]+)"/)[1];
if (appVer !== topChange) fail("APP_VERSION " + appVer + " has no matching first entry in CHANGES (" + topChange + ").");
const index = read("index.html");
["config.js", "lib/snapshot.js", "app.js", "gantt.js"].forEach(f => { if (!index.includes('src="' + f + '"')) fail("index.html does not load " + f); });
if (index.indexOf('src="lib/snapshot.js"') > index.indexOf('src="app.js"')) fail("lib/snapshot.js must load before app.js");
if (index.indexOf('src="gantt.js"') < index.indexOf('src="app.js"')) fail("gantt.js must load after app.js");
if (/AIza[0-9A-Za-z_-]{35}/.test(read("lib/snapshot.js") + read("app.js"))) fail("API key found outside config.js");
if (!process.exitCode) console.log("Release checks passed (app v" + appVer + ", " + sw.match(/CACHE = "([^"]+)"/)[1] + ").");
