---
name: SECURITY-TRUST
description: Authentication, authorization, input validation, secrets management, and secure coding patterns.
triggers:
  extensions: []
  files: []
  keywords: ["auth","jwt","oauth","permission","encryption","vulnerability","security","secret"]
agents: []
active: true
---

# SECURITY-TRUST

## Authentication

```typescript
// ✅ Verify tokens server-side, check expiry
const payload = jwt.verify(token, publicKey, { algorithms: ["RS256"] });
if (!payload.sub) throw new UnauthorizedError();

// ❌ Decode without verification
const payload = jwt.decode(token); // ANYONE can forge this
```

- Use RS256 (asymmetric) for JWTs, not HS256 (shared secret)
- Tokens expire. Refresh tokens rotate on use. No eternal sessions.
- Hash passwords with bcrypt/argon2. Never SHA256, never MD5.
- MFA for privileged operations (admin, payment, account deletion)

## Authorization

```typescript
// ✅ Check ownership at the data layer
const doc = await db.documents.findFirst({ where: { id, ownerId: user.id } });
if (!doc) throw new NotFoundError(); // don't leak existence

// ❌ Fetch then check (leaks existence via timing)
const doc = await db.documents.findFirst({ where: { id } });
if (doc.ownerId !== user.id) throw new ForbiddenError();
```

- Deny by default. Explicitly grant access, never implicitly allow.
- Check permissions at the data query level, not just the route level.
- Separate "not found" from "forbidden" — return 404 for resources the user can't access.

## Input Validation

```typescript
// ✅ Schema validation at the boundary
const input = UserCreateSchema.parse(req.body); // throws on invalid

// ❌ Trust and use directly
const { email, role } = req.body; // mass assignment, no validation
```

- Validate ALL external input (body, params, headers, query strings)
- Whitelist allowed fields — never pass raw input to database queries
- Sanitize HTML output to prevent XSS. Use template engines with auto-escaping.
- Parameterized queries only. Never string-interpolate SQL.

## Secrets

```
✅ process.env.DATABASE_URL (injected at runtime)
✅ AWS Secrets Manager / Vault with rotation
❌ const API_KEY = "sk-live-abc123" (committed to git)
❌ console.log("Connecting with:", connectionString) (logged secret)
```

- Secrets in env vars or secret stores. Never in code.
- Never log secrets, tokens, or credentials — even partially.
- Rotate secrets on suspected compromise. Automate rotation where possible.
- .env in .gitignore. .env.example with placeholder values committed.

## Headers

```
✅ Strict-Transport-Security: max-age=31536000; includeSubDomains
✅ Content-Security-Policy: default-src 'self'
✅ X-Content-Type-Options: nosniff
❌ Access-Control-Allow-Origin: * (on authenticated endpoints)
```

## Data Protection

- Encrypt PII at rest (AES-256). TLS 1.3 in transit.
- Mask PII in logs and non-production environments.
- Collect minimum data required. Define retention periods at design time.
- Right to deletion: design for it from the start, not as a retrofit.

## Stored Decisions (check memory first)

Before asking the user, check if these are already stored:
- Auth provider (Supabase, Auth0, custom)
- Token format and algorithm (RS256 JWT, session cookies)
- Encryption standard for PII
- CORS policy
- Rate limiting strategy

If missing, ask once and store as a directive memory.
