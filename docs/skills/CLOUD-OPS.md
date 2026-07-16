---
name: CLOUD-OPS
description: Cloud-ready project structure — Dockerfiles, environment config, CI/CD pipelines, secrets handling, and deployment patterns.
triggers:
  extensions: [".yml",".yaml"]
  files: ["Dockerfile","docker-compose.yml",".github","Makefile"]
  keywords: ["docker","kubernetes","deploy","container","cloud","infrastructure","terraform","ci","cd","pipeline"]
agents: []
active: true
---

# CLOUD-OPS

## Project Structure for Cloud Readiness

```
✅ Cloud-ready project layout:
├── Dockerfile              # Multi-stage, production-ready
├── docker-compose.yml      # Local dev environment
├── .env.example            # Documented env vars (no secrets)
├── .github/workflows/      # CI/CD pipelines
├── Makefile                # Common tasks (build, test, deploy)
└── infra/                  # IaC (Terraform, CDK, Pulumi)

❌ "Works on my machine" layout:
├── src/
└── README.md               # "run npm start" (what about deps? env? db?)
```

## Dockerfiles

```dockerfile
# ✅ Multi-stage, pinned versions, non-root user
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

FROM node:22-alpine
RUN adduser -D appuser
USER appuser
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
CMD ["node", "dist/main.js"]

# ❌ Single stage, root, unpinned, dev deps in production
FROM node
COPY . .
RUN npm install
CMD ["npm", "start"]
```

## Environment Configuration

```
✅ .env.example committed with every required variable documented:
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
REDIS_URL=redis://localhost:6379
API_KEY=your-key-here

✅ .env in .gitignore (never committed)
✅ Validation on startup — fail fast if required vars are missing
❌ Hardcoded connection strings in source
❌ Different config mechanisms per environment
```

## Secrets Handling

```
✅ Environment variables injected at runtime
✅ Secret stores (AWS Secrets Manager, Vault, k8s secrets) for production
❌ Secrets in Dockerfile, docker-compose.yml, or committed config
❌ Secrets logged, even partially
```

## CI/CD Pipeline Structure

```yaml
# ✅ Standard pipeline stages
jobs:
  build:     # Compile, install deps
  test:      # Unit + integration tests
  lint:      # Code quality + security scan
  deploy:    # Only on main, after all gates pass
```

- Build once, deploy the same artifact everywhere
- Fail the pipeline on: test failure, lint error, vulnerability
- Container tags = git SHA (not `latest`)
- Deployments are rollback-capable

## Health Checks

Every deployable service exposes:
```
GET /health    → 200 (alive, no dependency checks)
GET /ready     → 200 (dependencies reachable, safe for traffic)
```

## Makefile Convention

```makefile
# ✅ Common tasks discoverable via make
.PHONY: build test dev deploy
build:    docker build -t myapp .
test:     docker compose run --rm app npm test
dev:      docker compose up
deploy:   ./scripts/deploy.sh
```

Standard targets: `build`, `test`, `dev`, `lint`, `deploy`, `clean`

## Stored Decisions (check memory first)

Before asking the user, check if these are already stored:
- Container registry URL
- Base image preference
- CI/CD provider (GitHub Actions, GitLab CI, etc.)
- Deploy target (ECS, k8s, Fly.io, etc.)
- IaC tool (Terraform, CDK, Pulumi)

If missing, ask once and store as a directive memory.
