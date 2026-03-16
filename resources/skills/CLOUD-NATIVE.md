# Skill: Cloud-Native (AWS-inspired)

## Core Pillars
- **Security:** Apply security at every layer; automate security best practices as code.
- **Reliability:** Automatically recover from failure; test recovery procedures via chaos engineering.
- **Performance Efficiency:** Use serverless architectures and managed services to "democratize" advanced technologies.
- **Cost Optimization:** Stop spending money on "undifferentiated heavy lifting"; use a consumption-based model.
- **Sustainability:** Maximize utilization of underlying hardware and adopt more efficient hardware/software offerings.

## Implementation Rules
- **Scale Horizontally:** Replace large, monolithic resources with multiple small resources to reduce the blast radius of failures.
- **Stop Guessing Capacity:** Use auto-scaling and monitoring to match demand exactly.
- **Global Reach:** Design for multi-region or multi-availability-zone deployments to minimize latency and maximize uptime.
- **Data in Transit/Rest:** Mandatory encryption for all data movement and storage.

## Architectural Patterns
- **Managed Services:** Prefer RDS, S3, and Fargate over managing raw EC2 instances.
- **Immutable Infrastructure:** Do not "patch" running servers; redeploy from fresh images.
