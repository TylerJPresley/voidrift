# VoidRift: Progressive Content Discovery — Problem & Solutions

## The Problem

VoidRift needs to give an LLM enough awareness of a workspace to work accurately — without loading everything into the context window, without blocking the TUI on startup, and without being limited to code files only.

### Constraints

1. **Instant TUI startup.** The user must be able to type immediately. No multi-minute indexing delays.
2. **Context window protection.** Local models may have 8k-32k context. Cloud models have 200k. The solution must work across both without blowing budgets.
3. **Content-agnostic.** Real projects contain code, markdown docs, blueprints, architecture specs, requirements, config files, SQL, prose, templates, ideas, and more. The solution cannot be code-only.
4. **Large repo scale.** Must handle 500-file projects and 10,000-file monorepos alike.
5. **Local-first / sovereign.** Should not require cloud APIs to function. Must work with local models and local compute.
6. **Progressive disclosure.** The model should get just enough context to act — not everything at once.

### What We're Trying to Achieve

On any given turn, the model needs to answer:
- "Which files are relevant to what I'm doing right now?" (discovery)
- "What does this file contain at a high level?" (comprehension)
- "What's the exact code/content at this location?" (implementation access)

Each layer should be cheaper and faster than the next, forming a funnel from broad awareness to surgical precision.

---

## Current Implementation

- **AST Code-Map**: Parses code files into structural skeletons (function signatures, class names, exports). Always loaded (~1k tokens). Code-only — useless on markdown, config, prose.
- **Flash Summarization**: Sends file content to a cheap/local LLM, gets back a natural language summary with line ranges. Content-agnostic. Cached by file hash. Triggered on-demand when a file enters focus.
- **Surgical read_file**: Reads raw content with offset/limit for targeted access.

### Gaps

- **No discovery layer.** The model has to manually `glob_files` and guess which files matter. On large repos this wastes many tool-call round trips.
- **No proactive awareness.** The harness doesn't tell the model what might be relevant — the model has to ask.
- **AST only covers code.** Project docs, specs, and config files are invisible to the structural index.

---

## Possible Solutions

### Option A: RAG with Vector Embeddings (Background-Built)

- On startup: walk file tree, TUI goes live immediately.
- Background worker: summarizes and embeds files progressively (non-blocking).
- Per-turn: embed user query, retrieve top-K similar file summaries from vector index.
- Inject results as "suggested context" (~200-400 tokens) labeled as heuristic.
- Persist index to disk; subsequent launches load instantly, only re-index changed files.

**Pros**: Semantic search (finds related content even when terminology differs), content-agnostic, scales to large repos.  
**Cons**: Requires an embedding model (local or cloud), ~60MB disk for 10k files, background indexing means weak discovery on first launch, added infrastructure complexity.

### Option B: TF-IDF / Keyword Index Over Summaries

- Same lazy summarization approach (summarize on access, cache to disk).
- Instead of vector embeddings, build a keyword frequency index over cached summaries.
- Per-turn: score files by keyword overlap with user input + active plan + focused files.
- No embedding model required — pure text matching.

**Pros**: Zero infrastructure, fast, deterministic, no model dependency for search.  
**Cons**: Misses semantic relationships (user says "auth" but file uses "session validation"), weaker on large repos where keyword overlap is noisy.

### Option C: Hybrid — Structural Index + Semantic Search

- AST code-map for code files (structural navigation).
- Section-level summarization for large docs (blueprint, architecture, requirements split by heading).
- Lightweight vector index over all summaries (background-built).
- Fallback to keyword matching when vector index isn't ready yet.

**Pros**: Best of both worlds — structural awareness for code, semantic discovery for everything.  
**Cons**: Most complex to implement, two indexing strategies to maintain.

### Option D: LLM-Powered File Router (No Index)

- On each turn, pass the full file tree (paths only) + user query to the Flash model.
- Ask it: "Which of these files are likely relevant?"
- Flash returns a short list; harness loads summaries for those files.

**Pros**: Zero indexing infrastructure, zero startup cost, leverages model intelligence directly.  
**Cons**: Costs a Flash call every turn, file tree itself may be large (10k paths = many tokens), model may hallucinate relevance, slower than a pre-built index.

### Option E: Chunked Embeddings (Function/Section Level)

- Instead of embedding whole-file summaries, chunk files at meaningful boundaries (functions for code, headings for markdown).
- Embed each chunk individually.
- Retrieval returns specific chunks, not whole files.

**Pros**: More precise retrieval (finds the exact function, not just the file), better for large files.  
**Cons**: More chunks = larger index, chunk boundary detection is non-trivial, more complex than file-level indexing.

---

## Open Questions

1. Should the RAG index embed raw content, summaries, or structural chunks?
2. What embedding model? Local-only (nomic-embed-text via Ollama)? Configurable?
3. How do we handle first-launch cold start gracefully?
4. Should large docs (like blueprint.md) be indexed at section level or file level?
5. Is there a simpler approach we're not seeing that solves discovery without embeddings?
6. What's the right fallback when the index isn't ready or the embedding model is unavailable?

---

## Decision Reached: Caching-Optimized Workspace Map

Instead of introducing heavyweight databases, vector stores, or external embedding models (which break down at 50,000,000 files and add massive infrastructure overhead), VoidRift will use an **Adaptive, Cache-Optimized Workspace Map**.

### Key Pillars of the Chosen Solution:

1. **Self-Contained & Zero-Dependency**: No external vector DBs, no Ollama or cloud embedding dependencies. Built entirely in pure TypeScript.
2. **Context-Caching Optimization**: Rather than dynamically changing prompts on every turn (which ruins LLM provider prompt caches), we construct a stable, highly compressed **Workspace Map** (AST code signatures + Markdown heading outlines) and load it into the prompt's Workspace partition.
3. **Regex-Based Document Outline Extraction**: Extend the existing `generateCodeMap` recursive walker to parse `.md` files and extract headers (`#`, `##`, `###`) using regex, mapping them visually (e.g., `📝 blueprint.md [# VoidRift, ## Subsystem 1]`). This keeps the map footprint under 3,000 tokens even for large codebases.
4. **LLM Native Semantic Discovery**: The LLM leverages its native tokenization and cached workspace awareness to "find" what it needs, surgically calling the existing `read_file` or `edit_file` tools to pull raw text.
5. **No Cold Start Storm**: Starts instantly. Walks the file tree in milliseconds with zero background indexers or CPU resource spikes.

---

## Implementation

### What was built (packages/core/src/codemap/index.ts):

Extended the existing `generateCodeMap` walker to handle all text file types, not just code:

1. **Code files** (`.ts`, `.js`, `.py`, `.rs`, `.go`, etc.) — Extract top-level symbols (exports, classes, functions, interfaces, types). No function bodies.
2. **Markdown files** (`.md`, `.mdx`) — Extract headings (h1-h3) as a table of contents + line count.
3. **Data/config files** (`.json`, `.yaml`, `.yml`, `.toml`) — Extract top-level keys + line count.
4. **All other text files** — Show path + line count only.

### Output format:

```
📁 src/
   src/adapters/factory.ts [function createTierAdapter, type Tier, interface ResolvedModel]
📁 docs/
📝 blueprint.md (2102L) [# VoidRift, ## Executive Summary, ## Subsystem 1, ...]
⚙️  package.json (10L) [name, version, private, scripts]
⚙️  config.yaml (25L) [database, server, logging]
   README.txt (45L)
```

### Performance on VoidRift workspace:

- **167 entries** (files + directories)
- **~1,942 tokens** for the full map
- **Generation time**: milliseconds (pure filesystem walk + regex, no LLM calls)
- **Startup cost**: zero — no background workers, no indexing delay

### How it works with the rest of the pipeline:

```
Always loaded:     Workspace Map (~2k tokens) — structural skeleton for ALL file types
On-demand:         Flash Summarization (cached) — deep comprehension of a single file
Surgical:          read_file(path, offset, limit) — raw content for editing
```

The model sees the full workspace structure in the map, knows what sections exist in docs, what keys exist in configs, and what symbols exist in code. When it needs more detail, it calls `read_file` — which returns a cached Flash summary for large files, or raw content for small ones. When it needs implementation-level access, it calls `read_file` with offset/limit.

### RAG as a future plugin hook:

The `suggestedContext` slot in the Workspace Partition is reserved for a future RAG plugin. The plugin would:
1. Register on the event bus via `subscribeEvent("USER_INPUT_RECEIVED", ...)`
2. Run its own retrieval (vector, TF-IDF, or hybrid)
3. Inject results into `suggestedContext` via the core service interface

Core doesn't need to know how discovery happens — it just renders whatever lands in that slot. This keeps RAG as an opt-in enhancement, not a hard dependency.

### Tests:

14 tests passing covering:
- Code symbol extraction (exports, classes, functions, interfaces, types)
- Markdown heading extraction (h1-h3 with line counts)
- JSON top-level key extraction
- YAML top-level key extraction
- Directory structure rendering
- Ignored directories (node_modules, .git, .voidrift)
- Empty directory handling
