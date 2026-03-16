"""Tests for markdown_parser.py — pure unit tests, no mocking needed."""

from pathlib import Path

from voidrift_mcp.markdown_parser import parse_markdown, Section, MarkdownIndex


class TestParseMarkdown:
    def test_empty_string(self):
        assert parse_markdown("") == []

    def test_no_headings(self):
        assert parse_markdown("Just some text\nwith lines") == []

    def test_single_heading(self):
        secs = parse_markdown("# Title\n\nSome content here.")
        assert len(secs) == 1
        assert secs[0].heading == "Title"
        assert secs[0].level == 1
        assert "Some content here." in secs[0].content

    def test_multiple_headings(self):
        md = "# H1\nContent 1\n## H2\nContent 2\n### H3\nContent 3"
        secs = parse_markdown(md)
        assert len(secs) == 3
        assert [s.heading for s in secs] == ["H1", "H2", "H3"]
        assert [s.level for s in secs] == [1, 2, 3]

    def test_heading_content_boundaries(self):
        md = "# First\nLine A\nLine B\n# Second\nLine C"
        secs = parse_markdown(md)
        assert len(secs) == 2
        assert "Line A" in secs[0].content
        assert "Line B" in secs[0].content
        assert "Line C" in secs[1].content
        assert "Line C" not in secs[0].content

    def test_file_path_preserved(self):
        secs = parse_markdown("# Test", file_path="/some/file.md")
        assert secs[0].file_path == "/some/file.md"

    def test_heading_with_special_chars(self):
        secs = parse_markdown("## 1. Planning-First Directive (HARD GATE)")
        assert secs[0].heading == "1. Planning-First Directive (HARD GATE)"


class TestMarkdownIndex:
    def test_empty_index(self):
        idx = MarkdownIndex()
        assert idx.section_count == 0
        assert idx.list_headings() == []

    def test_load_file(self, tmp_path):
        f = tmp_path / "test.md"
        f.write_text("# Alpha\nContent A\n## Beta\nContent B")
        idx = MarkdownIndex()
        count = idx.load_file(f)
        assert count == 2
        assert idx.section_count == 2

    def test_load_directory(self, tmp_path):
        (tmp_path / "a.md").write_text("# A1\nfoo\n# A2\nbar")
        (tmp_path / "b.md").write_text("# B1\nbaz")
        (tmp_path / "skip.txt").write_text("not markdown")
        idx = MarkdownIndex()
        count = idx.load_directory(tmp_path)
        assert count == 3
        assert idx.section_count == 3

    def test_search(self, tmp_path):
        f = tmp_path / "test.md"
        f.write_text("# Escalation Protocol\nRules\n# Skill System\nSkills")
        idx = MarkdownIndex()
        idx.load_file(f)
        results = idx.search("escalation")
        assert len(results) == 1
        assert results[0].heading == "Escalation Protocol"

    def test_search_case_insensitive(self, tmp_path):
        f = tmp_path / "test.md"
        f.write_text("# UPPER HEADING\ncontent")
        idx = MarkdownIndex()
        idx.load_file(f)
        assert len(idx.search("upper")) == 1
        assert len(idx.search("UPPER")) == 1

    def test_search_with_file_filter(self, tmp_path):
        (tmp_path / "CONVENTIONS.md").write_text("# Rules\nconv content")
        (tmp_path / "AGENT.md").write_text("# Rules\nagent content")
        idx = MarkdownIndex()
        idx.load_directory(tmp_path)
        results = idx.search("Rules", file_filter="CONVENTIONS")
        assert len(results) == 1
        assert "conv content" in results[0].content

    def test_get_section_exact(self, tmp_path):
        f = tmp_path / "test.md"
        f.write_text("# Exact Match\nfound it\n# Other\nnope")
        idx = MarkdownIndex()
        idx.load_file(f)
        s = idx.get_section("Exact Match")
        assert s is not None
        assert "found it" in s.content
        assert idx.get_section("nonexistent") is None

    def test_list_headings(self, tmp_path):
        f = tmp_path / "test.md"
        f.write_text("# H1\n## H2\n### H3")
        idx = MarkdownIndex()
        idx.load_file(f)
        assert idx.list_headings() == ["H1", "H2", "H3"]

    def test_load_real_resources(self):
        """Load the actual framework resources directory and verify indexing."""
        resources = Path(__file__).resolve().parent.parent.parent / "resources"
        if not resources.is_dir():
            return  # Skip if not in repo
        idx = MarkdownIndex()
        count = idx.load_directory(resources)
        assert count > 50  # We know there are 221+ sections
        # Verify key sections are findable
        assert idx.get_section("Escalation Protocol") is not None
        assert len(idx.search("API Design", file_filter="skills/API-DESIGN")) > 0
