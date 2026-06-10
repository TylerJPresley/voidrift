---
name: WEB-RESEARCH
description: Guidelines for effective web research using http(action="get") — URL construction, search strategy, multi-step navigation, and source selection for software development contexts.
triggers:
  extensions: []
  files: []
  keywords: ["research","search","documentation","web search","fetch"]
agents: []
active: true
---

# WEB-RESEARCH

## When to Use http(action="get")

Fetch when the operator asks you to look something up, when the answer is version-specific (changelogs, migration guides, release notes), or when your knowledge may be outdated relative to recent releases.

Use existing knowledge for stable, well-established concepts.

## Search Strategy

`http(action="get")` retrieves one URL at a time. To search, construct a search URL directly:

**DuckDuckGo HTML** — no API key required, returns scraper-readable HTML:
```
https://html.duckduckgo.com/html/?q=python+requests+timeout+2024
```

**Direct documentation** — skip search when the URL pattern is known:
- PyPI package: `https://pypi.org/project/<package>/`
- Python stdlib: `https://docs.python.org/3/library/<module>.html`
- MDN Web Docs: `https://developer.mozilla.org/en-US/docs/Web/<Topic>`
- npm package: `https://www.npmjs.com/package/<package>`
- GitHub repo: `https://github.com/<owner>/<repo>`
- GitHub releases: `https://github.com/<owner>/<repo>/releases`

## Multi-Step Navigation

Search result pages list titles and links — not answers. Standard two-step flow:

1. `http(action="get", url="https://html.duckduckgo.com/html/?q=...")` → summary includes result titles and URLs
2. Identify the most relevant URL from the summary
3. `http(action="get", url=relevant_url)` → fetch the actual documentation page

Include technology and version context in queries:
- `fastapi pydantic v2 model migration guide`
- `python 3.12 asyncio taskgroup example`
- `click 8.x option callback signature`

## Source Priority

1. Official documentation (`docs.*`, `developer.*`, package index pages)
2. Official GitHub repositories and release pages
3. Stack Overflow for specific error patterns
4. Other sources

Avoid JavaScript-heavy sites — the raw page text will be empty or near-empty.

## Caching

Results are cached for the duration of the session. Calling `http(action="get")` with the same URL a second time returns the cached summary instantly at no cost.
