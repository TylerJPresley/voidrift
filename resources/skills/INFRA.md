# Skill: Infrastructure (AWS / CDK / Terraform)

## Architecture & Standards
- **Provisioning:** AWS CDK (TypeScript preferred) or Terraform.
- **Security:** Principle of Least Privilege (PoLP) for IAM roles/policies.
- **Networking:** Segregated VPC subnets (Public/Private/Isolated).
- **Compute:** Serverless (Lambda) or Containerized (Fargate/EKS) based on workload.

## Implementation Rules
- **Environment Parity:** Use Stacks/Modules to ensure Dev/Staging/Prod consistency.
- **Secrets:** Never hardcode credentials; use AWS Secrets Manager or Parameter Store.
- **Observability:** Enable CloudWatch Logs, X-Ray tracing, and Metric alarms for all critical resources.
- **Tagging:** Mandatory tagging for Cost Allocation and Ownership (Environment, Project, Owner).

## Documentation & Metadata
- **Architecture Diagrams:** Provide Mermaid/C4 diagrams for infrastructure changes.
- **Cost Impact:** Briefly note the cost implications of new resources in the ADR.
