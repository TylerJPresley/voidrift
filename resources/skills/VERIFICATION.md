# Skill: Verification

## The Iron Law
```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.
```
"Should work" is not evidence. Run the command. Read the output. Then — and only then — make the claim.

## The Gate
Before stating that work is done, fixed, or passing:

1. **Identify:** What command or log proves this claim?
2. **Run:** Execute it now, in full — not a cached or partial result.
3. **Read:** Check the complete output, exit codes, and side effects.
4. **Verify:** Does the output actually confirm the claim without regressions?
5. **Then claim:** State the result with the evidence attached.

## Evidence Standards
- **Tests:** Full test output showing 0 failures.
- **Build:** Exit 0 from the build/packaging command.
- **Lint:** 0 errors and 0 warnings from the linter.
- **Bugs:** Failing test that now passes with the fix.
- **State:** `git diff` showing actual changes align with requirements.

## Red Flags
- Using hedged language: "should", "I think", "seems to".
- Claiming success before running the verification suite.
- Trusting a model's output without manual or automated verification of the diff.
