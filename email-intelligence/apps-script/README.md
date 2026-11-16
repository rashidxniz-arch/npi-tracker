# M2.3 — Isolated Apps Script Backend (Test Mode)

This folder is a test-only Apps Script project scaffold for the NPI Email Intelligence module.

## Safety boundary
- No Outlook or Microsoft Graph connection.
- No access to the live mailbox.
- No writes to production collections such as `projects`, `tasks`, `updates`, or `emailSnapshot*`.
- Writes, when explicitly enabled, are limited to:
  - `emailIntelligenceTest`
  - `emailInsightsTest`
  - `emailProcessingLogsTest`
- Full email body and full sender address are not stored. A SHA-256 message identifier is used for duplicate protection.
- Do not deploy the optional `doPost` endpoint until a strong token is stored in Script Properties.

## Files
- `Code.gs`: test harness, Firestore REST calls, duplicate check, test-only persistence and processing log.
- `Rules.gs`: exact M2.2.1 rule engine, packaged for Apps Script V8.
- `appsscript.json`: V8 runtime and required OAuth scopes.

## Setup
1. Open https://script.google.com and create a standalone Apps Script project named `Exzone NPI Email Intelligence – M2.3 Test`.
2. Add a script file named `Code` and paste `Code.gs`.
3. Add a script file named `Rules` and paste `Rules.gs`.
4. Open Project Settings and enable “Show appsscript.json manifest file”; replace its content with this folder's manifest.
5. In Project Settings → Script Properties, add:
   - `FIRESTORE_PROJECT_ID` = `exzone-npi-tracker`
   - `ENABLE_TEST_WRITES` = `false`
6. Save the project.

## Validation sequence
1. Select `testRulesOnly` and Run. This uses a synthetic EGC sample and does not contact Firestore.
2. Select `testFirestoreConnection` and Run. This performs a read-only request to the test log collection. Authorize the Google account when prompted.
3. Confirm that the executing Google account has an IAM role allowing Firestore data access on project `exzone-npi-tracker`. Firestore REST calls use the Apps Script user's OAuth identity and Cloud IAM; Firestore Security Rules are not the authorization layer for this server-side OAuth request.
4. Only after the read test succeeds, set `ENABLE_TEST_WRITES` = `true`.
5. Select `testM23Sample` and Run. It writes one synthetic sample to the three *Test collections only*.
6. Run `testM23Sample` again. It should return `duplicate_skipped` and must not create a second email document or duplicate insight records.

## Required access / troubleshooting
- If the Firestore read returns 403, ask the Firebase/Google Cloud project administrator to grant the Google account running the script a suitable Firestore data access role (for example, a least-privilege custom role or Cloud Datastore User where appropriate).
- If it returns 404 for the database, verify that the Firestore default database exists and that the project ID is correct.
- Do not paste OAuth tokens, API secrets, or the test endpoint token into chat or commit them to GitHub.
- Do not change `firestore.rules` for this scaffold. The Apps Script REST request is authenticated as the script runner and governed by Cloud IAM, not client SDK Security Rules.

## Optional endpoint
`doPost` accepts a JSON object containing `token` and `email`. It is not required for the initial validation sequence. If used later, create a strong random `NPI_EMAIL_TEST_TOKEN` Script Property, deploy only after reviewing access settings, and send requests only from a controlled test client.

## Limitations
- This is a test harness, not a scheduled mailbox importer.
- No Graph OAuth, mailbox polling, thread reconstruction, attachment processing, or production publishing is included.
- Multi-document writes are not transactional. If a write fails partway through, inspect the test collections before retrying; duplicate protection applies to the primary email record.
- Rule outputs remain candidates; no project health/status is automatically changed.
