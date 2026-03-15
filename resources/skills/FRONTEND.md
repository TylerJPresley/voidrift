# Skill: Frontend (TypeScript / Vue.js 3)

## Architecture & Standards
- **Framework:** Vue.js 3 (Composition API)
- **Build System:** Vite
- **Principles:** BFF Pattern (Client-side interaction)
- **Typing:** Strict TypeScript (no `any`)
- **Styling:** Prefer Vanilla CSS; Tailwind only if explicitly requested.

## Implementation Rules
- **Syntax:** Exclusive use of `<script setup lang="ts">`.
- **Logic:** Business logic belongs in Composables (`useFeature.ts`). Components remain atomic and pure.
- **Props/Emits:** Define interfaces for all Props, Emits, and API Responses.
- **BFF Pattern:** Vue components never call internal services directly; all traffic through the BFF/Gateway layer.

## Documentation & Metadata
- **TSDoc:** Required on all Composables and complex exported Components.
- **Hierarchy:** Document component hierarchy in a local `COMPONENTS.md`.
