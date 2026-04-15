"""Structured code analysis tool via tree-sitter (REQ-U-20).

Soft dependency: tree-sitter + per-language grammar packages.
Returns compact JSON with language, line count, imports, symbols, complexity.
"""

from __future__ import annotations

import json
from pathlib import Path

# Extension → (tree-sitter language name, grammar pip package)
LANG_MAP: dict[str, tuple[str, str]] = {
    ".py": ("python", "tree-sitter-python"),
    ".js": ("javascript", "tree-sitter-javascript"),
    ".ts": ("typescript", "tree-sitter-typescript"),
    ".tsx": ("tsx", "tree-sitter-typescript"),
    ".rb": ("ruby", "tree-sitter-ruby"),
    ".rs": ("rust", "tree-sitter-rust"),
    ".go": ("go", "tree-sitter-go"),
    ".java": ("java", "tree-sitter-java"),
    ".c": ("c", "tree-sitter-c"),
    ".h": ("c", "tree-sitter-c"),
    ".cpp": ("cpp", "tree-sitter-cpp"),
    ".cc": ("cpp", "tree-sitter-cpp"),
}

# AST node types per language for imports
_IMPORT_NODES: dict[str, set[str]] = {
    "python": {"import_statement", "import_from_statement"},
    "javascript": {"import_statement"},
    "typescript": {"import_statement"},
    "tsx": {"import_statement"},
    "rust": {"use_declaration"},
    "go": {"import_declaration", "import_spec"},
    "java": {"import_declaration"},
    "ruby": {"call"},  # require/require_relative
    "c": {"preproc_include"},
    "cpp": {"preproc_include"},
}

# AST node types per language for exported symbols
_SYMBOL_NODES: dict[str, set[str]] = {
    "python": {"function_definition", "class_definition", "assignment"},
    "javascript": {"function_declaration", "class_declaration", "lexical_declaration", "variable_declaration", "export_statement"},
    "typescript": {"function_declaration", "class_declaration", "lexical_declaration", "type_alias_declaration", "interface_declaration", "export_statement"},
    "tsx": {"function_declaration", "class_declaration", "lexical_declaration", "type_alias_declaration", "interface_declaration", "export_statement"},
    "rust": {"function_item", "struct_item", "enum_item", "impl_item", "const_item", "type_item"},
    "go": {"function_declaration", "method_declaration", "type_declaration", "const_declaration"},
    "java": {"class_declaration", "interface_declaration", "method_declaration", "enum_declaration"},
    "ruby": {"method", "class", "module"},
    "c": {"function_definition", "declaration"},
    "cpp": {"function_definition", "class_specifier", "declaration"},
}

# AST node types for branch complexity
_BRANCH_NODES = {
    "if_statement", "for_statement", "while_statement", "try_statement",
    "except_clause", "match_statement",
    # JS/TS
    "if_statement", "for_statement", "for_in_statement", "while_statement",
    "try_statement", "catch_clause", "switch_case",
    # Rust
    "if_expression", "for_expression", "while_expression", "match_expression",
    # Go
    "if_statement", "for_statement", "select_statement",
}


def code_analysis(path: str, project_root: str) -> str:
    """Analyze a source file via tree-sitter and return JSON summary.

    Args:
        path: File path relative to project root.
        project_root: Absolute path to the project directory.

    Returns:
        JSON string with analysis results, or an error string.
    """
    root = Path(project_root).resolve()
    resolved = (root / path).resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        return f"Error: path '{path}' is outside the project root."

    if not resolved.exists():
        return f"Error: file not found: {path}"

    ext = resolved.suffix.lower()
    if ext not in LANG_MAP:
        supported = ", ".join(sorted(LANG_MAP.keys()))
        return f"Error: unsupported extension '{ext}'. Supported: {supported}"

    lang_name, grammar_pkg = LANG_MAP[ext]

    try:
        import tree_sitter
    except ImportError:
        return "Error: tree-sitter is not installed. Run: pip install tree-sitter"

    try:
        lang_mod = __import__(
            f"tree_sitter_{lang_name.replace('-', '_')}",
            fromlist=["language"],
        )
        language = tree_sitter.Language(lang_mod.language())
    except (ImportError, ModuleNotFoundError):
        return f"Error: {grammar_pkg} is not installed. Run: pip install {grammar_pkg}"

    source = resolved.read_bytes()
    parser = tree_sitter.Parser(language)
    tree = parser.parse(source)

    lines = source.count(b"\n") + (1 if source and not source.endswith(b"\n") else 0)
    imports = _extract_imports(tree.root_node, lang_name, source)
    symbols = _extract_symbols(tree.root_node, lang_name, source)
    complexity = _count_complexity(tree.root_node)

    result = {
        "language": lang_name,
        "lines": lines,
        "imports": imports,
        "symbols": symbols,
        "complexity": complexity,
    }
    return json.dumps(result, indent=2)


def _node_text(node, source: bytes) -> str:
    return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")


def _extract_imports(root, lang: str, source: bytes) -> list[str]:
    node_types = _IMPORT_NODES.get(lang, set())
    imports: list[str] = []
    for node in _walk(root):
        if node.type in node_types:
            text = _node_text(node, source).strip()
            # For Ruby, only capture require/require_relative calls
            if lang == "ruby" and not text.startswith(("require", "require_relative")):
                continue
            imports.append(text)
    return imports


def _extract_symbols(root, lang: str, source: bytes) -> list[dict]:
    node_types = _SYMBOL_NODES.get(lang, set())
    symbols: list[dict] = []
    for node in root.children:
        if node.type not in node_types:
            continue
        name = _get_symbol_name(node, lang, source)
        if name:
            symbols.append({
                "name": name,
                "type": node.type,
                "line": node.start_point[0] + 1,
            })
    return symbols


def _get_symbol_name(node, lang: str, source: bytes) -> str | None:
    # Look for a name/identifier child
    for child in node.children:
        if child.type in ("identifier", "name", "type_identifier", "property_identifier"):
            return _node_text(child, source)
    # Python assignment: first child is the target
    if lang == "python" and node.type == "assignment":
        target = node.children[0] if node.children else None
        if target and target.type == "identifier":
            name = _node_text(target, source)
            # Only top-level UPPER_CASE assignments as constants
            if name.isupper():
                return name
    return None


def _count_complexity(root) -> int:
    count = 0
    for node in _walk(root):
        if node.type in _BRANCH_NODES:
            count += 1
    return count


def _walk(node):
    """Depth-first walk of all nodes in the tree."""
    yield node
    for child in node.children:
        yield from _walk(child)
