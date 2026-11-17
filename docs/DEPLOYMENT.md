# Deploying v2.12 safely

Do these steps in order. Each step can be undone; nothing here deletes data.

## 1. Add `teamKey` to every user profile (Firebase console, admin)

The new rules only accept writes signed with your own team key. Open Firestore → `users` → each document and add a string field:

| Field | Value (one of) |
|---|---|
| `teamKey` | `rashid`, `fadzmi`, `liyana`, `yusri`, `zul`, `fakrul`, `wajdi`, `shamsuri` |

Also make sure `role` is one of `admin`, `engineer`, `member`, `viewer`. A missing role counts as `member`. Do this **before** step 3. The current app (v2.11) ignores the field, so adding it changes nothing for the team.

## 2. Run the tests

```bash
npm install
npm test            # syntax, release checks, snapshot + rule-engine unit tests
npm run test:smoke  # browser tests against an in-memory Firebase stand-in (needs Chromium)
npm run test:rules  # Firestore rules against the local emulator (needs Java; uses project demo-npi, never production)
```

All three must pass. `test:rules` could not be run in the review environment, so run it locally or in CI first.

## 3. Deploy the rules

1. Firebase console → Firestore → Rules. Copy the current rules into a text file as your rollback copy (the console also keeps a history).
2. Paste `firestore.rules` from this branch and publish.
3. Check with the current app (v2.11) still live:
   - [ ] A member ticks one of their own actions → it saves.
   - [ ] A viewer account cannot tick (expect a permission message).
   - [ ] Posting a project update works for a member.

**Rollback:** paste the saved rules back and publish.

## 4. Release the app (merge the branch)

Merging to `main` makes GitHub Pages publish v2.12. Phones show "New version available".

Check:
- [ ] Sign in once, close the tab, reopen it → you are still signed in.
- [ ] Actions list still shows existing ticks; team-added tasks are visible.
- [ ] Projects no longer show "overdue" just because of an old email date.
- [ ] The name menu shows "Signed in as" with your name, and it can't be changed.

**Rollback:** revert the merge commit on GitHub. Pages republishes v2.11 within minutes, and the data is unchanged.

## 5. First versioned publish (`latest.html`)

1. Sign in as admin.
2. Choose the workbook and read the validation report. Fix any errors.
3. Download the backup and keep it.
4. Leave "Also update the old flat collections" ticked.
5. Press Publish. All steps must show ✓ and the versions table must show **LIVE**.
6. Open the tracker: the snapshot date in the name menu matches.
7. Test rollback once: "Make live" on the previous version, then make the new one live again.

If a publish fails part-way, the page says "The live snapshot was NOT changed." The failed version stays in the table as `failed` and can be ignored.

## 6. Later clean-up (after all phones run ≥ v2.12 for two weeks)

- Untick the mirror option, then archive and delete the flat `emailSnapshot*` collections (keep the JSON backups).
- Retire the old Apps Script endpoint in `config.js` and `data/tracker.enc.json`, once the team signs off on Firebase (see FIREBASE_SETUP step 7).
