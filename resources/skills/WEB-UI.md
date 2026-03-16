# Skill: Web UI

## Core Concepts
- **Component-Based:** Break down interfaces into small, reusable, and testable components.
- **Composition over Inheritance:** Use composables or hooks for shared logic; keep components pure.
- **State Management:** Define state at the appropriate level (component, local store, or global store).

## Implementation Rules
- **Atomic Design:** Organize components into atoms, molecules, and organisms.
- **Lifecycle:** Use lifecycle hooks (onMounted, useEffect) only when necessary; prefer reactive declarations.
- **Props & Emits:** Strongly type all props, emits, and events using interfaces or TypeScript.
- **Client Routing:** Use a standard router (Vue Router, React Router) with lazy-loaded views.
- **BFF Pattern:** Components must not call internal services directly; route all traffic through the Gateway/BFF.

## Performance
- **Lazy Loading:** Code-split non-critical components and routes.
- **Asset Optimization:** Use responsive images, SVG for icons, and minimal external libraries.
- **Strict Typing:** Enable strict mode and never use `any` in component logic.
