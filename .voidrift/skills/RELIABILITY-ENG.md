---
name: RELIABILITY-ENG
description: Eliminate toil, observability, retry logic, error budgets, and SLO-based reliability engineering principles.
triggers:
  extensions: []
  files: []
  keywords: ["slo","observability","retry","circuit breaker","monitoring","alerting"]
agents: []
active: true
---

# Domain: Reliability Engineering (RELIABILITY-ENG)

## Core Philosophy (Google SRE)
- **100% Reliability is Wrong:** Balance innovation velocity with system stability using Error Budgets.
- **Scale at Any Volume:** Treat the network as a scarce resource; prioritize binary protocols (Thrift/Proto) for high volume.
- **Eliminate Toil:** Automate manual, repetitive tasks to ensure effort remains focused on engineering.

## Implementation Rules
- **Defining SLOs:** Identify quantitative SLIs (Latency, Error Rate, Saturation) and set achievable targets.
- **Observability:** Instrument with OpenTelemetry (OTel); use structured JSON logging and distributed tracing.
- **Budget Policy:** If the error budget is exhausted, halt feature work and focus exclusively on reliability.
- **Blameless Culture:** Conduct post-mortems for all failures to improve systems without assigning blame.

## Performance Efficiency
- **Golden Signals:** Actively monitor Latency, Traffic, Errors, and Saturation.
- **Optimized Communication:** Prefer push-based models (MQTT/WebSockets) over polling to save power and network.
