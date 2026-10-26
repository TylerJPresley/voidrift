---
summary: Reference for the CLI's built-in slash commands
read-when: when the user asks what a slash command does or which commands exist
type: reference
---
# Slash commands

Use a slash command to open panels, navigate sessions, switch models, or control the session.

| Command | What it does |
|---------|-------------|
| /help | Show the command list |
| /sessions | Open the sessions view |
| /resume | Resume a session by id, or open the sessions view |
| /new | Start a fresh session |
| /clear | Start a fresh session, clearing the view |
| /model | Switch the model, or open the models panel |
| /agent | Switch the active top-level agent, or open the agents panel |
| /mcp | Open the MCP panel, or connect/disconnect a server |
| /tools | Open the tools panel |
| /plugins | Open the plugins panel |
| /permissions | Open the permissions panel |
| /access | Print the effective permissions for the current mode |
| /compliance | Open the compliance panel |
| /memory | Open the memory panel |
| /skills | Open the skills panel |
| /prompts | Open the prompts panel |
| /stats | Open the stats panel |
| /export | Export the current (or a named) session as a sanitized Markdown or JSON document; secrets, paths and unsafe characters are masked |
| /context | Open the context panel |
| /diff | Render the working-tree diff |
| /config | Show the effective config and layers, or open the project config in the editor |
| /undo | Step back one move — conversation and files |
| /redo | Step forward one move — conversation and files |
| /goto | Jump to move <id> (0 = session start), or list the move timeline |
| /compact | Compact the context now |
| /plan | View/author the plan: create, add-step, activate, advance, verify, show, abandon; bare /plan opens the panel |
| /routine | Run a saved routine, or save <id> <prompt> / run <id> |
| /editor | Compose input in the external editor |
| /cancel | Cancel the active turn |
| /quit | Shut down and leave |
| /exit | Shut down and leave |