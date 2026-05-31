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
