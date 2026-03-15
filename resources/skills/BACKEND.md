# Skill: Backend (Java/Spring or Python/FastAPI)

## Stack Selection Rule
- **Java (Spring Boot 3.4+):** Use for complex business logic, multi-module systems, and heavy enterprise integration.
- **Python (FastAPI):** Use for small, lightweight APIs, data-centric services, or rapid prototyping.

---

## ☕ Java / Spring Boot Standards
- **Framework:** Spring Boot 3.4+ | **Build:** Maven
- **Principles:** RESTful (RFC 7807), BFF Pattern, SOLID
- **Security:** JWT (RS256) | **Observability:** Micrometer + X-Correlation-ID
- **Implementation:** Controllers → Services → Repositories. Use MapStruct and JSR-380 validation.

## 🐍 Python / FastAPI Standards
- **Framework:** FastAPI | **Package Manager:** `uv`
- **Principles:** RESTful (RFC 7807), Dependency Injection, Type Hinting (Pydantic v2)
- **Security:** OAuth2/JWT (PyJWT) | **Observability:** OpenTelemetry or custom Middleware for X-Correlation-ID
- **Implementation:**
    - Routers (Routing) → Services (Business) → Models (Data/SQLAlchemy).
    - Use Pydantic for DTOs and validation.
    - Strict Type Hinting required on all functions.
- **Testing:** `pytest` + `httpx` for integration tests.

---

## Universal Backend Rules
- **API Versioning:** URI-based (e.g., `/api/v1/`)
- **JSON Standard:** RFC 7807 (Problem Details) for all error responses.
- **Traceability:** Every transaction must carry an `X-Correlation-ID`.
- **Documentation:** Mandatory Javadoc (Java) or Docstrings (Python/Google style) for all services.
- **OpenAPI:** Maintain live Swagger/OpenAPI v3 definitions.
