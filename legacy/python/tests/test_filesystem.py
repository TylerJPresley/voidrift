"""Tests for WriteContext filesystem tools (REQ-D-5, REQ-FSZ-5, REQ-SEC-1)."""

import sys
import importlib

from voidrift_cli.tools.filesystem import WriteContext


class TestWriteContextInit:
    def test_module_import_does_not_construct_write_context(self):
        """Importing filesystem module does not instantiate WriteContext; no singleton exists."""
        import voidrift_cli.tools.filesystem as fs_mod
        importlib.reload(fs_mod)
        assert not hasattr(fs_mod, '_ctx'), "No module-level _ctx singleton should exist after TODO-02"
        assert not hasattr(fs_mod, '_get_ctx'), "No _get_ctx function should exist after TODO-02"

    def test_write_context_requires_explicit_project_dir(self, tmp_path):
        """Constructing WriteContext with an explicit project_dir works correctly."""
        ctx = WriteContext(project_dir=tmp_path)
        assert ctx._project_dir == tmp_path.resolve()
        # Writes go to the explicit dir, not cwd
        result = ctx.write_source_file("hello.txt", "content")
        assert "Wrote" in result
        assert (tmp_path / "hello.txt").exists()


class TestReadBytesGuard:
    def test_no_truncation_at_limit(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        ctx._max_read_bytes = 1024
        f = tmp_path / "exact.txt"
        f.write_text("x" * 1024)
        result = ctx.read_source_file("exact.txt")
        assert "TRUNCATED" not in result

    def test_truncation_over_limit(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        ctx._max_read_bytes = 1024
        f = tmp_path / "big.txt"
        f.write_text("y" * 2048)
        result = ctx.read_source_file("big.txt")
        assert "TRUNCATED" in result
        assert "Showing first 1KB" in result

    def test_disabled_when_zero(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        ctx._max_read_bytes = 0
        f = tmp_path / "huge.txt"
        f.write_text("z" * 100_000)
        result = ctx.read_source_file("huge.txt")
        assert "TRUNCATED" not in result

    def test_utf8_boundary_safe(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        ctx._max_read_bytes = 100
        f = tmp_path / "utf8.txt"
        f.write_text("é" * 200)
        result = ctx.read_source_file("utf8.txt")
        assert "TRUNCATED" in result
        result.encode("utf-8")


class TestProtectedPaths:
    def test_protected_path_blocked(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        ctx._protected_paths = {"pyproject.toml"}
        result = ctx.write_source_file("pyproject.toml", "content")
        assert "blocked" in result.lower() or "protected" in result.lower()
        assert not (tmp_path / "pyproject.toml").exists()

    def test_non_protected_allowed(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        ctx._protected_paths = {"pyproject.toml"}
        result = ctx.write_source_file("src/main.py", "content")
        assert (tmp_path / "src" / "main.py").exists()

    def test_path_traversal_blocked(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        result = ctx.write_source_file("../../etc/passwd", "evil")
        assert "blocked" in result.lower() or "outside" in result.lower() or "denied" in result.lower()


class TestEditAmbiguity:
    def test_exact_match_replaces(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        (tmp_path / "f.py").write_text("x = 1\ny = 2\n")
        result = ctx.edit_source_file("f.py", "x = 1", "x = 42")
        assert "x = 42" in (tmp_path / "f.py").read_text()

    def test_ambiguous_rejected(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        (tmp_path / "f.py").write_text("x = 1\nx = 1\nx = 1\n")
        result = ctx.edit_source_file("f.py", "x = 1", "x = 42")
        assert "3 times" in result or "appears 3" in result

    def test_not_found_returns_error(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        (tmp_path / "f.py").write_text("x = 1\n")
        result = ctx.edit_source_file("f.py", "NONEXISTENT", "x = 42")
        assert "not found" in result.lower() or "no match" in result.lower()


class TestLocalToolsNotInFilesystem:
    def test_local_tools_not_defined_in_filesystem_module(self):
        """LOCAL_TOOLS and make_local_handlers are defined in registry.py, not filesystem.py."""
        import voidrift_cli.tools.filesystem as fs_mod
        import voidrift_cli.tools.registry as reg_mod

        # Confirm DOMAIN_TOOLS and factory are in registry
        assert hasattr(reg_mod, "DOMAIN_TOOLS")
        assert hasattr(reg_mod, "make_domain_handlers")
        assert callable(reg_mod.make_domain_handlers)

        # Confirm legacy symbols are gone
        assert not hasattr(reg_mod, "LOCAL_TOOLS"), (
            "LOCAL_TOOLS should be removed after tool consolidation"
        )
        assert not hasattr(reg_mod, "make_local_handlers"), (
            "make_local_handlers should be removed after tool consolidation"
        )

        # Confirm LOCAL_TOOLS is NOT independently defined in filesystem
        assert not hasattr(fs_mod, "LOCAL_TOOLS"), (
            "LOCAL_TOOLS should not be re-exported from filesystem after TODO-02"
        )
