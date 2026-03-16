# Skill: Scale & Performance (Meta-inspired)

## Core Philosophy
- **Network is a Scarce Resource:** Treat every byte sent over the wire as a cost. Minimize payload sizes and round-trips.
- **Done is Better Than Perfect:** Ship MVPs and iterate based on real-world usage data. Avoid over-engineering before validation.
- **Impact-Driven Execution:** Prioritize work that provides the highest measurable impact to user experience or system efficiency.

## Implementation Rules
- **Binary Protocols:** Prefer binary serialization (Thrift, Protocol Buffers) over JSON for high-volume internal service communication.
- **Push-Based Models:** Use real-time push protocols (MQTT, WebSockets) instead of polling to save power and network.
- **Hardware-Software Co-design:** Optimize code for specific device/hardware capabilities (e.g., GPU acceleration, image sizing).
- **Monorepo Workflow:** Maintain a unified tech stack and deploy "diff by diff" to ensure atomic changes and rapid iteration.

## Performance Standards
- **Latency Budgets:** Define and enforce strict latency budgets for every critical user interaction.
- **Micro-Optimizations:** Proactively optimize "hot paths" (e.g., scrolling, initial load, data deserialization).
