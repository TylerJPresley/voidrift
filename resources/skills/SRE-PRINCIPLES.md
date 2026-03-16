# Skill: SRE Principles (Google-inspired)

## Core Philosophy
- **Reliability is a Feature:** 100% reliability is the wrong target. Aim for the level of reliability that satisfies users while allowing for maximum feature velocity.
- **Error Budgets:** Use the mathematical gap between 100% and your SLO as a "budget" for taking risks (e.g., fast deployments, experiments).
- **Eliminate Toil:** Identify and automate manual, repetitive, non-creative work ("toil"). SRE effort should be 50% engineering, 50% operations.

## Implementation Rules
- **Define SLIs:** Identify quantitative measures (Latency, Error Rate, Throughput) that represent the user's experience.
- **Set SLOs:** Define specific targets for SLIs (e.g., 99.9% of requests succeed).
- **Enforce Budget Policy:** If the error budget is exhausted, halt all non-emergency changes and focus exclusively on reliability and technical debt.
- **Blameless Postmortems:** Focus on system flaws, not human error. Document what happened, why, and how to prevent it.

## Monitoring & Simplicity
- **User-Centric Monitoring:** Monitor what the user sees, not just internal resource metrics.
- **Simplicity is a Prerequisite:** Proactively remove unused features and complexity to improve system stability.
