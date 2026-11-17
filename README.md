# Exzone NPI Tracker

Team web app (PWA) for the Exzone NPI team, hosted on GitHub Pages. Each person signs in with their own Firebase account (provisioned by Rashid); data lives in Cloud Firestore.

- `index.html`, `app.js`, `mobile.css`, `sw.js` — the app (no build step).
- `lib/snapshot.js` — shared email-snapshot logic: stable record IDs, date parsing, validation.
- `latest.html` — admin page to publish a new email snapshot as a versioned, verified, roll-back-able release.
- `firestore.rules` — access rules (identity-bound writes, read-only viewers, immutable snapshot versions).
- `email-intelligence/` — rule-based email classifier and its Apps Script test backend.
- `docs/REVIEW-2026-11.md` — engineering review and roadmap; `docs/DEPLOYMENT.md` — safe release steps.

Tests: `npm install`, then `npm test`, `npm run test:smoke` and `npm run test:rules` (Firestore emulator; never production).

Legacy (to be retired after sign-off): `data/tracker.enc.json` and the Google Apps Script endpoint in `config.js`. Never commit unencrypted data or service-account keys.
