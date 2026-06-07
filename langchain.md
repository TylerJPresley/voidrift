# LangChain Integration Audit

## Installed Packages

- `@langchain/core` ^1.1.48
- `@langchain/anthropic` ^1.4.0
- `@langchain/openai` ^1.4.7
- `@langchain/google-genai` ^2.1.31

---

## @langchain/core

### Runnables (Composition Engine)

| Interface | Purpose | Status |
|---|---|---|
| `RunnableSequence` | Chain steps: A → B → C | ❌ Manual async |
| `RunnableParallel` / `RunnableMap` | Run steps concurrently | ❌ |
| `RunnableBranch` | Conditional routing | ✅ `router/branch.ts` |
| `RunnableLambda` | Wrap any function as a Runnable | ✅ `orchestration/tool-loop.ts` |
| `RunnablePassthrough` | Pass input through unchanged | ❌ |
| `RunnablePick` | Select specific keys from input | ❌ |
| `RunnableAssign` | Add computed fields to input | ❌ |
| `RunnableEach` | Map a Runnable over array items | ❌ |
| `RunnableRetry` | Declarative retry with backoff | ❌ Custom `streamWithRetry` |
| `RunnableWithFallbacks` | Failover chain | ✅ `adapters/fallbacks.ts` |
| `RunnableWithMessageHistory` | Auto-inject/persist session history | ❌ Manual `ContextManager` |
| `RunnableBinding` | Bind default args to a Runnable | ❌ |
| `RouterRunnable` | Dynamic dispatch by key | ❌ |
| `RunnableToolLike` | Make any Runnable look like a tool | ❌ |

### Messages

| Interface | Purpose | Status |
|---|---|---|
| `HumanMessage` / `AIMessage` / `SystemMessage` / `ToolMessage` | Core message types | ✅ |
| `AIMessageChunk` | Streaming accumulation | ✅ `adapters/stream.ts` |
| `RemoveMessage` | Remove a message by ID from history | ❌ |
| `trimMessages()` | Token-aware history trimming | ✅ `adapters/trimmer.ts` |
| `filterMessages()` | Filter by role/type/predicate | ❌ Custom extractors in compactor |
| `mergeMessageRuns()` | Merge consecutive same-role messages | ✅ `orchestration/tool-loop.ts` |
| `convertToChunk()` | Convert full message to chunk type | ❌ |
| `getBufferString()` | Serialize messages to string | ❌ |
| `isAIMessage()` / `isToolMessage()` etc. | Type guards | ❌ Manual checks |

### Prompts

| Interface | Purpose | Status |
|---|---|---|
| `ChatPromptTemplate` | Typed prompt composition | ✅ `session/compiler.ts` |
| `MessagesPlaceholder` | Dynamic history injection | ✅ `session/compiler.ts` |
| `FewShotChatMessagePromptTemplate` | Dynamic few-shot examples | ❌ Manual in `tools/few-shot.ts` |
| `PipelinePromptTemplate` | Compose sub-templates | ❌ |
| `SystemMessagePromptTemplate` | Typed system message template | ❌ |
| `ImagePromptTemplate` | Multi-modal image input | ❌ |
| `StructuredPrompt` | Schema-validated prompt output | ❌ |

### Tools

| Interface | Purpose | Status |
|---|---|---|
| `tool()` | Quick tool creation with Zod | ✅ `tools/langchain-tools.ts` |
| `DynamicStructuredTool` | Tool with runtime execution | ❌ Noop pattern |
| `StructuredTool` | Base class for custom tools | ❌ |
| `BaseToolkit` | Group related tools | ❌ |
| `ClientTool` / `ServerTool` | MCP client/server tools | ❌ Own MCP engine |

### Output Parsers

| Interface | Purpose | Status |
|---|---|---|
| `StringOutputParser` | Extract text from model output | ❌ Manual `.content` |
| `JsonOutputParser` | Parse JSON from model output | ❌ Manual `JSON.parse` |
| `StructuredOutputParser` | Validate against Zod schema | ✅ Via `withStructuredOutput` |
| `CommaSeparatedListOutputParser` | Parse comma lists | ❌ |
| `XMLOutputParser` | Parse XML responses | ❌ |

### Caches

| Interface | Purpose | Status |
|---|---|---|
| `InMemoryCache` | Cache identical prompts | ✅ `adapters/cache.ts` |
| `BaseCache` | Custom cache implementations | ❌ |

### Chat History

| Interface | Purpose | Status |
|---|---|---|
| `InMemoryChatMessageHistory` | In-memory message store | ❌ Own `messages[]` |
| `BaseChatMessageHistory` | Base class for persistence | ❌ Own serializer |

### Callbacks & Tracers

| Interface | Purpose | Status |
|---|---|---|
| `BaseCallbackHandler` | Lifecycle hooks | ✅ `adapters/callbacks.ts` |
| `CallbackManager` | Manage multiple handlers | ❌ Single handler |
| `ConsoleCallbackHandler` | Debug logging | ❌ |
| `LangChainTracer` | LangSmith tracing | ✅ Via config |
| `LogStreamCallbackHandler` | Stream logs | ❌ |
| `RunCollectorCallbackHandler` | Collect run data | ❌ |

### Language Models

| Interface | Purpose | Status |
|---|---|---|
| `BaseChatModel` | Model abstraction | ✅ |
| `.streamEvents()` | Full lifecycle streaming | ✅ `adapters/stream.ts` |
| `.withStructuredOutput()` | Typed JSON responses | ✅ `adapters/structured.ts` |
| `.withFallbacks()` | Failover chains | ✅ `adapters/fallbacks.ts` |
| `.bindTools()` | Bind tool schemas | ✅ `orchestration/graph.ts` |
| `.getNumTokens()` | Token counting | ✅ `adapters/tokens.ts` |
| `getModelContextSize()` | Get context window size | ❌ Manual in config |

### Errors

| Interface | Purpose | Status |
|---|---|---|
| `ContextOverflowError` | Context window exceeded | ❌ Manual threshold |
| `ModelAbortError` | Model cancelled | ❌ Manual signal check |

### Stores & Retrieval

| Interface | Purpose | Status |
|---|---|---|
| `InMemoryStore` | Generic KV store | ❌ Own filesystem |
| `Embeddings` | Vector embeddings | ❌ |
| `VectorStore` / `VectorStoreRetriever` | Similarity search | ❌ |
| `Document` | Document abstraction | ❌ |
| `BaseExampleSelector` | Dynamic example selection | ❌ |

---

## @langchain/anthropic

| Interface | Purpose | Status |
|---|---|---|
| `ChatAnthropic` | Claude model adapter | ✅ `adapters/factory.ts` |
| `tools.textEditor_20250728` | Native text editor (str_replace, view, create, insert) | ✅ `tools/anthropic-native.ts` |
| `tools.bash_20250124` | Native bash execution | ✅ `tools/anthropic-native.ts` |
| `tools.computer_20251124` | Computer use (screenshot, click, type) | ❌ Not needed |
| `tools.codeExecution` | Code execution sandbox | ❌ |
| `tools.webSearch` | Claude's web search | ❌ Own implementation |
| `tools.webFetch` | Claude's web fetch | ❌ Own implementation |
| `tools.mcpToolset` | MCP toolset adapter | ❌ Own MCP engine |
| `MemoryTool20250818` | Claude's native memory tool | ❌ Own memory system |
| `cache_control` | Prompt caching (ephemeral breakpoints) | ✅ `adapters/factory.ts` |
| `convertPromptToAnthropic` | Message format conversion | ❌ LangChain handles internally |

---

## @langchain/openai

| Interface | Purpose | Status |
|---|---|---|
| `ChatOpenAI` | GPT/compatible model adapter | ✅ `adapters/factory.ts` |
| `ChatOpenAIResponses` | OpenAI Responses API | ❌ |
| `OpenAIEmbeddings` | Embeddings | ❌ |
| `tools.WebSearchTool` | OpenAI web search | ❌ Own implementation |
| `tools.FileSearchTool` | File search in vector store | ❌ |
| `tools.CodeInterpreterTool` | Code sandbox | ❌ |
| `tools.ComputerUseTool` | Computer use | ❌ |
| `tools.LocalShellTool` | Shell execution | ❌ Own implementation |
| `tools.ApplyPatchTool` | Apply file patches (unified diff) | ❌ Using edit_file |
| `tools.McpTool` | MCP connector | ❌ Own MCP engine |

---

## @langchain/google-genai

| Interface | Purpose | Status |
|---|---|---|
| `ChatGoogleGenerativeAI` | Gemini model adapter | ✅ `adapters/factory.ts` |
| `GoogleGenerativeAIEmbeddings` | Embeddings | ❌ |

---

## Priority Gaps to Close

### High Impact

1. **`RunnableSequence`** — Compose the full turn pipeline (route → bind tools → stream → execute → respond) as a single traceable chain. Enables LangSmith step-by-step visibility.

2. **`RunnableRetry`** — Replace custom `streamWithRetry` with declarative retry. Configurable backoff, attempt limits, and error filtering built in.

3. **`RunnableParallel`** — Run file summarization + code map generation concurrently with proper concurrency control.

4. **`RunnableWithMessageHistory`** — Replace manual history management. Automatic session persistence callbacks, input/output message extraction.

5. **`filterMessages()`** — Replace custom `extractDiagnostics` / `extractParameters` in the compactor with a declarative filter.

6. **`ContextOverflowError`** — Catch natively instead of manual threshold arithmetic.

### Medium Impact

7. **`StringOutputParser`** — Use in Runnable chains to extract text cleanly.

8. **`FewShotChatMessagePromptTemplate`** — Replace manual few-shot injection with dynamic example selection.

9. **`PipelinePromptTemplate`** — Model the four-layer system (Agent/Orbit/Drift/Void) as composable sub-templates.

10. **Message type guards** (`isAIMessage`, `isToolMessage`) — Replace manual `role === "tool"` checks.

### Low Impact / Future

11. **`VectorStore` + `Embeddings`** — When adding RAG/memory retrieval.

12. **OpenAI `ApplyPatchTool`** — Alternative to edit_file using unified diff format.

13. **`BaseExampleSelector`** — Semantic similarity-based few-shot selection.

14. **`InMemoryStore`** — Replace filesystem-based KV with typed store interface.
