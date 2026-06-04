---
name: WEB-ENG
description: Web application architecture, REST API design, frontend patterns, performance, and browser constraints for web engineering.
triggers:
  extensions: [".tsx",".jsx",".html",".css",".vue",".svelte"]
  files: []
  keywords: ["react","nextjs","frontend","rest","web"]
agents: []
active: true
---

# Domain: Web Engineering (WEB-ENG)

## Core Philosophy
- **Performance is a Feature:** Optimize for the Critical Rendering Path and Core Web Vitals (LCP, FID, CLS).
- **Discoverability:** Technical SEO is a foundational requirement, not an afterthought.
- **User-Centric Excellence:** Default to Level AA (WCAG 2.1) compliance and mobile-first, responsive layouts.

## Implementation Rules
- **Rendering Strategy:** Choose the right approach (SSR, SSG, or ISR) based on dynamic nature and SEO needs.
- **Atomic Design:** Break down interfaces into small, reusable, and testable components (Atoms, Molecules, Organisms).
- **SEO & Metadata:** Automated `sitemap.xml`, `robots.txt`, and JSON-LD structured data; implement Open Graph and Twitter cards.
- **Asset Optimization:** Responsive images (`srcset`), modern formats (WebP/AVIF), and tiered caching (CDN/Service Worker).

## Design System
- **Accessibility:** Use semantic HTML (`<button>`, `<main>`); provide `aria-label` where semantics are insufficient.
- **Micro-interactions:** Provide immediate visual feedback for all user actions (loading, success, error).
- **Performance Standards:** Enforce Gzip/Brotli; lazy-load non-critical routes; minimize external library impact.
