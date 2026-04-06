"""Tests for two-layer project memory system (REQ-MEM-1)."""

from pathlib import Path

from voidrift_cli.memory import MemoryManager


class TestMemoryManager:
    """MemoryManager read/write/delete and two-layer resolution."""

    def test_write_read_roundtrip(self, tmp_path):
        """Write a memory entry and read it back."""
        mm = MemoryManager(str(tmp_path))
        mm.write("api-notes", "FastAPI with SQLAlchemy.", description="API stack info")
        content = mm.read("api-notes")
        assert content is not None
        assert "FastAPI with SQLAlchemy." in content

    def test_index_contains_names_and_descriptions(self, tmp_path):
        """Index prompt block lists all entries with descriptions."""
        mm = MemoryManager(str(tmp_path))
        mm.write("auth", "JWT RS256", description="Auth approach")
        mm.write("db", "PostgreSQL", description="Database choice")
        block = mm.index_prompt_block()
        assert "auth: Auth approach" in block
        assert "db: Database choice" in block

    def test_delete_removes_from_index(self, tmp_path):
        """Deleted entry no longer appears in index."""
        mm = MemoryManager(str(tmp_path))
        mm.write("temp", "temporary", description="Temp entry")
        assert mm.delete("temp")
        block = mm.index_prompt_block()
        assert "temp" not in block

    def test_project_overrides_global(self, tmp_path, monkeypatch):
        """Project entry with same name overrides global in listing."""
        monkeypatch.setenv("HOME", str(tmp_path / "home"))
        (tmp_path / "home").mkdir()
        mm = MemoryManager(str(tmp_path / "proj"))
        mm.write("conventions", "global style", scope="global", description="Global")
        mm.write("conventions", "project style", scope="project", description="Project")
        entries = mm.list_entries()
        conv = [e for e in entries if e.name == "conventions"]
        assert len(conv) == 1
        assert conv[0].scope == "project"

    def test_read_searches_project_then_global(self, tmp_path, monkeypatch):
        """read() finds global entries when project has no match."""
        monkeypatch.setenv("HOME", str(tmp_path / "home"))
        (tmp_path / "home").mkdir()
        mm = MemoryManager(str(tmp_path / "proj"))
        mm.write("global-only", "from global", scope="global", description="Global entry")
        content = mm.read("global-only")
        assert content is not None
        assert "from global" in content

    def test_memory_tools_absent_from_develop(self):
        """Memory tools are not in the develop command tool set."""
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools(cmd="develop")
        names = {t["function"]["name"] for t in tools}
        assert "read_memory" not in names
        assert "write_memory" not in names
        assert "list_memory" not in names

    def test_memory_tools_present_in_chat(self):
        """Memory tools are in the chat command tool set."""
        from voidrift_cli.agent import build_local_tools
        tools, handlers = build_local_tools(cmd="chat")
        names = {t["function"]["name"] for t in tools}
        assert "read_memory" in names
        assert "write_memory" in names
        assert "list_memory" in names
        assert "read_memory" in handlers


class TestMemoryCLI:
    """Tests for voidrift memory subcommands (REQ-MEM-1)."""

    def test_memory_list_grouped_by_layer(self, tmp_path, monkeypatch):
        """list shows entries grouped by project and global."""
        monkeypatch.setenv("HOME", str(tmp_path / "home"))
        (tmp_path / "home").mkdir()
        proj = tmp_path / "proj"
        proj.mkdir()
        monkeypatch.chdir(proj)
        mm = MemoryManager(str(proj))
        mm.write("proj-entry", "content", scope="project", description="Project thing")
        mm.write("glob-entry", "content", scope="global", description="Global thing")

        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["memory", "list"])
        assert "proj-entry" in result.output
        assert "glob-entry" in result.output

    def test_memory_show_prints_content(self, tmp_path, monkeypatch):
        """show prints full entry content."""
        monkeypatch.chdir(tmp_path)
        mm = MemoryManager(str(tmp_path))
        mm.write("test-entry", "This is the content.", description="Test")

        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["memory", "show", "test-entry"])
        assert "This is the content." in result.output

    def test_memory_delete_removes_entry(self, tmp_path, monkeypatch):
        """delete removes entry and it no longer appears in list."""
        monkeypatch.chdir(tmp_path)
        mm = MemoryManager(str(tmp_path))
        mm.write("to-delete", "gone soon", description="Temp")

        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["memory", "delete", "to-delete"])
        assert result.exit_code == 0
        assert mm.read("to-delete") is None
