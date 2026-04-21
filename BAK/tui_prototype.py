#!/usr/bin/env python3
"""VoidRift TUI prototype — FormattedTextControl with manual scroll via fragment slicing."""
from __future__ import annotations

import os, random, subprocess, time, threading
from io import StringIO
from pathlib import Path

from prompt_toolkit import Application
from prompt_toolkit.cursor_shapes import CursorShape
from prompt_toolkit.formatted_text import ANSI, FormattedText, to_formatted_text
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import Dimension, FormattedTextControl, HSplit, Layout, Window
from prompt_toolkit.mouse_events import MouseEvent, MouseEventType
from prompt_toolkit.styles import Style
from prompt_toolkit.widgets import TextArea
from rich.console import Console
from rich.markdown import Markdown


class _ScrollableControl(FormattedTextControl):
    """FormattedTextControl that intercepts mouse scroll before the Window can.

    The Window's built-in _scroll_up()/_scroll_down() modify Window.vertical_scroll,
    which conflicts with manual content slicing in the text callable. Returning None
    (handled) instead of NotImplemented prevents the Window from touching its own
    vertical_scroll, leaving full control to the on_scroll_up/down callbacks.
    """

    def __init__(self, *args, on_scroll_up=None, on_scroll_down=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._on_scroll_up = on_scroll_up
        self._on_scroll_down = on_scroll_down

    def mouse_handler(self, mouse_event: MouseEvent):
        if mouse_event.event_type == MouseEventType.SCROLL_UP:
            if self._on_scroll_up:
                self._on_scroll_up()
            return None  # handled — Window does NOT call _scroll_up()
        if mouse_event.event_type == MouseEventType.SCROLL_DOWN:
            if self._on_scroll_down:
                self._on_scroll_down()
            return None  # handled — Window does NOT call _scroll_down()
        return super().mouse_handler(mouse_event)


def _rich_render(text, width=100):
    buf = StringIO()
    Console(file=buf, force_terminal=True, color_system="truecolor", width=width, highlight=False).print(Markdown(text), soft_wrap=False)
    return ANSI(buf.getvalue().rstrip("\n"))

def _has_md(t):
    return any(m in t for m in ("```","**","## ","# ","| ","- ","* ","1. ","> ","["))

def _git_branch():
    try: return subprocess.run(["git","branch","--show-current"],capture_output=True,text=True,timeout=3).stdout.strip()
    except: return ""

def _short_cwd():
    try: return "~/" + str(Path.cwd().relative_to(Path.home()))
    except: return str(Path.cwd())

HEADER_TEXT = (
    "  ██╗   ██╗ ██████╗ ██╗██████╗ ██████╗ ██╗███████╗████████╗\n"
    "  ██║   ██║██╔═══██╗██║██╔══██╗██╔══██╗██║██╔════╝╚══██╔══╝\n"
    "  ██║   ██║██║   ██║██║██║  ██║██████╔╝██║█████╗     ██║   \n"
    "  ╚██╗ ██╔╝██║   ██║██║██║  ██║██╔══██╗██║██╔══╝     ██║   \n"
    "   ╚████╔╝ ╚██████╔╝██║██████╔╝██║  ██║██║██║        ██║   \n"
    "    ╚═══╝   ╚═════╝ ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   \n")
SPINNER = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]
_si = 0

class Message:
    __slots__ = ("role","text","tool_name","stats","streaming","_rc","_rl")
    def __init__(s,role,text,tool_name="",stats="",streaming=False):
        s.role=role;s.text=text;s.tool_name=tool_name;s.stats=stats;s.streaming=streaming;s._rc=None;s._rl=0

class State:
    def __init__(s):
        s.messages=[];s.model_name="auto";s.context_pct=10;s.mode="/chat"
        s.cwd=_short_cwd();s.branch=_git_branch()
        s.thinking=False;s.thinking_label="thinking...";s.busy=False;s._inv=None
    def add_op(s,t): s.messages.append(Message("op",t));s._n()
    def add_model(s,t,stats="",streaming=False): s.messages.append(Message("model",t,stats=stats,streaming=streaming));s._n()
    def add_tool(s,name,detail=""): s.messages.append(Message("tool",detail,tool_name=name));s._n()
    def add_sys(s,t): s.messages.append(Message("sys",t));s._n()
    def upd_model(s,t,stats="",streaming=True):
        if s.messages and s.messages[-1].role=="model":
            m=s.messages[-1];m.text=t;m.stats=stats;m.streaming=streaming
            if not streaming: m._rc=None;m._rl=0
            s._n()
    def _n(s):
        if s._inv: s._inv()


def _render_lines(state, width):
    """Render conversation as a list of (style, text) lines."""
    global _si
    lines = []  # each entry is a list of (style, text) tuples for one line
    usable = max(width - 4, 40)

    # Header
    lines.append([("", "")])
    for l in HEADER_TEXT.splitlines():
        lines.append([("class:header-art", l)])
    lines.append([("class:header-tagline", "  Agentic Software Engineering Framework")])
    lines.append([("", "")])

    # Welcome callout — always shown; full when fresh, compact when history exists
    box_w = min(66, usable - 2)
    inner_w = box_w - 4
    indent = "  "

    def _bline(frags=None):
        frags = frags or []
        used = sum(len(t) for _, t in frags)
        pad = " " * max(0, inner_w - used)
        row = [("class:callout-border", indent + "│ ")]
        row.extend(frags)
        row.append(("class:callout-bg", pad))
        row.append(("class:callout-border", " │"))
        return row

    top = indent + "╭" + "─" * (box_w - 2) + "╮"
    bot = indent + "╰" + "─" * (box_w - 2) + "╯"

    lines.append([("class:callout-border", top)])
    lines.append(_bline())
    lines.append(_bline([("class:callout-label", "  Model  "), ("class:callout-model", state.model_name)]))
    lines.append(_bline())
    lines.append(_bline([("class:callout-text", "  I can help you with requirements, planning,")]))
    lines.append(_bline([("class:callout-text", "  implementation, and verification.")]))
    lines.append(_bline([("class:callout-text", "  I have access to your project files, shell, web, and memory.")]))
    lines.append(_bline())
    lines.append(_bline([("class:callout-cmd", "  /help"), ("class:callout-hint", "     list commands")]))
    lines.append(_bline([("class:callout-cmd", "  /clear"), ("class:callout-hint", "    reset conversation")]))
    lines.append(_bline([("class:callout-cmd", "  /quick"), ("class:callout-hint", "   <question>  fast one-shot answer")]))
    if state.messages:
        lines.append(_bline())
        lines.append(_bline([("class:callout-hint", "  Resuming previous conversation. /clear to start fresh.")]))
    lines.append(_bline())
    lines.append([("class:callout-border", bot)])
    lines.append([("", "")])
    if not state.messages:
        lines.append([("class:header-tagline", "  PgUp/PgDn or scroll  ·  Ctrl+C to cancel  ·  /quit to exit")])
        lines.append([("", "")])

    for msg in state.messages:
        if msg.role == "op":
            lines.append([("", "")])
            lines.append([("class:rule", "─" * usable)])
            for l in msg.text.splitlines():
                lines.append([("class:operator-bar", "┃ "), ("class:operator", l)])
            lines.append([("", "")])
        elif msg.role == "tool":
            d = f"  {msg.text}" if msg.text else ""
            lines.append([("class:tool-dot", "● "), ("class:tool-name", msg.tool_name), ("class:tool-detail", d)])
        elif msg.role == "diff":
            lines.append([("class:diff-summary", f"  {msg.tool_name}")])
            for dl in msg.stats.splitlines():
                if dl.startswith("+"):
                    lines.append([("class:diff-add", f"  {dl}")])
                elif dl.startswith("-"):
                    lines.append([("class:diff-del", f"  {dl}")])
                else:
                    lines.append([("class:diff-ctx", f"  {dl}")])
        elif msg.role == "sys":
            lines.append([("class:system-msg", f"  {msg.text}")])
        elif msg.role == "model":
            text = msg.text
            if text.strip() and _has_md(text) and not msg.streaming:
                ansi = _rich_render(text, width=usable-2)
                rendered = to_formatted_text(ansi)
                cur_line = []
                for st, chunk in rendered:
                    parts = chunk.split("\n")
                    for i, part in enumerate(parts):
                        if i > 0:
                            lines.append([("class:model-bar", "┃ ")] + cur_line)
                            cur_line = []
                        if part:
                            cur_line.append((st, part))
                if cur_line:
                    lines.append([("class:model-bar", "┃ ")] + cur_line)
            else:
                for l in text.splitlines():
                    lines.append([("class:model-bar", "┃ "), ("class:model-text", l)])
                if msg.streaming:
                    lines.append([("class:model-bar", "┃ "), ("class:streaming-cursor", "█")])
            if msg.stats:
                lines.append([("", "")])
                lines.append([("class:stats", f"  · {msg.stats}")])
            lines.append([("", "")])

    if state.thinking:
        _si = (_si + 1) % len(SPINNER)
        lines.append([("class:thinking", f"  {SPINNER[_si]} {state.thinking_label}")])

    return lines


def _slice_to_ft(all_lines, start, count):
    """Slice lines and convert to FormattedText."""
    end = min(len(all_lines), start + count)
    frags = []
    for line_frags in all_lines[start:end]:
        frags.extend(line_frags)
        frags.append(("", "\n"))
    return FormattedText(frags)


def _render_footer(state, width):
    pct = state.context_pct
    cc = "class:ctx-ok" if pct<=60 else "class:ctx-warn" if pct<=80 else "class:ctx-crit"
    left = [("class:ft-name","voidrift"),("class:ft-dim"," · "),("class:ft-name",state.model_name),
            ("class:ft-dim"," · "),(cc,f"◎ {pct}%"),("class:ft-dim"," · "),("class:ft-mode",state.mode)]
    right = [("class:ft-path",state.cwd)]
    if state.branch: right += [("class:ft-dim"," · "),("class:ft-branch",f"({state.branch})")]
    right.append(("","  "))
    ll=sum(len(t) for _,t in left);rl=sum(len(t) for _,t in right)
    return FormattedText(left+[("","  " * max(1,(width-ll-rl)//2))]+right)


RESPONSES = [
    "Here's what I found:\n\nThe `voidrift chat` command uses **prompt_toolkit**.\n\n"
    "Key components:\n- `_tui_loop()` — main TUI loop\n- `TUIState` — observable state\n- `_chat_tui.py` — rendering\n\n"
    "```python\ndef run_chat(model):\n    agent = AgentLoop(model=model)\n    agent.send(msg)\n```\n\nWant me to dig deeper?",
    "That's a good approach. The TUI layout gives us:\n\n1. **Persistent footer** — always visible\n2. **Scrollable history** — conversation stays put\n3. **Left-margin bars** — clear role separation\n\nNo new dependencies needed.",
    "Let me check the codebase.\n\n- **6 commands**: gather, plan, develop, verify, deploy, chat\n- **Agent loop** with streaming, retry, stall detection\n- **Tool system** with filesystem, bash, HTTP, browser\n- **Session persistence** via JSONL\n\n> The architecture is well-specified.\n\nWhat would you like to focus on?",
]


def build_app():
    state = State()

    def _w():
        try: return os.get_terminal_size().columns
        except: return 120
    def _h():
        try: return os.get_terminal_size().lines - 4  # footer+sep+spacer+input
        except: return 40

    # Scroll state
    _all_lines = [_render_lines(state, _w())]
    _scroll_bottom = [True]  # True = pinned to bottom
    _scroll_top = [0]  # first visible line (used when not pinned)

    def _get_conv():
        lines = _render_lines(state, _w())
        _all_lines[0] = lines
        vh = _h()
        total = len(lines)
        if _scroll_bottom[0] or total <= vh:
            start = max(0, total - vh)
        else:
            start = max(0, min(_scroll_top[0], total - vh))
        frags = []
        for line_frags in lines[start:start + vh]:
            frags.extend(line_frags)
            frags.append(("", "\n"))
        return FormattedText(frags)

    scrollable = Window(
        content=_ScrollableControl(
            _get_conv, focusable=False, show_cursor=False,
            on_scroll_up=lambda: _scroll_up_n(3),
            on_scroll_down=lambda: _scroll_down_n(3),
        ),
        wrap_lines=True, height=Dimension(weight=1),
    )

    state._inv = lambda: app.invalidate()

    sep = Window(content=FormattedTextControl(lambda: FormattedText([("class:rule","─"*_w())])), height=1)
    footer = Window(content=FormattedTextControl(lambda: _render_footer(state,_w())), height=1, style="class:footer-bg")

    def _prompt():
        if input_area.text: return FormattedText([])
        if state.busy: return FormattedText([("class:input-placeholder","voidrift is working · type to queue a message ")])
        return FormattedText([("class:input-placeholder","ask a question or describe a task ↵ ")])

    input_area = TextArea(height=1, multiline=False, style="class:input-text", prompt=_prompt)
    root = HSplit([scrollable, sep, footer, Window(height=1), input_area])
    layout = Layout(root, focused_element=input_area)

    kb = KeyBindings()

    @kb.add("enter")
    def _submit(event):
        if state.busy: return
        t = input_area.text.strip()
        if not t: return
        input_area.text=""; input_area.buffer.reset()
        _scroll_bottom[0] = True
        if t=="/quit": event.app.exit(); return
        if t=="/clear": state.messages.clear(); state.context_pct=0; state._n(); return
        state.add_op(t)
        def _bg():
            state.thinking=True; state.thinking_label=random.choice(["Thinking... (esc to cancel)","Pondering... (esc to cancel)","Ruminating... (esc to cancel)"])
            state.busy=True; state._n()
            time.sleep(random.uniform(0.3,1.0)); state.thinking=False

            # Simulate: stream some text → tool calls → stream final response
            scenario = random.choice(["simple", "tools", "multi_tool", "write"])

            if scenario == "simple":
                resp = random.choice(RESPONSES)
                state.add_model("", streaming=True)
                acc = ""
                for w in resp.split(" "):
                    acc += w + " "; state.upd_model(acc.rstrip(), streaming=True); time.sleep(random.uniform(0.01, 0.04))
                state.upd_model(acc.rstrip(), stats=f"↑ {random.randint(100,500)} · ↓ {random.randint(50,300)} · {random.uniform(5,20):.1f} tok/s", streaming=False)

            elif scenario == "tools":
                # Stream intro → tool call → stream result
                intro = "Let me check that for you."
                state.add_model("", streaming=True)
                acc = ""
                for w in intro.split(" "):
                    acc += w + " "; state.upd_model(acc.rstrip(), streaming=True); time.sleep(0.03)
                state.upd_model(acc.rstrip(), streaming=False)

                state.thinking = True; state.thinking_label = "Thinking... (esc to cancel)"; state._n()
                time.sleep(0.5)
                state.add_tool("Read", "chat.py (L1-50)")
                state.thinking = False; time.sleep(0.3)

                resp = "I've read the file. Here's what I found:\n\n- The chat command is **586 lines**\n- It uses `_tui_loop` for the full-screen TUI\n- `_raw_loop` handles `--style raw`\n- Tool callbacks check `_abort[0]` before writing to state\n\nWant me to make changes?"
                state.add_model("", streaming=True)
                acc = ""
                for w in resp.split(" "):
                    acc += w + " "; state.upd_model(acc.rstrip(), streaming=True); time.sleep(random.uniform(0.01, 0.04))
                state.upd_model(acc.rstrip(), stats=f"↑ {random.randint(300,800)} · ↓ {random.randint(100,400)} · {random.uniform(8,25):.1f} tok/s · 3.2s", streaming=False)

            elif scenario == "multi_tool":
                state.thinking = True; state.thinking_label = "Thinking... (esc to cancel)"; state._n()
                time.sleep(0.5)
                state.add_tool("Read", "REQUIREMENTS.md (L1-200)")
                time.sleep(0.3)
                state.add_tool("Read", "ARCHITECTURE.md (L1-150)")
                time.sleep(0.3)
                state.add_tool("Read", "tasks/manifest.yml")
                state.thinking = False; time.sleep(0.2)

                resp = "I've reviewed the project artifacts:\n\n```\nREQUIREMENTS.md  — 1,393 lines (IEEE 29148 / EARS)\nARCHITECTURE.md  — 892 lines (arc42 + C4)\ntasks/manifest.yml — 12 active tasks\n```\n\nThe requirements cover **22 sections** including:\n- System Architecture (REQ-ARCH-*)\n- Gather, Plan, Develop, Verify, Deploy\n- UI, Config, Security, Skills\n\n> All requirements use EARS notation with BDD acceptance criteria.\n\nWhat would you like to work on?"
                state.add_model("", streaming=True)
                acc = ""
                for w in resp.split(" "):
                    acc += w + " "; state.upd_model(acc.rstrip(), streaming=True); time.sleep(random.uniform(0.01, 0.04))
                state.upd_model(acc.rstrip(), stats=f"↑ {random.randint(500,1200)} · ↓ {random.randint(200,600)} · {random.uniform(10,30):.1f} tok/s · 5.1s", streaming=False)

            elif scenario == "write":
                state.thinking = True; state.thinking_label = "Thinking... (esc to cancel)"; state._n()
                time.sleep(0.5)
                state.add_tool("Read", "src/main.py (L1-40)")
                time.sleep(0.3)
                state.thinking = True; state.thinking_label = "Thinking... (esc to cancel)"; state._n()
                time.sleep(0.4)
                state.add_tool("Write", "src/main.py")
                state.messages.append(Message("diff", "",
                    tool_name="added 3 lines, removed 1 line at L22 in src/main.py",
                    stats=" 22   def process(payload):\n"
                           "-23       result = api.call(payload)\n"
                           "+23       try:\n"
                           "+24           result = api.call(payload)\n"
                           "+25       except APIError as e:\n"
                           "+26           logger.error(f\"API failed: {e}\")\n"
                           "+27           raise\n"
                           " 28       return result"))
                state._n()
                time.sleep(0.2)
                state.thinking = False

                resp = "Done. I've updated `src/main.py`:\n\n- Added error handling to the `process()` function\n- Wrapped the API call in a try/except\n- Added logging on failure\n\n```python\ntry:\n    result = api.call(payload)\nexcept APIError as e:\n    logger.error(f\"API failed: {e}\")\n    raise\n```"
                state.add_model("", streaming=True)
                acc = ""
                for w in resp.split(" "):
                    acc += w + " "; state.upd_model(acc.rstrip(), streaming=True); time.sleep(random.uniform(0.01, 0.04))
                state.upd_model(acc.rstrip(), stats=f"↑ {random.randint(400,900)} · ↓ {random.randint(150,500)} · {random.uniform(8,22):.1f} tok/s · 4.3s", streaming=False)

            state.context_pct = min(100, state.context_pct + random.randint(1, 5))
            state.busy = False; state._n()
        threading.Thread(target=_bg, daemon=True).start()

    @kb.add("c-c")
    def _exit(event): event.app.exit()

    @kb.add("pageup")
    def _pgup(event):
        total = len(_all_lines[0]); vh = _h()
        cur = max(0, total - vh) if _scroll_bottom[0] else _scroll_top[0]
        _scroll_bottom[0] = False
        _scroll_top[0] = max(0, cur - 20)

    @kb.add("pagedown")
    def _pgdn(event):
        total = len(_all_lines[0]); vh = _h()
        _scroll_top[0] = min(max(0, total - vh), _scroll_top[0] + 20)
        if _scroll_top[0] >= total - vh:
            _scroll_bottom[0] = True

    def _scroll_up_n(n=3):
        total = len(_all_lines[0]); vh = _h()
        cur = max(0, total - vh) if _scroll_bottom[0] else _scroll_top[0]
        _scroll_bottom[0] = False
        _scroll_top[0] = max(0, cur - n)

    def _scroll_down_n(n=3):
        total = len(_all_lines[0]); vh = _h()
        _scroll_top[0] = min(max(0, total - vh), _scroll_top[0] + n)
        if _scroll_top[0] >= total - vh:
            _scroll_bottom[0] = True

    style = Style.from_dict({
        "header-art":"#c678dd","header-tagline":"#888888 italic","header-welcome":"#666666",
        "callout-border":"#5a6aa8","callout-bg":"bg:#13132a",
        "callout-label":"bg:#13132a #666666","callout-model":"bg:#13132a #4ec9b0 bold",
        "callout-text":"bg:#13132a #888888","callout-cmd":"bg:#13132a #c678dd bold",
        "callout-hint":"bg:#13132a #555555",
        "rule":"#444444","operator":"bold #e0e0e0","operator-bar":"#4ec9b0",
        "tool-dot":"#c678dd bold","tool-name":"#61afef","tool-detail":"#888888",
        "diff-summary":"#888888","diff-add":"#98c379","diff-del":"#e06c75","diff-ctx":"#555555",
        "model-bar":"#6a7ec8","model-text":"#d4d4d4","streaming-cursor":"#6a7ec8",
        "stats":"#555555","thinking":"#e5c07b","system-msg":"#888888 italic",
        "footer-bg":"bg:#1a1a2e #aaaaaa","ft-name":"#4ec9b0","ft-mode":"#e5c07b","ft-dim":"#555555",
        "ctx-ok":"#4ec9b0","ctx-warn":"#e5c07b","ctx-crit":"#e06c75",
        "ft-path":"#61afef","ft-branch":"#c678dd",
        "input-text":"#e0e0e0","input-placeholder":"#555555 italic",
    })

    app = Application(layout=layout, key_bindings=kb, style=style,
                      full_screen=True, mouse_support=True, cursor=CursorShape.BLOCK)
    state._inv = lambda: app.invalidate()

    def _tick():
        while True:
            time.sleep(0.1)
            if state.thinking or any(m.streaming for m in state.messages): app.invalidate()
    threading.Thread(target=_tick,daemon=True).start()

    return app

if __name__=="__main__": build_app().run()
