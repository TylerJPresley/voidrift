# Skill: Distributed Patterns

## Core Philosophy
- **Reliability in Chaos:** Assume the network is unreliable and nodes will fail. Design for eventual consistency and partition tolerance.
- **Scalability:** Move beyond monolithic architecture to patterns that support horizontal scaling across multiple data centers.

## Implementation Rules
- **CQRS:** Separate Read and Write models to optimize for high-performance data retrieval and complex updates.
- **Saga Pattern:** Manage long-running distributed transactions using orchestrators or choreographies to maintain consistency without 2PC.
- **Event Sourcing:** Store the state of the system as a sequence of immutable events for perfect audit trails and point-in-time recovery.
- **Idempotency:** All distributed operations must be idempotent to handle retries safely.
- **Consensus:** Implement or utilize consensus algorithms (Raft, Paxos) for critical coordination tasks (e.g., leader election).

## Patterns for Robustness
- **Circuit Breakers:** Prevent cascading failures by failing fast when a dependency is down.
- **Bulkheads:** Isolate system components to ensure a failure in one area doesn't bring down the entire system.
- **Backpressure:** Implement flow control to prevent overwhelming downstream services.
