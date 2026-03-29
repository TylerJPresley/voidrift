# Project Name: Project VoidRift - Local-first Agentic Development Framework

## Critical Rules
- 🚨 You are helping develop Project VoidRift. You must ALWAYS follow the instructions in START.md at the repo root when processing operator requests.


## Reading Large Files

When reading large files, run `wc -l` first to check the line count. If the file is over 2,000 lines, use the `offset` and `limit` parameters on the Read tool to read in chunks rather than attempting to read the entire file at once. 