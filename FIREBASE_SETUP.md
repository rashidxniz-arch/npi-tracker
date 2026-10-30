# NPI Tracker V2.4 — Firebase account and database setup

## Chosen sign-in model

- Authentication: Firebase Authentication, Email/Password.
- Public self-registration: disabled.
- Team accounts: individually created and managed by Rashid (administrator).
- Shared database: Cloud Firestore.
- Hosting: existing GitHub Pages PWA.
- Microsoft 365 domain administrator access: not required.
- Google account: used only by the project owner/administrator to manage Firebase.

## Important security model

A Firebase Authentication account alone is not enough to enter the tracker. Every account must also have an active document in Firestore at `users/{uid}`.

Example user document:

```json
{
  "displayName": "Rashid",
  "email": "rashid@example.com",
  "role": "admin",
  "active": true,
  "createdAt": "server timestamp"
}
```

Supported roles:
- `admin`: full administration and user provisioning.
- `engineer`: project, task and meeting management.
- `member`: team task and progress updates.
- `viewer`: read-only access (application must enforce read-only UI; Firestore rules remain authoritative).

Never let a user create or edit their own role or active status. Create the Firebase Auth user first, copy its UID, then create the corresponding `users/{uid}` document from the Firebase Console using the project administrator account.

## Firebase Console setup

1. Create a Firebase project, for example `exzone-npi-tracker`.
2. Register a Web App named `NPI Tracker`.
3. Authentication → Sign-in method → enable **Email/Password**.
4. Keep public user sign-up disabled in the application. Only the administrator provisions accounts through Firebase Authentication → Users → Add user.
5. Create Cloud Firestore in region `asia-southeast1` (Singapore), subject to availability and company data-residency approval.
6. Publish the rules from `firestore.rules`.
7. Create the first admin Auth account for Rashid, then create its matching `users/{uid}` document with `role: admin` and `active: true`.
8. Add each approved team member through Authentication → Users → Add user; create their matching user document with the appropriate role and `active: true`.
9. Configure the web app using the Firebase web configuration. The web config is not a secret; Firestore security rules are the protection boundary. Never put service-account keys or Admin SDK credentials in the PWA or GitHub repository.

## Suggested initial role assignment

- Rashid: `admin`
- Fadzmi, Liyana, Yusri: `engineer`
- Zul, Fakrul, Wajdi, Shamsuri: `member`

Confirm actual responsibilities with Rashid before provisioning.

## Migration sequence (do not skip)

1. Back up the current Google Sheet and tracker data.
2. Set up Firebase Authentication and Firestore.
3. Test login and denied access using a non-provisioned account.
4. Import existing tasks, status and updates into Firestore with a trusted Admin SDK migration script run locally by the administrator. Do not expose an Admin SDK key in the browser or commit it to Git.
5. Connect the PWA to Firebase Auth and Firestore.
6. Verify all existing project records, actions, updates, and role restrictions.
7. Only then retire the Apps Script endpoint and old shared passcode.
8. Keep a rollback backup until the team signs off.

## Current implementation status

This repository contains the proposed Firestore rules and setup guide. The live app still uses its existing passcode and Google Apps Script backend until the Firebase project is configured and the migration is tested. Do not treat V2.4 authentication as live yet.
