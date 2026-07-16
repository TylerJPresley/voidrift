# TODO: Config restructure — flat prefixed fields

## Final structure

```json
{
  "models": { "local": { "protocol": "openai", ... } },
  "plugins": [],
  "hooks": {},
  "editor": "nvim",

  "modelSelected": "auto",
  "modelTierFlash": "local",
  "modelTierUtility": "local",
  "modelTierDense": "local",
  "modelEscalationThreshold": 0.85,
  "modelEscalationFailureCount": 2,

  "turnsMaxToolRounds": 10,
  "turnsTrimThresholdLines": 80,
  "turnsTrimHead": 30,
  "turnsTrimTail": 20,
  "turnsContextBudgetStopPct": 0.6,
  "turnsReminderInterval": 25,
  "turnsLookbackCount": 2,
  "turnsMaxOutputLines": 50,
  "turnsMaxReadLines": 2000,
  "turnsSuggestionThreshold": 3,
  "turnsShowThinking": false,
  "turnsShowReasoning": false,

  "tasksMaxRunTurns": 50,
  "tasksMaxConcurrent": 1,
  "tasksWorktreeTtlMinutes": 120,
  "tasksPlanFeedbackLoop": 1,
  "tasksShowThinking": false,
  "tasksShowReasoning": false,

  "contextCompactionKeepRecent": 10,
  "contextDecayAfterTurns": 20,
  "contextKeepRecentTurns": 10,
  "contextCodeMapDepth": 5,
  "contextSummarizeThreshold": 500,
  "contextReflectionBatchSize": 3,

  "securityApprovalTimeout": 120,

  "networkModelRetries": 3,
  "networkModelTimeoutMs": 120000,
  "networkCommandTimeoutMs": 30000,
  "networkFetchTimeoutMs": 10000,
  "networkOauthCallbackPort": 9876,
  "networkWebMaxContentLength": 50000,
  "networkWebSmallFileLines": 50,

  "retentionMaxCacheAgeDays": 14,
  "retentionMaxSessionCount": 20,
  "retentionMaxLogAgeDays": 14
}
```

## Migration map

| Old | New |
|-----|-----|
| `tiers.flash` | `modelTierFlash` |
| `tiers.utility` | `modelTierUtility` |
| `tiers.dense` | `modelTierDense` |
| `selectedModel` | `modelSelected` |
| `orchestration.maxToolRounds` | `turnsMaxToolRounds` |
| `orchestration.trimThresholdLines` | `turnsTrimThresholdLines` |
| `orchestration.trimHead` | `turnsTrimHead` |
| `orchestration.trimTail` | `turnsTrimTail` |
| `orchestration.contextBudgetStopPct` | `turnsContextBudgetStopPct` |
| `orchestration.maxRunTurns` | `tasksMaxRunTurns` |
| `orchestration.escalationThreshold` | `modelEscalationThreshold` |
| `orchestration.escalationFailures` | `modelEscalationFailureCount` |
| `orchestration.suggestionThreshold` | `turnsSuggestionThreshold` |
| `toolLoopReminderInterval` | `turnsReminderInterval` |
| `contextLookbackTurns` | `turnsLookbackCount` |
| `summarizeThreshold` | `contextSummarizeThreshold` |
| `maxReadLines` | `turnsMaxReadLines` |
| `maxConcurrentAgents` | `tasksMaxConcurrent` |
| `approvalTimeout` | `securityApprovalTimeout` |
| `planFeedbackLoop` | `tasksPlanFeedbackLoop` |
| `network.modelRetries` | `networkModelRetries` |
| `network.modelTimeoutMs` | `networkModelTimeoutMs` |
| `network.commandTimeoutMs` | `networkCommandTimeoutMs` |
| `network.fetchTimeoutMs` | `networkFetchTimeoutMs` |
| `network.oauthCallbackPort` | `networkOauthCallbackPort` |
| `limits.maxOutputLines` | `turnsMaxOutputLines` |
| `limits.maxReadLines` | `turnsMaxReadLines` |
| `limits.codeMapDepth` | `contextCodeMapDepth` |
| `limits.webMaxContentLength` | `networkWebMaxContentLength` |
| `limits.webSmallFileLines` | `networkWebSmallFileLines` |
| `limits.worktreeTtlMinutes` | `tasksWorktreeTtlMinutes` |
| `limits.compactionKeepRecent` | `contextCompactionKeepRecent` |
| `limits.reflectionBatchSize` | `contextReflectionBatchSize` |
| `retention.maxCacheAgeDays` | `retentionMaxCacheAgeDays` |
| `retention.maxSessionCount` | `retentionMaxSessionCount` |
| `retention.maxLogAgeDays` | `retentionMaxLogAgeDays` |
| `retention.turnsDecayAfterCount` | `contextDecayAfterTurns` |
| `retention.turnsKeepRecentCount` | `contextKeepRecentTurns` |

## Removed nested objects
- `tiers` → flattened to modelTier* fields
- `orchestration` → split across turns*, tasks*, model*
- `limits` → split across turns*, context*, network*, tasks*
- `retention` → flattened to retention* fields
- `network` → flattened to network* fields

## Kept as nested objects
- `models` — dynamic map of model definitions
- `plugins` — array of plugin IDs
- `hooks` — map of event → commands
- `mcp` — map of server configs
- `search` — provider + apiKey
- `tracing` — enabled + apiKeyEnv + project

## Execution order
1. [ ] Rewrite config/loader.ts schema + DEFAULT_CONFIG
2. [ ] Update all call sites to read new field names
3. [ ] Update tests
4. [ ] Update README config tables
5. [ ] Update FEATURES.md config references
6. [ ] Update local .voidrift/config.json
7. [ ] Update global ~/.config/voidrift/config.json
8. [ ] Copy configs to docs/examples/
