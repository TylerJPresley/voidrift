---
name: CLOUD-OPS
description: Container lifecycle management, secrets handling, SSH operations, and environment parity for cloud infrastructure operations.
---

# Domain: Cloud Operations (CLOUD-OPS)

## Core Philosophy (AWS Well-Architected)
- **Operations as Code:** Define applications and infrastructure programmatically to ensure repeatability.
- **Frequent, Small, Reversible Changes:** Design workloads for incremental updates to limit human error.
- **Performance & Cost:** Use serverless/managed services (Fargate, S3, RDS) to democratize technology and right-size costs.

## Implementation Rules
- **IaC Standards:** All infrastructure must be defined in Terraform, AWS CDK, or Pulumi; no manual changes.
- **Deployment Safety:** Default to Blue/Green, Canary, or Rolling updates to minimize downtime.
- **CI/CD Automation:** Build once, deploy many; artifacts must be immutable across all environments.
- **Secrets Management:** Use vault-based storage (AWS Secrets Manager, Vault); never hardcode credentials.

## Operational Excellence
- **Anticipate Failure:** Perform "pre-mortems" and use failure injection to mitigate risks before production.
- **Environment Parity:** Maintain identical configurations across dev, staging, and prod using modular IaC.
- **Security at All Layers:** Apply principle of least privilege (PoLP) and encryption at rest/transit (TLS 1.2+).
