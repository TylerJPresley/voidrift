# ADR [Number]: [Short, Descriptive Title]

**Date:** YYYY-MM-DD
**Status:** [Proposed | Accepted | Superseded | Deprecated]
**Architect:** [Role/Model Alias]
**Developer:** [Role/Model Alias]

---

## 1. Context and Problem Statement
[Describe the context and the problem being solved. What prompted this decision?]

## 2. Decision Drivers
- **Domain Alignment:** Does this favor interface-driven design and DDD?
- **Operational Excellence:** How will we track Start/Finish/Fail (Observability)?
- **Security & Compliance:** Does this align with the Security-Eng/Compliance-Privacy standards?
- **Performance & Scale:** What is the impact on latency, N+1 queries, or network efficiency?

## 3. Considered Options
- **Option 1:** [Description, Pros, Cons]
- **Option 2:** [Description, Pros, Cons]
- **Option 3:** [Description, Pros, Cons]

## 4. Decision Outcome
**Chosen Option:** [Option Name]

### Justification
[Explain why this option was chosen over the others based on the Decision Drivers.]

### Consequences
- **Positive:** [What do we gain?]
- **Negative:** [What are the trade-offs or technical debt?]

## 5. Implementation Strategy
**Plan Reference:** [Link to TASKS.md or specific section]
- **Architect Tasks:** [Design, skeleton, complex logic]
- **Developer Tasks:** [Boilerplate, DTOs, tests, documentation]
- **Verification Plan:** [How we will verify the change - e.g., mvn test, Vitest, Integration demo]
