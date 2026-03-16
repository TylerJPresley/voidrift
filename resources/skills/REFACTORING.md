# Skill: Refactoring & Tech Debt

## Core Philosophy
- **The Boy Scout Rule:** Always leave the code cleaner than you found it.
- **Small Steps:** Refactor in small, verifiable increments; never combine large refactors with new features.
- **Preserve Behavior:** Refactoring must not change the external behavior of the code.

## Implementation Rules
- **Test Coverage:** Ensure high test coverage before starting a refactor; use tests to verify behavior remains unchanged.
- **Code Smells:** Proactively identify and resolve smells (Long Methods, Large Classes, Feature Envy, Duplicated Code).
- **The Strangler Fig Pattern:** Gradually migrate legacy functionality to new structures by wrapping it in modern interfaces.
- **Refactoring Techniques:** Use standard patterns (Extract Method, Rename Variable, Move Method, Replace Conditional with Polymorphism).

## Technical Debt
- **Debt Tracking:** Document intentional technical debt with `TODO` comments and ADRs.
- **Repayment Plan:** Allocate time in every development cycle for repaying high-interest technical debt.
