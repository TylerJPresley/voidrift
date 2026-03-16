# Skill: Security Engineering

## Core Standards
- **OWASP Top 10:** Proactively mitigate risks like SQL Injection, XSS, and broken access control.
- **Authentication (AuthN):** Secure all endpoints using JWT (RS256), OAuth2, or OIDC.
- **Authorization (AuthZ):** Implement role-based (RBAC) or attribute-based (ABAC) access control.

## Implementation Rules
- **Input Validation:** Sanitize and validate all external input (URIs, Headers, Body, Params).
- **Secrets Management:** Use vault-based storage (AWS Secrets Manager, HashiCorp Vault); rotate regularly.
- **Encryption:** Use TLS 1.2+ for all transit; use AES-256 for data at rest.
- **API Hardening:** Enforce rate limiting, CORS, and secure headers (HSTS, CSP, X-Frame-Options).

## Auditing
- **Dependency Scanning:** Use automated tools (Snyk, Dependabot) to identify vulnerable libraries.
- **Security Logs:** Audit all failed authentication attempts and high-privilege operations.
- **PoLP:** Regularly audit IAM roles and permissions for least privilege alignment.
