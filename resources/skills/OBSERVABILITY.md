# Skill: Observability

## Core Standards
- **Golden Signals:** Monitor Latency, Traffic, Errors, and Saturation for all services.
- **OpenTelemetry:** Use OTel standards for collecting logs, metrics, and traces.
- **Tracing:** Distribute `X-Correlation-ID` across all services to enable end-to-end trace analysis.

## Implementation Rules
- **Log Levels:** Use appropriate levels (DEBUG, INFO, WARN, ERROR, FATAL); no sensitive data in logs.
- **Structured Logging:** Use JSON for logs to enable easy indexing and searching.
- **Metrics:** Instrument with counters, gauges, and histograms; use meaningful labels.
- **Alarms:** Set actionable alerts on high error rates or latency P99 thresholds.

## Monitoring
- **Dashboards:** Maintain clear visualizations for critical path health and system load.
- **Dependency Health:** Monitor external API health and database performance.
- **Anomalies:** Investigate unexpected spikes or drops in traffic and error patterns.
