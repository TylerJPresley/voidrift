"""Markdown parser — indexes .md files by header for section-level retrieval (AC-MCP2)."""

from __future__ import annotations

import re
from pathlib import Path

from pydantic import BaseModel, PrivateAttr


class Section(BaseModel):
    """A single markdown section identified by its heading."""

    heading: str
    level: int
    content: str
    file_path: str


def parse_markdown(text: str, file_path: str = "") -> list[Section]:
    """Split markdown into sections keyed by heading.

    Each section includes everything from its heading line up to (but not
    including) the next heading of equal or higher level.
    """
    lines = text.split("\n")
    sections: list[Section] = []
    current_heading = ""
    current_level = 0
    current_lines: list[str] = []

    def _flush():
        if current_heading:
            sections.append(
                Section(
                    heading=current_heading,
                    level=current_level,
                    content="\n".join(current_lines).strip(),
                    file_path=file_path,
                )
            )

    heading_re = re.compile(r"^(#{1,6})\s+(.+)$")

    for line in lines:
        m = heading_re.match(line)
        if m:
            _flush()
            current_level = len(m.group(1))
            current_heading = m.group(2).strip()
            current_lines = [line]
        else:
            current_lines.append(line)

    _flush()
    return sections


class MarkdownIndex(BaseModel):
    """In-memory index of markdown sections across multiple files (AC-MCP2, AC-MCP5)."""

    _sections: list[Section] = PrivateAttr(default_factory=list)

    def load_file(self, path: Path) -> int:
        """Parse a markdown file and add its sections to the index.

        Args:
            path: Path to a markdown file.

        Returns:
            Number of sections added.
        """
        text = path.read_text(encoding="utf-8")
        secs = parse_markdown(text, str(path))
        self._sections.extend(secs)
        return len(secs)

    def load_directory(self, directory: Path, pattern: str = "*.md") -> int:
        """Recursively load all matching markdown files from a directory.

        Args:
            directory: Root directory to scan.
            pattern: Glob pattern for file matching.

        Returns:
            Total number of sections added.
        """
        count = 0
        if directory.is_dir():
            for p in sorted(directory.rglob(pattern)):
                count += self.load_file(p)
        return count

    def search(self, query: str, file_filter: str | None = None) -> list[Section]:
        """Find sections whose heading contains the query (case-insensitive).

        Args:
            query: Search string to match against headings.
            file_filter: Optional substring to filter by file path.

        Returns:
            List of matching Section objects.
        """
        q = query.lower()
        results = []
        for s in self._sections:
            if file_filter and file_filter not in s.file_path:
                continue
            if q in s.heading.lower():
                results.append(s)
        return results

    def get_section(self, heading: str, file_filter: str | None = None) -> Section | None:
        """Get a section by exact heading match (case-insensitive).

        Args:
            heading: Exact heading text to match.
            file_filter: Optional substring to filter by file path.

        Returns:
            Matching Section, or None.
        """
        h = heading.lower()
        for s in self._sections:
            if file_filter and file_filter not in s.file_path:
                continue
            if s.heading.lower() == h:
                return s
        return None

    def list_headings(self, file_filter: str | None = None) -> list[str]:
        """List all indexed headings, optionally filtered by file path substring.

        Args:
            file_filter: Optional substring to filter by file path.

        Returns:
            List of heading strings.
        """
        return [
            s.heading
            for s in self._sections
            if not file_filter or file_filter in s.file_path
        ]

    @property
    def section_count(self) -> int:
        """Return the total number of indexed sections."""
        return len(self._sections)
