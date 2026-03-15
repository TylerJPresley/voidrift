# Skill: UI/UX Design

## Core Principles
- **Clarity first.** Every element must earn its place. Remove before you add.
- **Consistency over creativity.** Predictable patterns reduce cognitive load.
- **Design for the edge case.** Empty states, error states, and loading states are not optional.

## Layout & Structure
- Use an 8px spacing grid. All margins, padding, and gaps are multiples of 8.
- Max content width: 1280px. Reading columns: 65–75 characters.
- Establish a clear visual hierarchy: one primary action per screen, one H1 per page.
- Prefer whitespace over dividers to separate sections.

## Component Design
- Every interactive component must have four states: default, hover, active, disabled.
- Form fields must show validation state inline (not via alert/modal).
- Error messages must appear adjacent to the field that caused them.
- Destructive actions (delete, remove) require a confirmation step.

## Accessibility (WCAG 2.1 AA minimum)
- Color contrast: 4.5:1 for body text, 3:1 for large text and UI components.
- Never use color alone to convey meaning — pair with icon or text label.
- All interactive elements must be keyboard-navigable and focus-visible.
- Images require descriptive `alt` text; decorative images use `alt=""`.
- ARIA roles only where native HTML semantics are insufficient.

## Responsive Design
- Mobile-first. Design the 375px viewport first, then scale up.
- Breakpoints: 375px (mobile), 768px (tablet), 1280px (desktop).
- Touch targets: minimum 44×44px.
- Test at 200% zoom for accessibility compliance.

## Red Flags
- Placeholder text used as a label substitute
- Modals opened by modals
- Pagination where infinite scroll was designed (or vice versa)
- Custom form controls without proper ARIA implementation
- Animations exceeding 300ms for functional transitions
