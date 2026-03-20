# Project VoidRift

**Local-first Agentic Development Framework**

A local-first AI development lifecycle tool that routes work between a primary model (task execution) and an optional architect model (escalation and design). Any model can fill either role. The five phases — Gather → Plan → Develop → Automate → Verify — produce a deployable, tested project from requirements alone.

## Setup & Configuration

### Workstation Setup

The workstation is where you (the operator) run `voidrift` commands. It orchestrates the workflow and communicates with the worker node.

**Requirements:**
- Linux, macOS, or WSL2
- Bash shell
- Git
- SSH client (for local worker models)
- Network access to worker node (if using local models)

**Installation:**

1. **Clone the framework:**
   ```bash
   git clone <repo-url> ~/Projects/voidrift
   ```

2. **Install both packages (editable):**
   ```bash
   cd ~/Projects/voidrift
   make install
   # Or manually:
   pip install -e cli/
   pip install -e mcp-context-server/
   pip install -e worker-cli/
   ```

3. **Verify installation:**
   ```bash
   voidrift
   ```

**Configuration:**

All settings live in `~/.voidrift/config.yml`. Sync from the repo:

```bash
make sync
```

Edit `~/.voidrift/config.yml` with your settings:

```yaml
worker:
  user: your-username
  ip: 192.168.x.x
  api_key: ${OPENAI_API_KEY:-no-key}
  hf_token: ${HF_TOKEN}

kiro:
  port: 8000
  api_key: ${KIRO_API_KEY}

api_keys:
  anthropic: ${ANTHROPIC_API_KEY}
  gemini: ${GEMINI_API_KEY}
```

API keys are set as environment variables in your shell profile (`~/.bashrc`):

```bash
export ANTHROPIC_API_KEY="your-key"
export GEMINI_API_KEY="your-key"
export KIRO_API_KEY="your-proxy-api-key"
export HF_TOKEN="your-token"
```

### Worker Node Setup

The worker node is a GPU server that runs local LLM containers. It's optional — you can use cloud models exclusively.

**Hardware:**

The default configuration is optimized for the ASUS Ascent GX10:
- **Processor:** NVIDIA GB10 Grace Blackwell Superchip (20-core Arm CPU + Blackwell GPU)
- **Memory:** 128GB unified LPDDR5x-8533 (shared CPU/GPU)
- **AI Performance:** 1 petaFLOP (FP4), supports up to 200B parameter models
- **Storage:** 1-4TB NVMe PCIe 4.0 SSD
- **Network:** 10GbE (upgradeable to 200GbE with ConnectX-7)

The unified memory architecture allows efficient model loading without CPU-GPU transfers. GPU memory utilization is set to 0.90 (90%) with FlashInfer attention backend, optimized for GB10's unified memory architecture.

**Software Requirements:**
- Linux (Ubuntu 22.04+ recommended)
- Docker or Podman
- NVIDIA drivers and container toolkit
- SSH server
- Python 3.10+ with `uv` (for model downloads)

**Setup Steps:**

1. **Install Docker and NVIDIA Container Toolkit:**
   ```bash
   # Install Docker
   curl -fsSL https://get.docker.com | sh
   
   # Install NVIDIA Container Toolkit
   distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
   curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
   curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
     sudo tee /etc/apt/sources.list.d/nvidia-docker.list
   sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
   sudo systemctl restart docker
   ```

2. **Configure SSH access:**
   ```bash
   # On workstation, copy SSH key to worker (use values from config.yml)
   ssh-copy-id <user>@<ip>
   
   # Test connection
   ssh <user>@<ip> "echo 'Connection successful'"
   ```

3. **Install uv for model management:**
   ```bash
   ssh <user>@<ip>
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

4. **Download initial models:**
   ```bash
   worker models add qwen3-coder Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8
   worker models add qwen3-instruct Qwen/Qwen3-30B-A3B-Instruct-2507-FP8
   worker models add qwen3-8b Qwen/Qwen3-8B-FP8
   ```

5. **Pull vLLM Docker image:**
   ```bash
   worker images pull
   ```

6. **Verify setup:**
   ```bash
   worker check
   ```
   All checks should show ✅. Fix any ❌ items before proceeding.

**Available Docker Images:**

Three options are available for running vLLM on the GB10 Grace Blackwell Superchip:

| Image | Tag | Size |
|-------|-----|------|
| `scitrera/dgx-spark-vllm` | `0.17.0-t5` | 8.46 GB |
| `vllm/vllm-openai` | `latest-aarch64-cu130` | 8.73 GB |
| `nvcr.io/nvidia/vllm` | `26.02-py3` | varies |

**`scitrera/dgx-spark-vllm` (default, recommended)**
A community image purpose-built for the NVIDIA DGX Spark / GB10 Grace Blackwell Superchip. This is an arm64-only image with a rapid release cadence that mirrors upstream vLLM versions. Use this as your default — it is the most tested option for this specific hardware and consistently produces the smallest image sizes. Update `docker_image` in `worker-models.yml` to pick up new releases.

**`vllm/vllm-openai` (official upstream)**
The official vLLM project image. The `cu130`-suffixed tags are built against CUDA 13.0 — Blackwell's native toolkit — and compile support for SM_100 (GB10) alongside older architectures. Use this when you need a pinned upstream vLLM version that `scitrera` has not yet published, or when troubleshooting to rule out image-specific issues. Pull the arm64-specific tag to avoid pulling the larger multi-arch manifest:
```bash
ssh <user>@<ip> "docker pull vllm/vllm-openai:latest-aarch64-cu130"
```

**`nvcr.io/nvidia/vllm` (NVIDIA NGC)**
NVIDIA's officially validated container, released monthly (e.g. `26.02-py3` = February 2026). Built on NVIDIA's own validated CUDA stack with enterprise-quality library combinations. May include TensorRT-LLM integration and hardware-specific optimizations not present in the community image. Use this when you want NVIDIA's official validation for the GB10 platform, are evaluating TensorRT-LLM-backed inference, or need enterprise support guarantees:
```bash
ssh <user>@<ip> "docker pull nvcr.io/nvidia/vllm:26.02-py3"
```

**Worker Node Management:**

```bash
# List configured and cached models with status
worker models list

# Add a model (downloads weights + adds to config)
worker models add <alias> <repo>

# Remove a model (deletes weights + retires config)
worker models remove <alias>

# Audit models, download missing, report unconfigured
worker models check
worker models check --prune  # remove unconfigured cached models

# Reset compiled kernel caches (if experiencing GPU issues)
worker cache clear

# Check active model and gateway status
worker status

# View container logs
worker logs
worker logs -f

# Worker node GPU, disk, and memory
worker info

# Pull vLLM docker image (default from config)
worker images pull

# Pull a specific image
worker images pull vllm/vllm-openai:latest-aarch64-cu130

# Shell completions
worker completions bash > ~/.local/share/bash-completion/completions/worker
voidrift completions bash > ~/.local/share/bash-completion/completions/voidrift
```

### Framework Configuration

**Model Configuration:**

Local models are defined in `~/.voidrift/worker-models.yml`:

```yaml
models:
  qwen3-coder:
    repository: Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8
    served_model_name: qwen3-coder
    docker_image: scitrera/dgx-spark-vllm:0.17.0-t5
    gpu_memory_utilization: 0.90
    max_model_len: 65536
    vllm_args:
      - --enable-prefix-caching
      - --tool-call-parser qwen3_coder
      - --enable-auto-tool-choice
      - --attention-backend flashinfer
    notes: Code-focused, 30B parameters, larger context

worker:
  port: 8000
  container_prefix: worker-
  cache_mounts:
    - ~/.cache/huggingface:/root/.cache/huggingface
    - ~/.cache/vllm:/root/.cache/vllm
```

**Container Lifecycle:**

The framework automatically:
- Stops other worker containers (single-worker constraint)
- Reuses existing containers if configuration matches
- Mounts cache directories to persist model weights and compiled kernels
- Monitors container health during startup

Use `worker start <alias> --refresh` to force container recreation even if already running.

**Performance Benchmarks:**

All benchmarks run on ASUS Ascent GX10 with vLLM 0.17.0-t5, FlashInfer backend, 100 requests @ 1 req/s (ShareGPT dataset).

**qwen3-8b (8B general-purpose) - FASTEST:**
```
Model:                   Qwen3-8B-FP8
GPU utilization:         0.95
Output throughput:       176 tok/s
Mean TTFT:               307 ms
Median TTFT:             149 ms
P99 TTFT:                3288 ms
Mean TPOT:               44 ms
Median TPOT:             44 ms
Mean ITL:                44 ms

Startup:
- Model loading:         ~2 minutes
- CUDA graph capture:    ~15 seconds
- Total ready:           ~2.5 minutes
- Model memory:          ~8 GiB
- KV cache available:    ~97 GiB (2.4M+ tokens)
- Max concurrency:       Very high (huge KV cache)

Best for: Interactive work (gather, chat), fastest generation
Trade-offs: General-purpose model (not code-specialized)
```

**qwen3-instruct (30B MoE) - RECOMMENDED FOR GATHER/PLAN:**
```
Model:                   Qwen3-30B-A3B-Instruct-2507-FP8
GPU utilization:         0.90
Output throughput:       158 tok/s
Mean TTFT:               318 ms
Median TTFT:             253 ms
P99 TTFT:                2279 ms
Mean TPOT:               83 ms
Median TPOT:             86 ms
Mean ITL:                82 ms

Startup:
- Model loading:         ~3 minutes
- CUDA graph capture:    ~7 seconds
- Total ready:           ~4 minutes
- Model memory:          29 GiB
- KV cache available:    76 GiB (830k tokens)
- Max concurrency:       12.67x

Best for: General reasoning, requirements and architecture discussions
Trade-offs: Nearly identical performance to qwen3-coder
```

**qwen3-coder (30B MoE) - RECOMMENDED FOR CODE:**
```
Model:                   Qwen3-Coder-30B-A3B-Instruct-FP8
GPU utilization:         0.90
Output throughput:       152 tok/s
Mean TTFT:               273 ms
Median TTFT:             249 ms
P99 TTFT:                887 ms
Mean TPOT:               82 ms
Median TPOT:             84 ms
Mean ITL:                80 ms

Startup:
- Model loading:         ~3 minutes
- CUDA graph capture:    ~38 seconds
- Total ready:           ~4.5 minutes
- Model memory:          29 GiB
- KV cache available:    76 GiB (900k+ tokens)
- Max concurrency:       High (large KV cache)

Best for: Code generation, development tasks, balanced performance
```

**qwen3-coder-next (80B MoE):**
```
Model:                   RedHatAI/Qwen3-Coder-Next-FP8-dynamic
GPU utilization:         0.90
Output throughput:       124 tok/s (-18% vs qwen3-coder)
Mean TTFT:               1070 ms (+292% vs qwen3-coder)
Median TTFT:             634 ms (+155% vs qwen3-coder)
P99 TTFT:                5385 ms (+507% vs qwen3-coder)
Mean TPOT:               166 ms (+102% vs qwen3-coder)
Median TPOT:             171 ms (+104% vs qwen3-coder)
Mean ITL:                157 ms (+96% vs qwen3-coder)

Startup:
- Model loading:         ~8.5 minutes
- CUDA graph capture:    ~14 seconds
- Total ready:           ~9.5 minutes
- Model memory:          76 GiB
- KV cache available:    29 GiB (318k tokens)
- Max concurrency:       18.41x (limited by small KV cache)

Best for: Complex reasoning, single-request workloads
Trade-offs: 2x slower generation, much higher TTFT, lower concurrency
```

**Recommendations:**
- **Gather / Plan:** Use **qwen3-instruct** - general-purpose reasoning, architecture and requirements discussions
- **Code development:** Use **qwen3-coder** - best balance of speed and code quality
- **Complex reasoning:** Use **qwen3-coder-next** - highest capability, slower generation
- **Quick chat:** Use **qwen3-8b** - fastest generation (176 tok/s)

Run benchmarks yourself:
```bash
worker bench 100 1  # 100 prompts at 1 req/s
```

**Kiro Gateway Setup:**

For free Claude models via Kiro Gateway, see [Kiro Gateway Setup](#kiro-gateway-setup) section below.

## Quick Start

```bash
# 1. Navigate to your project directory
cd ~/Projects/my-project
git init

# 2. Reverse-engineer requirements from existing code
voidrift gather claude /path/to/existing/project

# Or start fresh with interactive chat
voidrift chat claude

# 3. Plan architecture and tasks
voidrift plan claude

# 4. Start local model and develop
worker start qwen3-coder
voidrift develop qwen3-coder claude

# 5. Generate infrastructure
voidrift automate qwen3-coder

# 6. Verify quality
voidrift verify qwen3-coder claude
```

## Commands

### Phase Commands

- **`voidrift gather <model> <path> [--force]`** - Reverse-engineer requirements from existing codebase
  - `--force` - Overwrite existing requirements (default: error if file exists)
- **`voidrift plan <model> [<feature>] [--fresh-start] [--update]`** - Generate architecture and tasks
  - `--fresh-start` - Delete existing planning artifacts and start fresh
  - `--update` - Revise existing plan to match current requirements
- **`voidrift develop <model> [<architect>]`** - Execute implementation tasks
- **`voidrift automate <model> [<architect>]`** - Generate infrastructure code
- **`voidrift verify <model> [<architect>]`** - Run quality checks and validation

### Utility Commands

- **`voidrift status`** - Show project phase status
- **`voidrift chat <model> [--doc <path>]`** - Interactive chat session with MCP tools
- **`voidrift log <phase> [--prune] [-f]`** - View or manage phase log files
- **`voidrift prune [--global] [--all]`** - Clean ephemeral data (logs, stale locks, session DB)
- **`voidrift unlock`** - Remove develop lock and kill running process

### Worker Commands

- **`worker start <alias> [--refresh]`** - Start a local model container
- **`worker stop`** - Stop the active model container
- **`worker status`** - Show active model and gateway status
- **`worker check`** - Verify worker node prerequisites (SSH, Docker, GPU, uvx)
- **`worker logs [--follow]`** - Show active container logs
- **`worker info`** - Report worker node GPU, disk, and memory
- **`worker bench [<num>] [<rate>]`** - Benchmark active model
- **`worker models list`** - List cached models and disk usage
- **`worker models aliases`** - List configured aliases from worker-models.yml
- **`worker models add <alias> <repo>`** - Add a new model to config with defaults
- **`worker models pull <alias>`** - Download model weights
- **`worker models remove <id>`** - Remove a cached model revision
- **`worker models prune`** - Clean broken/detached revisions
- **`worker models fix-perms`** - Fix HuggingFace cache permissions
- **`worker images pull [<image>]`** - Pull vLLM docker image (default from config)
- **`worker images list`** - List docker images on worker node
- **`worker cache clear`** - Clear flashinfer/vllm kernel caches
- **`worker kiro start`** - Start Kiro Gateway
- **`worker kiro stop`** - Stop Kiro Gateway
- **`worker kiro status`** - Check gateway health

## Available Models

### Local Models
- `qwen3-8b` - [Qwen/Qwen3-8B-FP8](https://huggingface.co/Qwen/Qwen3-8B-FP8) (compact, fast)
- `qwen3-instruct` - [Qwen/Qwen3-30B-A3B-Instruct-2507-FP8](https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507-FP8) (general reasoning, gather and plan)
- `qwen3-coder` - [Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8) (code-focused, recommended)
- `qwen3-coder-next` - [RedHatAI/Qwen3-Coder-Next-FP8-dynamic](https://huggingface.co/RedHatAI/Qwen3-Coder-Next-FP8-dynamic) (80B MoE, next-gen code model)

### Tried Local Models
Models evaluated on this hardware but retired. See [Tried Local Models](#tried-local-models) in the benchmarks section for details.
- `qwen3-32b-dense` - [Qwen/Qwen3-32B-FP8](https://huggingface.co/Qwen/Qwen3-32B-FP8) — dense 32B, underperforms MoE on GB10
- `granite-4-small` - [ibm-granite/granite-4.0-h-small-FP8](https://huggingface.co/ibm-granite/granite-4.0-h-small-FP8) — Mamba-2 hybrid, slow on SM_121

### Cloud Models
- `claude` - anthropic/claude-opus-4-6 (high capability)
- `haiku` - anthropic/claude-haiku-4-5 (fast, cost-effective)
- `gemini` - gemini/gemini-2.5-pro (high capability)
- `gemini-flash` - gemini/gemini-2.5-flash (fast, cost-effective)

### Kiro Gateway Models (Free)
- `kiro-sonnet` - Claude Sonnet 4.5 (balanced performance)
- `kiro-haiku` - Claude Haiku 4.5 (fast)
- `kiro-deepseek` - DeepSeek R1 Distill Qwen 32B
- `kiro-minimax` - MiniMax M2.1 (230B MoE)
- `kiro-qwen` - Qwen3-Coder-Next (80B MoE)

See [Kiro Gateway Setup](#kiro-gateway-setup) for configuration.

## Project Structure

After running phases, your project will have:

```
your-project/
├── .voidrift/
│   ├── REQUIREMENTS.md           # Project requirements
│   ├── ARCHITECTURE.md           # Architecture reference
│   ├── STATE.md                  # Project state summary
│   ├── TASKS.md                  # Task list
│   ├── spec/                     # Feature specifications
│   └── *.log               # Phase logs
├── src/                          # Your source code
└── ...
```

## Workflow

### 1. Gather Phase
Reverse-engineer requirements from an existing codebase:
```bash
# From new project directory
cd ~/Projects/my-new-project
git init

# Auto-generate requirements from existing code
voidrift gather claude /path/to/existing/project

# Overwrite existing requirements (if needed)
voidrift gather claude /path/to/existing/project --force
```

The model will automatically:
- Triage the codebase structure (read-only, respects .gitignore)
- Analyze source files concurrently
- Synthesize REQUIREMENTS.md in your new project directory
- Error if file exists (use `--force` to overwrite)

For interactive requirements work, use `voidrift chat <model>` instead.

### 2. Plan Phase
Generate architecture and task breakdown:
```bash
voidrift plan claude
```

### 3. Develop Phase
Execute tasks with worker model, escalate to architect when blocked:
```bash
# Sequential (default for local models)
voidrift develop qwen3-coder claude

# Multi-module concurrent (automatic for cloud models)
voidrift develop claude
```

### 4. Automate Phase
Generate infrastructure-as-code:
```bash
voidrift automate qwen3-coder
```

### 5. Verify Phase
Run tests and quality checks:
```bash
voidrift verify qwen3-coder claude
```

## Tips

- **Use cheaper models for implementation:** `voidrift develop qwen3-coder claude` uses local model for bulk work, cloud model for hard problems
- **Check status frequently:** `voidrift status` shows progress
- **Review logs:** `voidrift log develop` shows the latest develop session output
- **Prune old logs:** `voidrift log --prune` cleans up all phase logs

## Troubleshooting

### "REQUIREMENTS.md not found"
Run `voidrift gather <model>` first to create project requirements.

### "No task files found"
Run `voidrift plan <model>` after gathering requirements.

### "Developer node unreachable"
Check worker connection: `worker check`

### "Invalid skill tags"
Edit `.voidrift/TASKS.md` and use tags from `resources/skills/`

### Tasks marked `[!]` (blocked)
Review the architect's response in the develop log, or re-run with architect model.

### Container won't start or keeps crashing
- Check worker node logs: `worker logs`
- Check GPU, disk, and memory: `worker info`
- Force recreation: `worker start <alias> --refresh`
- Clear kernel caches: `worker cache clear`

### Model configuration changes not taking effect
Use `worker start <alias> --refresh` to force container recreation after editing `worker-models.yml`

### Kiro Gateway "Refresh token is not set" or credential errors
Kiro Gateway credentials have expired. Fix:
1. Run `kiro-cli logout && kiro-cli login` to refresh the token database
2. Restart the gateway: `cd ~/opt/kiro-gateway && docker-compose restart`

If the error persists, the gateway may not be able to read the database file (permissions):
```bash
chmod 644 ~/.local/share/kiro-cli/data.sqlite3
cd ~/opt/kiro-gateway && docker-compose restart
```

## Kiro Gateway Setup

[Kiro Gateway](https://github.com/jwadow/kiro-gateway) provides free access to Claude models (Sonnet, Haiku) and other AI models through Amazon Q Developer / AWS CodeWhisperer credentials.

**The framework automatically manages the Kiro Gateway container** - it starts when you use kiro-* models and stops after the phase completes to free resources.

### Prerequisites

- [Kiro IDE](https://kiro.dev/) with logged in account, OR
- [Kiro CLI](https://kiro.dev/cli/) with AWS SSO (free Builder ID or corporate account)
- Docker installed and running

### Installation

1. **Clone the gateway:**
   ```bash
   git clone https://github.com/jwadow/kiro-gateway.git ~/opt/kiro-gateway
   cd ~/opt/kiro-gateway
   ```

2. **Create virtual environment and install dependencies:**
   ```bash
   uv venv
   uv pip install -r requirements.txt
   ```

3. **Configure credentials:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and choose one of these options:
   
   **Option A: Kiro IDE credentials (JSON file)**
   ```bash
   KIRO_CREDS_FILE="~/.aws/sso/cache/kiro-auth-token.json"
   PROXY_API_KEY="your-secure-password"
   ```
   
   **Option B: Kiro CLI database**
   ```bash
   KIRO_CLI_DB_FILE="~/.local/share/kiro-cli/data.sqlite3"
   PROXY_API_KEY="your-secure-password"
   ```
   
   **Note:** The Kiro CLI creates `data.sqlite3` with owner-only permissions (`600`). The framework automatically sets the file to `644` before starting the gateway container so it can read the database. This is safe on a single-user workstation.
   
   **Option C: Manual refresh token**
   ```bash
   REFRESH_TOKEN="your_kiro_refresh_token"
   PROXY_API_KEY="your-secure-password"
   ```

4. **Start the gateway:**
   ```bash
   cd ~/opt/kiro-gateway
   uv run main.py
   # Or custom port: uv run main.py --port 9000
   ```
   
   **Or run in background:**
   ```bash
   cd ~/opt/kiro-gateway
   nohup uv run main.py > kiro-gateway.log 2>&1 &
   ```
   
   **Note:** The framework can also manage the gateway via Docker (see Docker Deployment below). If using Docker, the framework will automatically start/stop the container when needed.

5. **Configure framework:**
   
   Set `kiro.port` and `kiro.api_key` in `~/.voidrift/config.yml`:
   ```yaml
   kiro:
     port: 8000        # Or your custom port
     api_key: ${KIRO_API_KEY}
   ```
   
   And set the env var in your shell profile:
   ```bash
   export KIRO_API_KEY="your-secure-password"  # matches PROXY_API_KEY from .env
   ```

### Automatic Container Management

When using Docker deployment, the framework automatically:
- Starts the kiro-gateway container when you use kiro-* models
- Waits for health check before proceeding
- Stops the container after the phase completes to free resources
- Reuses existing container if already running

No manual start/stop needed - just use kiro-* models and the framework handles the rest!

### Available Models

Once configured, you can use these models:
- `kiro-sonnet` - Claude Sonnet 4.5 (balanced performance)
- `kiro-haiku` - Claude Haiku 4.5 (fast)
- `kiro-deepseek` - DeepSeek R1 Distill Qwen 32B
- `kiro-minimax` - MiniMax M2.1 (230B MoE)
- `kiro-qwen` - Qwen3-Coder-Next (80B MoE)

### Usage

```bash
# Use in any phase
voidrift gather kiro-sonnet
voidrift plan kiro-sonnet
voidrift develop qwen3-coder kiro-sonnet

# Or as primary model
voidrift develop kiro-sonnet
```

### Docker Deployment (Alternative)

```bash
cd ~/opt/kiro-gateway

# Using docker-compose
docker-compose up -d

# Or docker run
docker run -d \
  -p 8000:8000 \
  -v ~/.aws/sso/cache:/home/kiro/.aws/sso/cache:ro \
  -e KIRO_CREDS_FILE=/home/kiro/.aws/sso/cache/kiro-auth-token.json \
  -e PROXY_API_KEY="your-secure-password" \
  --name kiro-gateway \
  ghcr.io/jwadow/kiro-gateway:latest
```

For detailed configuration options (VPN/proxy support, AWS SSO, etc.), see the [Kiro Gateway documentation](https://github.com/jwadow/kiro-gateway).

## How It Works

### Architecture Overview

The framework consists of four components:

1. **VoidRift CLI** (`cli/`) — Model-agnostic phase orchestrator. Resolves model aliases to endpoint URLs from `models.yml`, runs the agent loop, handles MCP tool calls. Does NOT manage containers, SSH, or gateway processes.
2. **MCP Context Server** (`mcp-context-server/`) — FastMCP server that stores, retrieves, and exports project artifacts and framework resources. The model pulls context on demand via tool calls instead of loading full files.
3. **Worker CLI** (`worker-cli/`) — Manages local model containers and Kiro Gateway. SSH to worker node, docker lifecycle, benchmarks, health checks. Provides the `worker` command.
4. **Framework Resources** (`resources/`) — Prompt files, skill conventions, and document templates.

### Three-Role System

AI models operate in one of three roles, explicitly assigned at runtime:

**Analyst Role:**
- Elicits requirements through interactive conversation
- Asks clarifying questions to understand user needs
- Focuses on "what" the system must do, not "how"
- Produces requirements documents and feature specifications
- Does NOT make technology choices or design architecture
- Receives: existing requirements (if revising), operator responses

**Architect Role:**
- Creates requirements, architecture, and task breakdowns
- Answers design questions when Developer escalates
- Provides guidance without writing implementation code
- Receives: problem description, REQUIREMENTS.md, ARCHITECTURE.md, task text
- Does NOT receive: source code files

**Developer Role:**
- Executes tasks from TASKS.md atomically
- Writes code, tests, documentation, and boilerplate
- Makes one fix attempt, then escalates when blocked
- Receives: task description, full ARCHITECTURE.md, skill conventions, architect guidance (if escalated)
- Does NOT: run shell commands during develop, make architectural decisions

**Role Assignment:**
The framework assigns roles through the three-layer prompt architecture (REQ-RES-7). Each phase loads a skill file (how to think) and a stage-specific prompt (what to do) with context injected via format variables. Prompts live in `resources/prompts/`, skills in `resources/skills/`.

**Example:** `voidrift develop qwen3-coder claude`
- `qwen3-coder` = Developer (implements tasks)
- `claude` = Architect (answers escalations)

**Example:** `voidrift gather claude`
- `claude` = Analyst (elicits requirements)

### Framework Resources

**`resources/prompts/` — Phase Prompts**
- `gather.md` — Triage, analysis, and synthesis stage prompts
- `chat.md` — Interactive session system prompt and doc-scoped variants
- `plan.md` — Architecture planning and plan-update prompts
- `develop.md` — Task execution and escalation prompts
- Each prompt file contains sections loaded via `get_prompt(phase, section)`

**`resources/skills/` — Domain Conventions**
- 15 skill files covering specialized domains
- Technology-specific standards and canonical patterns
- Loaded as skill layer in gather/chat/plan; loaded on demand per task tag during develop
- Available skills: `AI-ETHICS`, `ARCH-DESIGN`, `CLOUD-OPS`, `DATA-ENG`, `EMBEDDED-ENG`, `GAME-ENG`, `ML-ENG`, `MOBILE-ENG`, `PROD-STRATEGY`, `QUALITY-QA`, `RELIABILITY-ENG`, `SECURITY-TRUST`, `SYSTEMS-ENG`, `WEB-ENG`, `WORKFLOW`

**`resources/templates/` — Document Scaffolding**
- `ARCHITECTURE-TEMPLATE.md` — Arc42 + C4 architecture document template
- `DESIGN-TEMPLATE.md` — Feature design template
- `EDIT-FORMAT.md` — File editing format instructions
- `REQUIREMENTS-TEMPLATE.md` — IEEE 29148 + EARS + BDD requirements template

**`resources/agents/` — Legacy Role Guidance (deprecated)**
- `ANALYST.md`, `ARCHITECT.md`, `DEVELOPER.md` — Superseded by prompt/skill pattern

### MCP Context Server

The MCP server provides 16 tools that the model calls on demand:

| Tool | Description |
|------|-------------|
| `store_file_analysis` | Store analysis results for a source file |
| `get_file_analysis` | Retrieve stored analysis for a file |
| `get_all_analyses` | Retrieve all stored analyses |
| `store_requirements` | Store requirements content in memory |
| `get_requirements` | Retrieve stored or on-disk requirements |
| `load_tasks` | Load TASKS.md, parse module headers into per-module queues |
| `get_next_task` | Return the next unchecked task for a module |
| `complete_task` | Mark next task done, write through to disk |
| `get_task_status` | Return done/blocked/remaining counts |
| `get_agent` | Retrieve role-specific agent file (legacy) |
| `get_skill` | Retrieve skill file content by name and optional topic |
| `get_prompt` | Retrieve phase prompt section by phase and section name |
| `get_template` | Retrieve template file by name |
| `read_source_file` | Read a source file from the project directory |
| `write_file` | Write content to a file in the project directory |
| `export_to_file` | Export a stored artifact to disk |
| `list_project_artifacts` | List all files in .voidrift/ |

### Local Developer Models

**How Local Models Work:**

1. **Container Management:**
   - Models run in Docker containers on remote worker node
   - Framework SSHs to the worker node and starts containers via docker
   - Only one model container runs at a time (single-worker constraint)
   - Containers are reused if configuration matches; `worker start <alias> --refresh` forces recreation

2. **Model Configuration** (`worker-models.yml`):
   ```yaml
   qwen3-coder:
     repository: Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8
     served_model_name: qwen3-coder
     docker_image: scitrera/dgx-spark-vllm:0.17.0-t5
     gpu_memory_utilization: 0.85
     max_model_len: 65536
     vllm_args:
       - --enable-prefix-caching
       - --tool-call-parser qwen3_coder
       - --enable-auto-tool-choice
     cache_mounts:
       - ~/.cache/huggingface:/root/.cache/huggingface
       - ~/.cache/vllm:/root/.cache/vllm
   ```

3. **Startup Process:**
   - Framework stops other worker containers
   - Starts new container with model configuration
   - Polls `http://<worker-ip>:8000/v1/models` every second
   - Monitors container health during startup
   - Exits immediately if container crashes

4. **Performance Metrics** (qwen3-coder on ASUS Ascent GX10):
   - Model loading: ~3 minutes
   - CUDA graph compilation: ~1 minute
   - Total startup: ~4.5 minutes
   - Memory: 29.1 GiB model + 69.44 GiB KV cache available
   - Context window: 65,536 tokens

5. **Cache Persistence:**
   - Model weights cached in `~/.cache/huggingface`
   - vLLM compilation cache in `~/.cache/vllm`
   - FlashInfer kernels in `~/.cache/flashinfer`
   - Prevents re-downloading and recompiling on each start

**Local Model Limitations:**

- **No shell commands:** Developer cannot run bash commands during develop phase
- **Single worker:** Only one model container at a time
- **Network dependency:** Requires SSH access to worker node
- **Startup time:** 4-5 minutes for 30B models
- **Memory constraints:** Limited by worker node hardware (128GB for GB10)

**Local Model Benefits:**

- **Cost:** No API fees for bulk implementation work
- **Privacy:** Code never leaves your infrastructure
- **Speed:** Low latency for local network
- **Control:** Full control over model versions and configuration

### Cloud Models

**How Cloud Models Work:**

1. **No Infrastructure Required:**
   - Models accessed via API endpoints
   - No container management or SSH needed
   - Authentication via environment variables

2. **API Configuration:**
   ```bash
   export ANTHROPIC_API_KEY="your-key"
   export GEMINI_API_KEY="your-key"
   ```

3. **Model Selection:**
   - `claude` - High capability, best for architecture and complex problems
   - `haiku` - Fast and cost-effective, good for simple tasks
   - `gemini` - High capability alternative
   - `gemini-flash` - Fast alternative
   - `kiro-*` - Gateway models (requires `kiro.port` in config.yml)

4. **Performance:**
   - No startup time (instant availability)
   - Latency depends on internet connection
   - Rate limits apply per provider

**Cloud Model Limitations:**

- **Cost:** API fees per token (input + output)
- **Privacy:** Code sent to third-party APIs
- **Rate limits:** Provider-specific throttling
- **Network dependency:** Requires internet connection

**Cloud Model Benefits:**

- **No infrastructure:** No worker node required
- **Instant availability:** No startup time
- **High capability:** Access to latest models
- **Scalability:** No hardware constraints

### Hybrid Approach (Recommended)

**Best practice:** Use local worker for bulk implementation, cloud architect for design:

```bash
voidrift develop qwen3-coder claude
```

- `qwen3-coder` (local) handles 90% of work: implementation, tests, docs
- `claude` (cloud) handles 10% of work: escalations, design questions

**Cost optimization:**
- Local model: Free (after hardware investment)
- Cloud model: Only pays for escalations (~5-10 per project)

### Developer Do's and Don'ts

**DO:**
- ✅ Execute tasks atomically, one at a time
- ✅ Mark tasks `[x]` after completion
- ✅ Run tests after each task
- ✅ Commit with task-specific messages
- ✅ Make one fix attempt when errors occur
- ✅ Escalate immediately if error persists
- ✅ Reference STATE.md for context continuity
- ✅ Follow skill conventions without deviation
- ✅ Write minimal responses (no narration)

**DON'T:**
- ❌ Run shell commands during develop phase
- ❌ Retry failed fixes multiple times
- ❌ Make architectural decisions
- ❌ Deviate from task list or skill conventions
- ❌ Skip escalation when blocked
- ❌ Manually edit STATE.md during task execution
- ❌ Load unnecessary skills (context window waste)
- ❌ Write code before documentation is updated
- ❌ Execute package managers during code generation
- ❌ Start/stop/test running applications

### Escalation Flow

1. **Developer encounters problem:**
   - Error persists after one fix attempt
   - Uncertain about implementation approach
   - Needs architectural guidance

2. **Developer escalates:**
   - Marks task `[!]` in TASKS.md
   - Creates `.voidrift/escalations/<task_num>.md` with question

3. **Framework consults Architect:**
   - Starts architect model if local
   - Provides: problem, REQUIREMENTS.md, ARCHITECTURE.md, task text
   - Does NOT provide: source code files

4. **Architect responds:**
   - Writes guidance to `.voidrift/architect_responses/<task_num>.md`
   - Provides design direction, not implementation

5. **Developer continues:**
   - Loads architect's guidance
   - Attempts fix with new direction
   - Escalates again if still blocked (max 5 escalations per session)

### State Management

**STATE.md - Session Memory:**
- Provides context continuity across sessions
- Single-module: `.voidrift/STATE.md`
- Multi-module: `.voidrift/STATE.md` + `.voidrift/STATE-<module>.md`

**TASKS.md - Task Tracking:**
- Single file with `## Module:` headers for multi-module projects
- MCP server parses into per-module queues
- Tasks marked `[x]` (done), `[!]` (blocked), or `[ ]` (pending)
- Write-through: all state changes persist to disk immediately

### Skill System

**How skills work:**
- **Plan time:** All skills loaded so planner knows available conventions
- **Develop time:** Only tagged skills loaded per task (minimizes context)
- Skills are **read-only** and **authoritative** (must follow without deviation)

**Available skills:**
- `ai-ethics` - AI safety, ethics, bias mitigation
- `arch-design` - Architecture patterns, API standards, DDD
- `cloud-ops` - Cloud infrastructure, IaC, CI/CD
- `data-eng` - Data modeling, persistence, schema evolution
- `embedded-eng` - Embedded systems, RTOS, hardware interfaces
- `game-eng` - Game loops, physics, asset pipelines
- `ml-eng` - ML pipelines, training, inference optimization
- `mobile-eng` - Mobile platforms, offline-first, lifecycle management
- `prod-strategy` - Product strategy, refactoring, tech writing
- `quality-qa` - TDD, test pyramid, systematic debugging
- `reliability-eng` - SRE, SLOs, observability, error budgets
- `security-trust` - Security hardening, authentication, compliance
- `systems-eng` - POSIX, packaging, signal handling, SemVer
- `web-eng` - Web performance, SEO, accessibility, atomic design
- `workflow` - Git workflow, conventional commits, task isolation

**Skill tagging:**
- Tasks in TASKS.md include `[skill1, skill2]` tags
- Tag only skills genuinely required (context window optimization)
- Framework deduplicates and loads matching skill files

---

## Documentation

- **Requirements:** `REQUIREMENTS.md` — IEEE 29148 / EARS format requirements for all framework components
- **Phase Prompts:** `resources/prompts/*.md` — Externalized prompts for gather, chat, plan, and develop phases
- **Skill Files:** `resources/skills/*.md` — 15 domain-specific technology stacks and conventions
- **Templates:** `resources/templates/*.md` — Document scaffolding for requirements (IEEE 29148 + EARS + BDD), architecture (arc42 + C4), and design

Each phase loads its prompts via `get_prompt()` and skills via `get_skill()` following the three-layer prompt architecture (REQ-RES-7).

## Tried Local Models

Models evaluated on this hardware and retired. Preserved for reference.

**qwen3-32b (32B dense) — retired:**
```
Model:                   Qwen3-32B-FP8
GPU utilization:         0.90
Output throughput:       102 tok/s (-33% vs qwen3-coder)
Mean TTFT:               562 ms (+106% vs qwen3-coder)
Median TTFT:             508 ms (+104% vs qwen3-coder)
P99 TTFT:                2194 ms (+147% vs qwen3-coder)
Mean TPOT:               183 ms (+123% vs qwen3-coder)
Median TPOT:             183 ms (+118% vs qwen3-coder)
Mean ITL:                182 ms (+128% vs qwen3-coder)
```
Decision: Dense 32B significantly underperforms the MoE 30B-A3B at the same parameter count on GB10. Blackwell's architecture favors MoE routing — activating only 3B parameters per token versus loading all 32B each forward pass makes a measurable difference. No use case justifies the penalty when qwen3-coder is faster and code-specialized, and qwen3-instruct is the same MoE architecture for general reasoning.

**granite-4-small (Mamba-2 hybrid) — retired:**
```
Model:                   ibm-granite/granite-4.0-h-small-FP8
Architecture:            MoE + Mamba-2 hybrid (32B total / ~9B active)
```
Decision: Unacceptable latency in practice on this system. Granite 4.0-H-Small uses a Mamba-2 SSM hybrid architecture that is not yet well-optimized for SM_121 (GB10) in the current scitrera vLLM image. Despite strong quality benchmarks (Arena Hard 46.48, IF-Eval 87.55 — best open-weight under 400B), the real-world throughput on this hardware made it unsuitable for interactive use. Worth revisiting when Mamba kernel support for SM_121 matures.

---

## Development

### Building & Testing

```bash
make install    # Install both packages (editable)
make test       # Run all 204 tests
make build      # Build distribution packages
```

### Project Layout

```
voidrift/
├── cli/                          # VoidRift CLI package
│   ├── src/voidrift_cli/
│   │   ├── main.py              # Click commands and entry point
│   │   ├── agent.py             # Agent loop (API calls, tool handling, streaming)
│   │   ├── models.py            # Model config, container lifecycle, Kiro gateway
│   │   ├── utils.py             # Shared utilities
│   │   └── phases/              # Phase implementations
│   │       ├── gather.py        # Requirements elicitation
│   │       ├── plan.py          # Architecture and task breakdown
│   │       ├── develop.py       # Task execution loop
│   │       ├── automate.py      # IaC generation
│   │       └── verify.py        # Quality checks and reporting
│   └── tests/                   # CLI tests (pytest)
├── mcp-context-server/           # MCP Context Server package
│   ├── src/voidrift_mcp/
│   │   ├── server.py            # FastMCP server with 16 tools
│   │   ├── markdown_parser.py   # Markdown indexing by header
│   │   ├── artifact_store.py    # Write-through key-value store
│   │   ├── task_store.py        # TASKS.md parser with per-module queues
│   │   └── session_store.py     # SQLite session metadata
│   └── tests/                   # MCP server tests (pytest)
├── resources/                    # Framework reference files
│   ├── agents/                  # Legacy role guidance (deprecated, 3 files)
│   ├── prompts/                 # Phase prompts (4 files)
│   ├── skills/                  # Domain conventions (15 files)
│   └── templates/               # Document scaffolding (5 files)
├── REQUIREMENTS.md              # IEEE 29148 / EARS format requirements
├── CHANGELOG.md                 # Keep a Changelog format
├── VERSION                      # Shared version (0.1.0)
└── Makefile                     # Build, test, install targets
```

---

## License

[Your License Here]
