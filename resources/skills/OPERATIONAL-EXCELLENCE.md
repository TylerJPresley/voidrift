# Skill: Operational Excellence (AWS-inspired)

## Core Principles
- **Operations as Code:** Define your entire workload (applications and infrastructure) in code to limit human error and ensure repeatability.
- **Frequent, Small, Reversible Changes:** Deploy in small increments so failures are easily isolated and reversed.
- **Anticipate Failure:** Perform "pre-mortem" exercises and use failure injection to identify and mitigate risks before they hit production.

## Implementation Rules
- **Refine Procedures Frequently:** Regularly review and update operational runbooks as the system evolves.
- **Learn from All Failures:** Drive continuous improvement through blameless post-mortems for every operational incident.
- **Traceability:** Enable real-time monitoring, alerting, and auditing for every action and change in the environment.
- **Standardized Response:** Create automated responses to common operational events (e.g., auto-healing, automated rollbacks).

## Operational Standards
- **Deployment Safety:** Use Blue/Green or Canary deployments as the default standard.
- **Observability First:** No feature is "done" until its operational health can be fully monitored and alerted.
