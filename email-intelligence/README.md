# NPI Email Intelligence – M2.1 EGC Benchmark

This is an isolated, non-production rule-engine prototype. It does not connect to Outlook, Apps Script, Firebase or the live NPI Tracker.

## M2.1 capabilities
- EGC project matching; unmatched emails remain Unmatched.
- Internal, configured customer, configured supplier, external and unknown sender classification.
- Category classification.
- Risk keyword detection with limited local negation handling.
- Action phrase detection without the broad "by " trigger.
- Date extraction for ISO, DD/MM/YYYY, DD-MM-YYYY, and day-month-name-year formats.
- Conservative owner candidate extraction from explicit "Owner:" / "Assigned to:" wording.
- Commitment candidates only when an action and date are both detected; status remains Unconfirmed.

## Safety and interpretation
- No database writes or mailbox access.
- Findings are Rule-derived candidates, not confirmed facts.
- A detected risk does not change project health/status.
- Owner names are never inferred from sender identity.
- Customer and supplier classification requires configured domains; otherwise external senders remain External.
- Numeric dates are interpreted as DD/MM/YYYY (Malaysia convention).
- Negation handling is limited and is not a substitute for human review.

## Run tests
Requires Node.js 18 or later:

```bash
node email-intelligence/tests/rules.test.js
```

## Benchmark fixtures
`fixtures/egc-samples.json` contains synthetic test messages, not copied customer or supplier emails.

## Known limitations
- Only EGC is mapped in this benchmark.
- Category rules use ordered keyword matching and may be ambiguous for mixed-topic emails.
- Negation detection is intentionally limited to common local phrases.
- Date parsing does not resolve relative dates such as "next Friday".
- Owner extraction recognises only explicit name patterns and must be validated.
- No commitment completion, actual delivery, or response-time status is inferred.

## Next steps
1. Run the M2.1 tests locally and review any failures.
2. Validate against a manually labelled, redacted sample of real EGC emails.
3. Add customer/supplier domain configuration from approved company records.
4. Extend project aliases from the live project master.
5. Integrate with Apps Script only after benchmark acceptance and IT approval for Microsoft Graph.
