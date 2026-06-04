---
name: SECURITY-TRUST
description: Authentication, authorization, threat modeling, least privilege, and secure-by-default security and trust principles.
triggers:
  extensions: []
  files: []
  keywords: ["auth","jwt","oauth","permission","encryption","vulnerability","security"]
agents: []
active: true
---

# Domain: Security & Trust (SECURITY-TRUST)

## Core Philosophy
- **Privacy by Design:** Integrate data protection into the system architecture from the start.
- **Trust through Transparency:** Be clear about data collection and protect it with global standards (GDPR, SOC2).
- **Security at Every Layer:** Do not rely on perimeter defense; implement "Secure by Default" and PoLP.

## Implementation Rules
- **API Hardening:** Enforce rate limiting, CORS, and secure headers (HSTS, CSP).
- **Authentication:** Secure all endpoints with JWT (RS256), OAuth2, or OIDC; enforce MFA.
- **Data Protection:** Mandatory AES-256 for PII at rest and TLS 1.3 in transit.
- **Sanitization:** Strictly validate all external input (URIs, Headers, Body) against schemas.

## Compliance
- **Anonymization:** Mask PII in logs, reports, and non-production environments.
- **Auditing:** Maintain immutable audit trails for all sensitive data access and configuration changes.
- **Minimization:** Only collect the absolute minimum data required for the feature.
