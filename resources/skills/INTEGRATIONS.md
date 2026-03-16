# Skill: API Integrations

## Core Philosophy
- **Defensive Integration:** Never trust an external API; assume it will fail, slow down, or return unexpected data.
- **Resilience Patterns:** Implement Circuit Breakers, Retries with Exponential Backoff, and Timeouts for all external calls.
- **Contract Adherence:** Strictly follow external documentation; implement robust error handling for schema mismatches.

## Implementation Rules
- **Webhooks:** Secure webhook endpoints with signature validation; implement idempotency for processing events.
- **Rate Limiting:** Respect `Retry-After` headers and implement client-side rate limiting to prevent provider bans.
- **Authentication:** Securely manage API keys and OAuth tokens using secrets management.
- **Abstraction:** Wrap third-party SDKs or APIs in local adapters/gateways to decouple business logic from external changes.

## Monitoring
- **External Health:** Monitor latency and error rates for all third-party dependencies.
- **Logging:** Log external request/response metadata (excluding PII/Secrets) for debugging integration issues.
