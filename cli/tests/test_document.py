"""Tests for tools/document.py (REQ-U-19)."""

from unittest.mock import patch, MagicMock
from pathlib import Path

from voidrift_cli.tools.document import read_document, _table_to_markdown


class TestReadDocument:
    """Tests for read_document extraction and error handling."""

    def test_unsupported_extension(self, tmp_path):
        """Unsupported format returns error listing supported formats."""
        f = tmp_path / "notes.txt"
        f.write_text("hello")
        result = read_document("notes.txt", str(tmp_path))
        assert "unsupported format" in result.lower()
        assert ".pdf" in result
        assert ".docx" in result
        assert ".xlsx" in result

    def test_file_not_found(self, tmp_path):
        """Missing file returns error."""
        result = read_document("missing.pdf", str(tmp_path))
        assert "not found" in result.lower()

    def test_path_outside_root_blocked(self, tmp_path):
        """Path traversal outside project root is blocked."""
        result = read_document("../../etc/passwd.pdf", str(tmp_path))
        assert "outside" in result.lower()

    def test_pdf_missing_library(self, tmp_path):
        """Missing pymupdf returns install hint."""
        f = tmp_path / "spec.pdf"
        f.write_bytes(b"%PDF-1.4 fake")
        with patch.dict("sys.modules", {"fitz": None}):
            # Force ImportError by removing fitz from available modules
            import sys
            saved = sys.modules.pop("fitz", "MISSING")
            try:
                result = read_document("spec.pdf", str(tmp_path))
            finally:
                if saved != "MISSING":
                    sys.modules["fitz"] = saved
        assert "pip install pymupdf" in result

    def test_docx_missing_library(self, tmp_path):
        """Missing python-docx returns install hint."""
        f = tmp_path / "reqs.docx"
        f.write_bytes(b"PK fake")
        import sys
        saved = sys.modules.pop("docx", "MISSING")
        try:
            result = read_document("reqs.docx", str(tmp_path))
        finally:
            if saved != "MISSING":
                sys.modules["docx"] = saved
        assert "pip install python-docx" in result

    def test_xlsx_missing_library(self, tmp_path):
        """Missing openpyxl returns install hint."""
        f = tmp_path / "data.xlsx"
        f.write_bytes(b"PK fake")
        import sys
        saved = sys.modules.pop("openpyxl", "MISSING")
        try:
            result = read_document("data.xlsx", str(tmp_path))
        finally:
            if saved != "MISSING":
                sys.modules["openpyxl"] = saved
        assert "pip install openpyxl" in result

    def test_pdf_extraction(self, tmp_path):
        """PDF extraction returns page text when pymupdf available."""
        f = tmp_path / "spec.pdf"
        f.write_bytes(b"%PDF")

        mock_page = MagicMock()
        mock_page.get_text.return_value = "Page 1 content"
        mock_doc = MagicMock()
        mock_doc.__iter__ = lambda self: iter([mock_page])
        mock_fitz = MagicMock()
        mock_fitz.open.return_value = mock_doc

        with patch.dict("sys.modules", {"fitz": mock_fitz}):
            result = read_document("spec.pdf", str(tmp_path))
        assert "Page 1 content" in result

    def test_docx_heading_hierarchy(self, tmp_path):
        """DOCX extraction preserves heading hierarchy."""
        f = tmp_path / "reqs.docx"
        f.write_bytes(b"PK")

        mock_para1 = MagicMock()
        mock_para1.text = "Title"
        mock_para1.style.name = "Heading 1"
        mock_para2 = MagicMock()
        mock_para2.text = "Subtitle"
        mock_para2.style.name = "Heading 2"
        mock_para3 = MagicMock()
        mock_para3.text = "Body text"
        mock_para3.style.name = "Normal"

        mock_doc = MagicMock()
        mock_doc.paragraphs = [mock_para1, mock_para2, mock_para3]
        mock_doc.tables = []

        mock_docx = MagicMock()
        mock_docx.Document.return_value = mock_doc

        with patch.dict("sys.modules", {"docx": mock_docx}):
            result = read_document("reqs.docx", str(tmp_path))
        assert "# Title" in result
        assert "## Subtitle" in result
        assert "Body text" in result

    def test_xlsx_markdown_tables(self, tmp_path):
        """XLSX extraction returns markdown tables per sheet."""
        f = tmp_path / "data.xlsx"
        f.write_bytes(b"PK")

        mock_ws = MagicMock()
        mock_ws.values = iter([("Name", "Age"), ("Alice", "30")])

        mock_wb = MagicMock()
        mock_wb.sheetnames = ["Sheet1"]
        mock_wb.__getitem__ = lambda self, k: mock_ws

        mock_openpyxl = MagicMock()
        mock_openpyxl.load_workbook.return_value = mock_wb

        with patch.dict("sys.modules", {"openpyxl": mock_openpyxl}):
            result = read_document("data.xlsx", str(tmp_path))
        assert "## Sheet1" in result
        assert "| Name | Age |" in result
        assert "| Alice | 30 |" in result
        assert "---" in result


class TestTableToMarkdown:
    """Tests for _table_to_markdown helper."""

    def test_basic_table(self):
        rows = [["A", "B"], ["1", "2"]]
        md = _table_to_markdown(rows)
        assert "| A | B |" in md
        assert "| 1 | 2 |" in md
        assert "| --- | --- |" in md

    def test_empty_rows(self):
        assert _table_to_markdown([]) == ""

    def test_short_row_padded(self):
        rows = [["A", "B", "C"], ["1"]]
        md = _table_to_markdown(rows)
        assert "| 1 |  |  |" in md


class TestReadDocumentToolRegistration:
    """Tests for tool set membership."""

    def test_chat_has_read_document(self):
        from voidrift_cli.agent import build_local_tools
        tools, handlers = build_local_tools(cmd="chat")
        names = {t["function"]["name"] for t in tools}
        assert "analyze" in names
        assert "analyze" in handlers

    def test_gather_has_read_document(self):
        from voidrift_cli.agent import build_local_tools
        tools, handlers = build_local_tools(cmd="gather")
        names = {t["function"]["name"] for t in tools}
        assert "analyze" in names

    def test_develop_no_read_document(self):
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools(cmd="develop")
        names = {t["function"]["name"] for t in tools}
        assert "read_document" not in names

    def test_plan_no_read_document(self):
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools(cmd="plan")
        names = {t["function"]["name"] for t in tools}
        assert "read_document" not in names
