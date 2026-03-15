# Verification Before Completion

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.
```

"Should work" is not evidence. Run the command. Read the output. Then — and only then — make the claim.

## The Gate

Before stating that work is done, fixed, or passing:

1. **Identify:** What command proves this claim?
2. **Run:** Execute it now, in full — not a cached result, not a partial check
3. **Read:** Check the complete output and exit code
4. **Verify:** Does the output actually confirm the claim?
5. **Then claim:** State the result with the evidence attached

Skip any step = making a claim without basis.

## Required Evidence by Claim Type

| Claim | Required Evidence |
|-------|-------------------|
| Backend tests pass | `mvn test` output — BUILD SUCCESS, 0 failures |
| Frontend tests pass | `npm test` output — all tests passed |
| Build succeeds | `mvn package` or `npm run build` — exit 0 |
| Lint clean | `mvn checkstyle:check` (Java) / `eslint` (TS) — 0 errors, 0 warnings |
| Bug is fixed | Test reproducing original symptom — now PASSES |
| Developer task complete | Check `git diff` — actual changes present, not just a success message |
| Feature complete | Re-read plan line by line, verify each requirement against running output |

## Red Flags — Stop Before Claiming Done

- Using hedged language: "should", "probably", "seems to", "I think it's"
- Expressing satisfaction before running verification: "Done!", "Perfect!", "Looks good!"
- About to commit or create a PR without having run the test suite in this session
- Trusting the Developer's success report without verifying the actual diff
