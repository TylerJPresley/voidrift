# Skill: Infrastructure

## Core Primitives
- **Networking:** Segregate resources into public, private, and isolated VPC subnets.
- **IAM (PoLP):** Implement the Principle of Least Privilege for all roles, users, and policies.
- **Compute:** Fargate/EKS for containerized apps; Lambda for serverless; EC2 for legacy.
- **Storage:** S3 for objects; EBS for blocks; RDS for relational data.

## Implementation Rules
- **IaC Standards:** All infrastructure must be defined in code (Terraform, AWS CDK, or Pulumi).
- **Secrets Management:** Use AWS Secrets Manager or Vault; never commit secrets or environment variables.
- **Environment Parity:** Maintain identical configurations across dev, staging, and production using modules.
- **Encryption:** Enable encryption at rest and in transit (TLS 1.2+) for all data services.
- **Tagging:** Apply mandatory tags for Environment, Project, Owner, and Cost Center.

## Operations
- **DR & Backup:** Implement automated backups and cross-region replication for critical data.
- **Scaling:** Configure auto-scaling based on CPU/Memory and request patterns.
