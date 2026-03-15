# Design: [Feature/Bug Name]

## 1. Architectural Blueprint
- **BFF Strategy:** [Shaping for UI, token exchange, etc.]
- **Service Mesh/Gateway:** [Routing, Auth]

## 2. Data Model & State
- **Entities/Models:** [Schema changes, Pydantic/JSR-380 DTOs]
- **Persistence:** [PostgreSQL/SQLAlchemy, Redis, S3]

## 3. Interface Contracts (API/CLI)
- **Endpoints:** [URI, Verb, Request/Response shapes]
- **CLI Commands:** [Args, Flags, Output format]

## 4. Interaction Flows
- **Sequence Diagram:** [Mermaid syntax for flow]
- **Failure Modes:** [Error handling, Retry logic, Fallbacks]

## 5. Definition of Done
- [ ] Unit tests pass (TDD)
- [ ] Integration tests pass (httpx/AssertJ)
- [ ] Documentation updated (Javadoc/TSDoc)
- [ ] Linting/Formatting clean (ShellCheck/Clippy/vLLM)
