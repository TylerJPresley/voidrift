# Requirements: [Feature/Bug Name]

## 1. Introduction
- **Purpose:** [One-sentence summary of the desired outcome]
- **Project Scope:** [What this software will and will not do]

## 2. User Stories
- **As a** [User Role]
- **I want to** [Action/Capability]
- **So that** [Value/Benefit]

## 3. External Interfaces (IEEE 29148)
- **User Interfaces:** [UI Standards, Accessibility goals]
- **Hardware Interfaces:** [If applicable]
- **Software/API Interfaces:** [Connections to other services]
- **Communication Protocols:** [HTTPS, gRPC, MQTT]

## 4. Functional Requirements (EARS Notation)
*Use: WHEN [trigger], THE SYSTEM SHALL [result]*

- **REQ-1:** WHEN [user action], THE SYSTEM SHALL [expected behavior].
- **REQ-2:** IF [precondition] AND [user action], THE SYSTEM SHALL [expected behavior].
  - *Rationale:* [Why this requirement exists or why this approach was chosen — use for non-obvious decisions]
- **REQ-3:** WHILE [state], THE SYSTEM SHALL [expected behavior].

## 5. Non-Functional Requirements
- **Reliability:** [Availability targets, SLOs]
- **Performance:** [Latency, Throughput targets]
- **Security:** [Auth, Encryption, Compliance goals]

## 6. Verification Plan
| ID | Requirement | Method | Evidence Required |
|----|-------------|--------|-------------------|
| V1 | REQ-1 | Test | Unit Test Output |
| V2 | REQ-2 | Demo | Integration Logs |
| V3 | REQ-3 | Analysis | Performance Report |
