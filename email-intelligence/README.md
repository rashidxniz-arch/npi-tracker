# NPI Email Intelligence – M2 EGC Benchmark

This folder is an isolated, non-production rule-engine prototype. It does not connect to Outlook, Apps Script, Firebase or the live NPI Tracker.

## Scope
- Rule-based EGC project matching.
- Sender classification.
- Email category classification.
- Risk keyword detection.
- Action phrase detection.
- ISO date candidate extraction.
- Structured insight candidates.

## Safety
- No database writes.
- No mailbox access.
- No production data changes.
- Unknown project matches remain Unmatched.
- Rule-derived findings are not confirmed facts.
- A detected risk does not change project health/status.

## Run tests
Requires Node.js 18 or later:

\`\`\`bash
node email-intelligence/tests/rules.test.js
\`\`\`

## Benchmark fixtures
\`fixtures/egc-samples.json\` contains synthetic test messages based on the EGC scenario discussed during development. They are test examples, not copied customer or supplier emails.

## Known limitations
- Only EGC is mapped in this first benchmark.
- Sender classification uses configured internal domains.
- Date extraction currently recognizes ISO dates only.
- Keyword rules can produce false positives and must be validated against a manually labelled email sample.
- Action owner and commitment state are not inferred automatically in this prototype.

## Next steps
1. Validate the expected outputs with NPI users.
2. Add representative redacted EGC examples.
3. Extend project aliases from the live project master.
4. Add rule versioning and configurable keyword lists.
5. Integrate with Apps Script only after benchmark acceptance.
