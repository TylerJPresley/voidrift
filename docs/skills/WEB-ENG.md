---
name: WEB-ENG
description: Web application patterns — component architecture, rendering strategies, accessibility, performance, and API integration.
triggers:
  extensions: [".tsx",".jsx",".html",".css",".vue",".svelte"]
  files: []
  keywords: ["react","nextjs","frontend","component","web","css","tailwind"]
agents: []
active: true
---

# WEB-ENG

## Components

```tsx
// ✅ Props interface, single responsibility, accessible
interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function Button({ label, onClick, disabled }: ButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label}>
      {label}
    </button>
  );
}

// ❌ God component, inline styles, no accessibility
function Page() {
  const [data, setData] = useState(null);
  // 200 lines of mixed concerns...
}
```

- One component, one responsibility
- Props over internal state where possible
- Extract hooks for reusable logic (`useDebounce`, `useFetch`)
- Collocate styles, tests, and types with their component

## Rendering Strategy

| Need | Strategy |
|------|----------|
| SEO + dynamic data | SSR (getServerSideProps / server components) |
| SEO + static data | SSG (getStaticProps / generateStaticParams) |
| No SEO, interactive | Client-side (SPA, lazy-loaded) |
| Frequent updates | ISR with revalidation interval |

## Accessibility

```html
<!-- ✅ Semantic HTML, keyboard accessible -->
<button onClick={handleSubmit}>Submit</button>
<nav aria-label="Main navigation">...</nav>

<!-- ❌ Div with click handler, no keyboard support -->
<div onClick={handleSubmit} style="cursor: pointer">Submit</div>
```

- Semantic HTML first (`<button>`, `<nav>`, `<main>`, `<article>`)
- All interactive elements keyboard-accessible (focus, enter, escape)
- `aria-label` only when semantic HTML isn't sufficient
- Color contrast: minimum 4.5:1 for text (WCAG AA)

## Performance

```tsx
// ✅ Lazy load non-critical routes
const Settings = lazy(() => import("./Settings"));

// ✅ Optimize images
<Image src={url} width={800} height={600} loading="lazy" alt="description" />

// ❌ Import everything at the top level
import { HeavyChart } from "./charts"; // loaded even if user never visits this page
```

- Code-split by route. Lazy-load below-the-fold content.
- Images: WebP/AVIF, responsive `srcset`, explicit dimensions, `loading="lazy"`
- Minimize third-party scripts. Defer non-critical JS.
- Measure Core Web Vitals: LCP < 2.5s, INP < 200ms, CLS < 0.1

## Forms

- Validate on blur (immediate feedback) + on submit (final gate)
- Show inline errors next to the field, not in a banner
- Disable submit button during processing. Show loading state.
- Preserve form state on validation failure — never clear the form

## Stored Decisions (check memory first)

Before asking the user, check if these are already stored:
- Framework (React, Vue, Svelte, Next.js)
- Styling approach (Tailwind, CSS modules, styled-components)
- Component library (shadcn/ui, Radix, MUI)
- State management (server components, Zustand, Redux)
- Rendering strategy (SSR, SSG, SPA)

If missing, ask once and store as a directive memory.
