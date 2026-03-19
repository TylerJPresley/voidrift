# Analysis & Requirements (ANALYSIS-REQS)

## Core Philosophy

- **Evidence-Based Discovery:** Requirements must be derived from direct user intent or inferred from validated implementation patterns in existing code.
- **Behavioral Focus (Outcomes over Mechanisms):** Prioritize what the system achieves (e.g., "process a payment") over how it is implemented.
- **Traceability:** Maintain a clear "Line of Sight" from business goals to user stories, acceptance criteria, and technical constraints.
- **Integrated Rationale:** Every non-obvious requirement must include its own justification to prevent "Requirements Rot" and preserve architectural intent.

## Implementation Rules

- **EARS Notation:** Format functional requirements using "Easy Approach to Requirements Syntax" (e.g., WHEN [trigger], THE SYSTEM SHALL [result]).
- **REQ Identification:** Assign a unique ID (e.g., REQ-1, REQ-ARCH-1) to every functional requirement for cross-referencing and verification.
- **Rationale Inclusion:** For all design-critical or non-obvious requirements, provide a *Rationale:* immediately below the REQ line explaining the "why" behind the approach.
- **BDD Acceptance Criteria:** Define success using "Given [context], When [action], Then [outcome]" (Gherkin-style) to bridge analysis and automated verification.
- **Constraint Mapping:** Explicitly document technical, regulatory, and environmental limitations (e.g., "Must run on ARM64").

## Code Archaeology (Legacy Analysis)

- **Intent Inference:** Analyze naming conventions, comments, and existing test suites to reconstruct the original business logic and intent.
- **Characterization Testing:** When reverse-engineering, document how the current system actually behaves (even its bugs) before proposing changes.
- **Structural Mapping (DDD):** Identify core domains, Bounded Contexts, and data flows to understand the system's "Context Map" before diving into implementation.
- **Rationale Reconstruction:** When analyzing legacy code, infer and document the Rationale for its existing structure to inform future decisions.
- **Gap Analysis:** Explicitly identify discrepancies between current system behavior and the desired future state.

## Artifact Standards

- **REQUIREMENTS.md:** The central source of truth for system-wide goals, features, and constraints.
- **Feature Specifications (spec/):** Detailed, modular specifications for targeted development, including BDD scenarios and specific REQ lines with rationales.
- **Visual Models:** Use Mermaid diagrams to document complex workflows, state transitions, or DDD Context Maps discovered during analysis.
