# Skill: Security

## Core Principle
Security is not a feature added at the end. Every design decision is a security decision.

## Authentication & Authorization
- **JWT:** RS256 (asymmetric) only. Never HS256 in production — shared secrets can't be rotated safely.
- **Token storage:** `httpOnly` cookies for browser clients. Never `localStorage`.
- **Refresh tokens:** Store server-side with rotation on use. Single-use only.
- **Authorization:** Enforce at the service layer, not just the controller. Never trust the client's claimed identity.
- **Principle of Least Privilege (PoLP):** Every service account, IAM role, and API key gets exactly the permissions it needs and nothing more.

## Input Validation
- Validate at every system boundary: API entry points, queue consumers, file uploads.
- Reject unknown fields — do not pass through unvalidated input.
- Parameterize all database queries. No string concatenation in SQL.
- Sanitize file paths. Prevent directory traversal (`../`) via allowlists, not blocklists.

## Secrets Management
- No secrets in source code, environment files, or Docker images.
- Use AWS Secrets Manager or Parameter Store for runtime secrets.
- Rotate secrets on suspected compromise — not on a fixed schedule alone.
- Never log secrets, tokens, PII, or credentials. Audit log output before shipping.

## API Security
- Rate-limit all public endpoints. Return `429 Too Many Requests` with `Retry-After`.
- Set security headers: `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`.
- CORS: explicit allowlist of origins. Never `*` in production.
- Validate `Content-Type` on all POST/PUT/PATCH requests.

## Dependency Management
- Pin dependency versions. Review changelogs before upgrading.
- Run `npm audit` / `mvn dependency-check` in CI. Fail on HIGH or CRITICAL CVEs.

## Red Flags
- Any `TODO: add auth` comment
- Secrets passed via environment variables in docker-compose (use secrets instead)
- `console.log` or logger statements that include request bodies
- CORS set to `*`
- JWT verified only on the frontend
