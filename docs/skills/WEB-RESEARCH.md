---
name: WEB-RESEARCH
description: Guidelines for effective web research — search strategy, URL construction, multi-step navigation, and source selection.
triggers:
  extensions: []
  files: []
  keywords: ["research","search","documentation","web search","fetch"]
agents: []
active: true
---

# WEB-RESEARCH

## When to Search

Use `web_search` when the operator asks you to look something up, when the answer is version-specific (changelogs, migration guides, release notes), or when your knowledge may be outdated.

Use existing knowledge for stable, well-established concepts.

## Tools

- `web_search(query)` — returns ranked results with titles, URLs, and snippets
- `web_fetch(url)` — fetches a URL, strips HTML to markdown. Large pages are cached to `.voidrift/cache/web/` and accessible via `read_file`

## Search Strategy

Write queries like a developer, not a user:
```
✅ "fastapi pydantic v2 model_validator migration"
✅ "node 22 fetch timeout AbortSignal"
❌ "how do I set a timeout in node"
```

Include technology name, version, and the specific concept:
- `react 19 use() hook suspense`
- `vitest mock esm module`
- `langchain basechatmodel stream tool_calls`

## Multi-Step Navigation

Search results contain snippets — not full answers. Standard flow:

1. `web_search("query")` → scan titles and snippets for the most relevant result
2. `web_fetch(url)` → fetch the actual documentation page
3. Extract the answer from the fetched content

## Source Priority

1. Official documentation (`docs.*`, `developer.*`, package index pages)
2. Official GitHub repositories and release pages
3. Stack Overflow for specific error messages
4. Blog posts only when official docs don't cover it

Avoid JavaScript-heavy SPAs — `web_fetch` gets raw HTML text, not rendered content.

## When NOT to Search

- Stable language features (Python dicts, JS promises, SQL joins)
- Questions answerable from the workspace code itself (use `read_file`, `search_contents`)
- Anything already in your context (loaded skills, memories, focused files)
