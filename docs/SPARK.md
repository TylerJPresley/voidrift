# Serving Blackwell-Native LLMs at Scale: How I Deployed Qwen 3.6 35B MoE on my ASUS Ascent GX10

The arrival of NVIDIA’s Blackwell architecture marks a massive leap forward in local LLM inference performance. With native hardware support for FP4 tensor cores, Blackwell GPUs can generate tokens at speeds previously thought impossible for local setups. 

But getting top-tier performance on the Blackwell architecture—specifically on my unified-memory **ASUS Ascent GX10** equipped with the **GB10 Grace Blackwell Superchip**—required a tailored software stack. 

Here is what I did to get the **nvidia/Qwen3.6-35B-A3B-NVFP4** model serving reliably at maximum efficiency.

---

## 1. The Hardware & Memory Challenge I Faced

My ASUS Ascent GX10 features the GB10 Grace Blackwell Superchip. Unlike traditional GPU nodes with separate system RAM and VRAM, the GB10 runs on **128GB of unified LPDDR5x memory** shared between the ARM CPU cores and the Blackwell GPU. 

This unified pool means that:
* Model weights, Key-Value (KV) cache, operating system overhead, and compiler buffers (like `torch.compile`) all compete for the same physical memory space.
* To prevent triggering the host OS Out-Of-Memory (OOM) killer, I had to strictly limit vLLM's memory target. I set `--gpu-memory-utilization` to **`0.80`** to establish a stable boundary while leaving plenty of headroom for unified OS operations and concurrent workloads.

---

## 2. Solving the Build Dependency: My Custom vLLM Image

Standard pre-built vLLM Docker images lack the bleeding-edge patches required for Grace Blackwell’s FP4 (NVFP4) weight and activation precision. To unlock the hardware's full capability, I built vLLM from source using PyTorch 2.5+ and Transformers 5+ optimizations.

I used the specialized builder from the [eugr/spark-vllm-docker](https://github.com/eugr/spark-vllm-docker) repository. This repository compiles the optimized Marlin and FlashInfer kernels directly against the Blackwell instruction set.

Here is how I built the image on my GPU node:

```bash
# Clone the builder repository
git clone https://github.com/eugr/spark-vllm-docker.git ~/opt/eugr
cd ~/opt/eugr

# Build the Blackwell-optimized vLLM image
./build-and-copy.sh --tf5
```
This generated my local Docker image: **`vllm-node-tf5`**.

---

## 3. Dissecting My vLLM Engine Configuration

Serving the [nvidia/Qwen3.6-35B-A3B-NVFP4](https://huggingface.co/nvidia/Qwen3.6-35B-A3B-NVFP4) model efficiently required a specific cocktail of engine flags. Here is the breakdown of the optimal runtime parameters I chose:

* **FP8 KV Caching (`--kv-cache-dtype fp8`)**: By compressing key-value cache activation states to 8-bit float, I reduced the VRAM required per token. This allowed me to serve context windows up to **262K tokens** on a single card without running out of memory.
* **Prefix Caching (`--enable-prefix-caching`)**: In my multi-turn conversations or agentic loops, the system prompt and preceding chat history are cached. Subsequent generations bypass the prefill phase entirely, delivering a near-zero Time To First Token (TTFT).
* **FlashInfer Attention Backend (`--attention-backend flashinfer`)**: FlashInfer provides accelerated page attention kernels, outperforming default attention mechanisms on long contexts.
* **Marlin Kernels (`VLLM_MARLIN_USE_ATOMIC_ADD=1`)**: I injected this environment variable to enable atomic additions in Marlin kernels, preventing numerical instability and speeding up low-bit quantized operations.
* **Chunked Prefill & Async Scheduling (`--enable-chunked-prefill --async-scheduling`)**: Chunked prefill prevents large prompt-processing requests from blocking ongoing token generation (decoding steps), ensuring consistent and low-latency token generation rates.

---

## 4. Deploying the Container

To start the model container, I ran the following Docker command. 

* I passed `--privileged`, `--gpus all`, and `--network host` flags to ensure direct, zero-overhead access to the host's Blackwell GPU and networking stack.
* I used bind-mounts to map standard cache directories (`huggingface`, `vllm`, and `flashinfer`) to ensure downloaded model weights survived container restarts.

```bash
docker run -d \
  --name vllm-qwen-35b \
  --privileged \
  --gpus all \
  --network host \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -v ~/.cache/vllm:/root/.cache/vllm \
  -v ~/.cache/flashinfer:/root/.cache/flashinfer \
  -e VLLM_MARLIN_USE_ATOMIC_ADD=1 \
  -e HF_TOKEN=$HF_TOKEN \
  vllm-node-tf5 \
  vllm serve nvidia/Qwen3.6-35B-A3B-NVFP4 \
    --host 0.0.0.0 \
    --port 8000 \
    --max-model-len 262144 \
    --max-num-batched-tokens 8192 \
    --gpu-memory-utilization 0.80 \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder \
    --reasoning-parser qwen3 \
    --trust-remote-code \
    --dtype auto \
    --kv-cache-dtype fp8 \
    --load-format fastsafetensors \
    --attention-backend flashinfer \
    --enable-prefix-caching \
    --async-scheduling \
    --enable-chunked-prefill \
    --chat-template /workspace/vllm/fixed_chat_template.jinja \
    -tp 1
```

> 💡 **Custom Chat Templates:** 
> The `--chat-template` flag uses the template baked directly into your custom `vllm-node-tf5` image by the `mods/fix-qwen3.6-chat-template` build script.

---

## 5. Querying the Endpoint

Once the container was up and running, it exposed an OpenAI-compatible API on port `8000`. Here is the `curl` command I used to query it:

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VLLM_API_KEY:-no-key}" \
  -d '{
    "model": "nvidia/Qwen3.6-35B-A3B-NVFP4",
    "messages": [
      {"role": "system", "content": "You are a helpful coding assistant."},
      {"role": "user", "content": "Write a highly optimized quicksort in Python."}
    ],
    "temperature": 0.2
  }'
```
