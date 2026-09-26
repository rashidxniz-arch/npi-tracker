# Exzone NPI Tracker

Team web app (PWA) for the Exzone NPI team. Open the site link, enter the team passcode, then tap Share → "Add to Home Screen" to install it.

- `data/tracker.enc.json`: project tracker, encrypted with the team passcode. Updated each weekday by Rashid's Claude from Outlook.
- Team tasks, ticks and updates are saved to a private Google Sheet through a Google Apps Script (`tools/Code.gs`).
- `tools/encrypt.py`: encrypts the tracker data. Never commit unencrypted data.
