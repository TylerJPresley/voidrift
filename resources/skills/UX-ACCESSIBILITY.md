# Skill: UX & Accessibility

## Core Standards
- **WCAG 2.1 AA:** Default to Level AA compliance for all user interfaces.
- **Semantic HTML:** Use correct tags (`<button>`, `<main>`, `<nav>`) to ensure screen reader compatibility.
- **Responsive:** Mobile-first design; use a standard grid system (8px/12-column).

## Implementation Rules
- **Aria Labels:** Provide `aria-label`, `aria-describedby`, and `role` attributes where semantics are insufficient.
- **Contrast Ratios:** Ensure text and background colors meet minimum contrast ratios (4.5:1 for text).
- **Keyboard Navigation:** All interactive elements must be reachable and operable via keyboard.
- **Focus States:** Never remove focus outlines; ensure a clear visual focus indicator is present.
- **Micro-interactions:** Provide immediate visual feedback for user actions (loading, success, error).

## Design System
- **Design Tokens:** Use tokens for colors, spacing, and typography to ensure consistency.
- **Component Hierarchy:** Maintain a clear visual hierarchy using typography and spacing.
- **Iconography:** Use a consistent, accessible icon set with meaningful alt text.
