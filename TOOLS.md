# Tool Consolidation Plan

25 tools → 10 domain tools with action parameters.

## Target Schema

| Domain | Tool | Actions | Replaces |
|---|---|---|---|
| Filesystem | `file` | `read`, `write`, `edit`, `delete`, `list` | read_source_file, read_framework_file, write_source_file, write_framework_file, edit_source_file, delete_source_file, list_project_artifacts, read_document |
| HTTP | `http` | `get`, `post`, `put`, `delete` | web_fetch, http_request |
| Shell | `shell` | — | run_command |
| Browser | `browser` | `navigate`, `screenshot`, `click`, `get_text` | browser_navigate, browser_screenshot, browser_click, browser_get_text |
| Process | `process` | `read_output` | read_process_output |
| Skills | `skill` | `get`, `list` | get_skill, list_skills |
| Memory | `memory` | `read`, `write`, `list`, `delete` | read_memory, write_memory, list_memory |
| Session | `session` | `search` | search_history |
| Analysis | `analyze` | `code`, `document` | code_analysis, read_document |
| Interactive | `ask` | — | ask_user_question |

## Per-Command Action Visibility

Each command sees the full tool but only the actions it needs.

| Command | file | http | shell | browser | process | skill | memory | session | analyze | ask |
|---|---|---|---|---|---|---|---|---|---|---|
| **gather** | read | — | — | — | — | — | — | — | code, document | — |
| **plan** | read, write | — | — | — | — | — | — | — | — | — |
| **develop** | read, write, edit, delete | — | ✓ | — | — | — | — | — | — | — |
| **chat** | read, write, edit, delete, list | get | ✓ | — | — | get, list | read, write, list, delete | search | code, document | ✓ |
| **verify-plan** | read, write | — | — | — | — | — | — | — | — | — |
| **verify-exec** | read, write | get, post, put, delete | ✓ | navigate, screenshot, click, get_text | read_output | — | — | — | — | — |
| **deploy** | read, write | — | — | — | — | — | — | — | — | — |

## Security Model

Path-based security replaces name-based domain separation:

- `file(action="read", path="src/main.py")` → allowed if path resolves within project root
- `file(action="read", path=".voidrift/REQUIREMENTS.md")` → allowed (`.voidrift/` is within project)
- `file(action="write", path="src/main.py")` → allowed for develop/chat, blocked for plan/gather
- `file(action="write", path=".voidrift/ARCHITECTURE.md")` → allowed for plan/chat, blocked for develop
- `file(action="write", path="../../etc/passwd")` → blocked (outside project root)
- `file(action="write", path="pyproject.toml")` → blocked (protected_paths)

The `WriteContext` already does path validation. The change: instead of separate handlers per domain, one handler checks the command context to decide what's writable.

### Write rules by command

| Command | Can write to project src | Can write to .voidrift/ |
|---|---|---|
| gather | ✗ | ✓ |
| plan | ✗ | ✓ |
| develop | ✓ | ✗ |
| chat | ✓ (permission gate) | ✓ (permission gate) |
| verify-plan | ✗ | ✓ |
| verify-exec | ✗ | ✓ (bugs only) |
| deploy | ✓ | ✗ |

### HTTP security

- `http(action="get", url="...")` in chat → SSRF check + operator confirmation (like current web_fetch)
- `http(action="get", url="...")` in verify-exec → SSRF check, no confirmation
- `http(action="post", ...)` in verify-exec → SSRF check, session persistence
- Loopback allowed. Private IPs blocked unless in ssrf_allow_list.

## File Format Detection

`file(action="read")` auto-detects format by extension:

| Extension | Handler | Library |
|---|---|---|
| `.pdf` | pymupdf text extraction | soft dep |
| `.docx` | python-docx heading-aware extraction | soft dep |
| `.xlsx` | openpyxl markdown tables | soft dep |
| everything else | plain text with pagination | built-in |

This merges `read_document` into `file`. The `analyze` tool keeps `document` action for cases where the model wants structured extraction metadata rather than raw text.

## Phases

### Phase 1: New schemas + dispatch handlers

**Files:** `tools/registry.py`, `tools/filesystem.py`, `tools/tool_builder.py`

1. Define 10 new tool schemas in `registry.py` with `action` as required enum parameter
2. Create dispatch handlers that route `file(action="read", path="x")` → existing `WriteContext.read_source_file(path)` / `WriteContext.read_framework_file(path)` based on path
3. Keep old schemas as `LEGACY_TOOLS` list — not removed yet
4. `build_local_tools` returns new schemas when `cmd` is specified, legacy when not
5. Validate: all existing tests pass unchanged (they use legacy names)

**Deliverable:** New tools work. Old tools still work. No behavioral change.

### Phase 2: Agent loop updates

**Files:** `agent.py`, `agent_context.py`

Hardcoded tool name references in the agent loop:

| Location | Current | New |
|---|---|---|
| Concurrent-safe set | `{"read_source_file", "read_framework_file", "list_project_artifacts", "web_fetch"}` | `{"file", "http", "skill", "memory", "session", "analyze"}` (read-only tools) |
| Write tracking | `{"write_source_file", "edit_source_file", "write_framework_file"}` | Check `tool=="file" and action in ("write","edit","delete")` |
| Stall recovery strip | Keep only write tools + done | Check action-based |
| Normalizers | Path stripping for read/write tools | Path stripping for `file` tool |
| Snip read tools | `{"read_source_file", "read_framework_file"}` | `tool=="file" and action=="read"` |

**Deliverable:** Agent loop works with new tool names. Old tool names no longer hardcoded.

### Phase 3: Command modules

**Files:** All command modules (gather.py, plan.py, develop.py, chat.py, verify.py, deploy.py)

1. Update `AGENT_TOOLS` frozensets to new names with action lists
2. Update `tool_builder.py` to filter actions per command
3. Update `_develop_pipeline.py` done-guard and nudge messages
4. Update `_chat_idea.py` prompt references
5. Update `gather.py` source read context

**Deliverable:** All commands use new tool names. Per-command action filtering works.

### Phase 4: Prompts and resources

**Files:** All files in `resources/prompts/` and `resources/skills/`

| File | References to update |
|---|---|
| `system.md` | Tool guidelines section, file size guidance |
| `chat.md` | Tool references in CHAT-ROLE |
| `plan.md` | write_framework_file → file(action="write") |
| `develop.md` | read/write/edit references |
| `verify.md` | read/write/process/browser references |
| `deploy.md` | write_source_file reference |
| `skills/WORKFLOW.md` | Tool usage examples |
| `skills/WEB-RESEARCH.md` | web_fetch reference |
| `templates/DOMAIN-SKILL-TEMPLATE.md` | get_skill/list_skills references |

**Deliverable:** All prompts reference new tool names. Models see consistent naming.

### Phase 5: Tests + cleanup

**Files:** All 18 test files

1. Update test tool names and schemas
2. Update mock tool calls in cassettes
3. Remove `LEGACY_TOOLS` from registry
4. Remove old handler wiring from tool_builder
5. Final audit: `grep -r "read_source_file\|write_source_file\|edit_source_file"` returns zero hits

**Deliverable:** Clean codebase. No legacy references. All tests pass.

### Phase 6: Requirements + docs

**Files:** `REQUIREMENTS.md`, `ARCHITECTURE.md`, `README.md`

1. Update REQ-ARCH-9 (per-command tool visibility) for new schema
2. Update REQ-TOOL-3 (registry organization) for new groups
3. Update REQ-FSZ-* (file size) for `file` tool
4. Update REQ-SEC-* for unified path security
5. Update architecture data flows
6. Update README tool references

**Deliverable:** All documentation current. Requirements match implementation.
