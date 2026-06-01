# VoidRift Blueprint Amendments

Tracks deviations, additions, and refinements made during implementation
that go beyond or differ from what `blueprint.md` specifies.

---

## AMD-001: Config file naming
- **Blueprint says**: `models.json` for model config
- **We decided**: Single `config.json` at both levels (global + local override)
- **Reason**: User preference — simpler, one file for everything

## AMD-002: read_file incremental loading
- **Blueprint says**: read_file reads raw file text with truncation
- **We added**: `offset` and `limit` parameters for incremental chunk reading
- **Reason**: Large files (2000+ lines) get truncated and models can't work with them. Incremental loading lets the model read in manageable chunks.

## AMD-003: Tool execution loop in direct chat
- **Blueprint says**: Streaming engine translates chunks, orchestration routes nodes
- **We added**: Tool execution loop in `directChat` — executes tool calls, feeds results back as ToolMessages, re-calls model until it responds with text
- **Reason**: Blueprint describes the architecture but not the mechanical loop needed to actually execute tools and return results to the model. This is implicit in any agent loop.

## AMD-004: Deduplication in tool loop
- **Blueprint says**: (not specified)
- **We added**: If model repeats the exact same tool call, break the loop
- **Reason**: Prevents infinite loops when model gets stuck calling the same tool repeatedly

## AMD-005: Post-tool-loop response nudge
- **Blueprint says**: (not specified)
- **We added**: After tool loop exhausts, add system message telling model to respond based on results
- **Reason**: Some models don't generate text after receiving tool results without explicit instruction to do so

## AMD-006: Four-Layer Progressive Content Discovery
- **Blueprint said**: Dynamic Progressive Disclosure via TF-IDF keyword index
- **We updated**: Blueprint now specifies a four-layer pipeline: RAG Vector Index → AST Code-Map → Flash Summarization → Surgical read_file
- **Reason**: TF-IDF alone can't handle semantic discovery at scale across mixed content types. RAG provides content-agnostic discovery, AST provides code structure, Flash summarization provides intent-aware comprehension, and surgical reads provide implementation access.

## AMD-007: focusedFiles stores summaries, not raw text
- **Blueprint said**: focusedFiles holds "max 3 full-text source files"
- **We decided**: focusedFiles stores Flash summaries + tracked read ranges (LRU, token-budget-aware eviction)
- **Reason**: Loading full file text into context is wasteful. Summaries with line-range pointers let the model understand files without paying full token cost, then surgically read only what it needs.

## AMD-008: suggestedContext slot (RAG pre-load)
- **Blueprint said**: (not specified)
- **We added**: `suggestedContext` in the Workspace Partition — ephemeral RAG results injected proactively each turn, evicted next turn unless acted upon
- **Reason**: Proactive discovery saves tool-call round trips. Labeling it as "may not be relevant" prevents the model from treating heuristic results as authoritative.

## AMD-009: Token-budget-based eviction for focusedFiles
- **Blueprint said**: Max 3 files, LRU eviction
- **We added**: Dual eviction — count limit (max 3) AND token budget ceiling (8000 tokens)
- **Reason**: Three large file summaries could still blow the workspace partition budget. Token-aware eviction prevents this.

## AMD-010: summarizeThreshold config field
- **Blueprint said**: (not in config schema)
- **We added**: `summarizeThreshold` (default 500 lines) — files under this size are pinned in full rather than summarized
- **Reason**: Summarizing a 50-line file wastes a Flash model call when the raw content is cheaper than the summary.

## AMD-011: editor config field
- **Blueprint said**: (not in config schema)
- **We added**: `editor` field in config for preferred text editor
- **Reason**: Needed for `/templates` override workflow that spawns the system editor.

## AMD-012: Custom retry with exponential backoff
- **Blueprint said**: Natively leverages LangChain's retry mechanisms
- **We implemented**: Custom `streamWithRetry` with exponential backoff (3 retries, 1s base)
- **Reason**: LangChain's built-in retry doesn't cover streaming failures cleanly. Custom retry gives us control over backoff timing and abort signal handling.
