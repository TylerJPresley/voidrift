# Skill: Web Performance & SEO

## Core Philosophy
- **Speed is a Feature:** Optimize for the "Critical Rendering Path" to ensure the fastest possible Time to First Byte (TTFB) and First Contentful Paint (FCP).
- **Discoverability:** Technical SEO is a foundational requirement, not an afterthought.
- **User-Centric Metrics:** Monitor and optimize for Core Web Vitals (LCP, FID, CLS).

## Implementation Rules
- **Rendering Strategies:** Choose the right strategy (SSR, SSG, ISR, or CSR) based on the content's dynamic nature and SEO needs.
- **Image Optimization:** Use modern formats (WebP/AVIF), responsive sizes (`srcset`), and lazy loading.
- **Metadata:** Implement robust Open Graph tags, Twitter cards, and JSON-LD structured data.
- **Minification & Compression:** Enforce Gzip/Brotli compression and minification for all CSS, JS, and HTML.
- **Caching:** Implement tiered caching strategies (CDN, Service Worker, Browser Cache).

## SEO Standards
- **Sitemaps & Robots:** Maintain automated `sitemap.xml` and `robots.txt` generation.
- **Canonicalization:** Use canonical tags to prevent duplicate content issues.
- **Semantic HTML:** Ensure the heading structure and document outline are optimized for search engines.
