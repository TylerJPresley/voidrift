"""Tests for tools/code_analysis.py (REQ-U-20)."""

from unittest.mock import MagicMock, patch
import json

from voidrift_cli.tools.code_analysis import code_analysis, LANG_MAP


class TestCodeAnalysis:
    """Tests for code_analysis extraction and error handling."""

    def test_unsupported_extension(self, tmp_path):
        """Unsupported extension returns error listing supported."""
        f = tmp_path / "data.xyz"
        f.write_text("stuff")
        result = code_analysis("data.xyz", str(tmp_path))
        assert "unsupported extension" in result.lower()
        assert ".py" in result

    def test_file_not_found(self, tmp_path):
        """Missing file returns error."""
        result = code_analysis("missing.py", str(tmp_path))
        assert "not found" in result.lower()

    def test_path_outside_root_blocked(self, tmp_path):
        """Path traversal outside project root is blocked."""
        result = code_analysis("../../etc/passwd.py", str(tmp_path))
        assert "outside" in result.lower()

    def test_missing_tree_sitter(self, tmp_path):
        """Missing tree-sitter returns install hint."""
        f = tmp_path / "main.py"
        f.write_text("x = 1")
        import sys
        saved = sys.modules.pop("tree_sitter", "MISSING")
        try:
            result = code_analysis("main.py", str(tmp_path))
        finally:
            if saved != "MISSING":
                sys.modules["tree_sitter"] = saved
        assert "pip install tree-sitter" in result

    def test_missing_grammar(self, tmp_path):
        """Missing grammar package returns install hint."""
        f = tmp_path / "main.py"
        f.write_text("x = 1")

        mock_ts = MagicMock()
        # Make the grammar import fail
        with patch("builtins.__import__", side_effect=_make_import_blocker("tree_sitter_python")):
            with patch.dict("sys.modules", {"tree_sitter": mock_ts}):
                result = code_analysis("main.py", str(tmp_path))
        assert "pip install tree-sitter-python" in result

    def test_python_analysis_returns_json(self, tmp_path):
        """Python file analysis returns valid JSON with expected fields."""
        f = tmp_path / "api.py"
        f.write_text("import os\n\ndef hello():\n    pass\n")

        # Build mock tree
        mock_import_node = _mock_node("import_statement", b"import os", 0, 9, line=0)
        mock_func_name = _mock_node("identifier", b"hello", 14, 19, line=2)
        mock_func_node = _mock_node("function_definition", b"def hello():\n    pass", 11, 31, line=2, children=[mock_func_name])
        mock_root = _mock_node("module", f.read_bytes(), 0, len(f.read_bytes()), line=0, children=[mock_import_node, mock_func_node])
        # _walk needs to traverse children recursively
        mock_root._all_nodes = [mock_root, mock_import_node, mock_func_node, mock_func_name]

        mock_tree = MagicMock()
        mock_tree.root_node = mock_root

        mock_parser = MagicMock()
        mock_parser.parse.return_value = mock_tree

        mock_language = MagicMock()
        mock_ts = MagicMock()
        mock_ts.Language.return_value = mock_language
        mock_ts.Parser.return_value = mock_parser

        mock_grammar = MagicMock()
        mock_grammar.language.return_value = "python_lang"

        with patch.dict("sys.modules", {"tree_sitter": mock_ts, "tree_sitter_python": mock_grammar}):
            result = code_analysis("api.py", str(tmp_path))

        data = json.loads(result)
        assert data["language"] == "python"
        assert data["lines"] >= 1
        assert isinstance(data["imports"], list)
        assert isinstance(data["symbols"], list)
        assert isinstance(data["complexity"], int)

    def test_lang_map_covers_common_extensions(self):
        """LANG_MAP covers Python, JS, TS, Rust, Go, Java, C, C++, Ruby."""
        for ext in [".py", ".js", ".ts", ".tsx", ".rs", ".go", ".java", ".c", ".cpp", ".rb"]:
            assert ext in LANG_MAP, f"{ext} not in LANG_MAP"


class TestCodeAnalysisToolRegistration:
    """Tests for tool set membership."""

    def test_chat_has_code_analysis(self):
        from voidrift_cli.agent import build_local_tools
        tools, handlers = build_local_tools(cmd="chat")
        names = {t["function"]["name"] for t in tools}
        assert "analyze" in names
        assert "analyze" in handlers

    def test_gather_has_code_analysis(self):
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools(cmd="gather")
        names = {t["function"]["name"] for t in tools}
        assert "analyze" in names

    def test_develop_no_code_analysis(self):
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools(cmd="develop")
        names = {t["function"]["name"] for t in tools}
        assert "code_analysis" not in names

    def test_plan_no_code_analysis(self):
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools(cmd="plan")
        names = {t["function"]["name"] for t in tools}
        assert "code_analysis" not in names


def _mock_node(node_type, source_bytes, start, end, line=0, children=None):
    """Create a mock tree-sitter node."""
    node = MagicMock()
    node.type = node_type
    node.start_byte = start
    node.end_byte = end
    node.start_point = (line, 0)
    node.children = children or []
    return node


def _make_import_blocker(blocked_module):
    """Return an __import__ replacement that blocks a specific module."""
    real_import = __builtins__.__import__ if hasattr(__builtins__, '__import__') else __import__

    def blocker(name, *args, **kwargs):
        if name == blocked_module:
            raise ImportError(f"No module named '{blocked_module}'")
        return real_import(name, *args, **kwargs)
    return blocker
