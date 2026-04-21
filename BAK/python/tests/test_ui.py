"""Tests for ui.py output helpers (REQ-UI-2, V-UI-14)."""

from __future__ import annotations

from unittest.mock import patch, MagicMock


class TestMultiSpinnerPersistence:
    """V-UI-14: REQ-UI-2 — all completed rows persist after multi-spinner exits."""

    def test_all_completed_rows_printed_on_exit(self):
        """Every row marked done is printed when the multi-spinner context manager exits."""
        from voidrift_cli.ui import multi_spinner

        printed_texts: list[str] = []

        def fake_print(renderable, **kwargs):
            from rich.text import Text
            if isinstance(renderable, Text):
                printed_texts.append(renderable.plain)
            else:
                printed_texts.append(str(renderable))

        with patch("voidrift_cli.ui._con") as mock_con, \
             patch("voidrift_cli.ui._MultiSpinner._run"):
            mock_con.print.side_effect = fake_print

            # Simulate a Live block that does nothing
            mock_live = MagicMock()
            mock_live.__enter__ = MagicMock(return_value=mock_live)
            mock_live.__exit__ = MagicMock(return_value=False)

            with patch("rich.live.Live", return_value=mock_live):
                with multi_spinner("3 categories") as ms:
                    ms.track("cat-a")
                    ms.track("cat-b")
                    ms.track("cat-c")
                    ms.done("cat-a", "config: 4 files", 12.0, 0, 50)
                    ms.done("cat-b", "infrastructure: 2 files", 8.0, 0, 30)
                    ms.done("cat-c", "documentation: 12 files", 45.0, 0, 200)

        # All three completed rows must appear in printed output
        all_printed = " ".join(printed_texts)
        assert "config: 4 files" in all_printed, (
            f"config row not printed on exit. Got: {printed_texts!r}"
        )
        assert "infrastructure: 2 files" in all_printed, (
            f"infrastructure row not printed on exit. Got: {printed_texts!r}"
        )
        assert "documentation: 12 files" in all_printed, (
            f"documentation row not printed on exit. Got: {printed_texts!r}"
        )

    def test_no_rows_printed_when_none_completed(self):
        """No extra output when no rows were completed."""
        from voidrift_cli.ui import multi_spinner

        printed_texts: list[str] = []

        def fake_print(renderable, **kwargs):
            from rich.text import Text
            if isinstance(renderable, Text):
                printed_texts.append(renderable.plain)

        with patch("voidrift_cli.ui._con") as mock_con, \
             patch("voidrift_cli.ui._MultiSpinner._run"):
            mock_con.print.side_effect = fake_print

            mock_live = MagicMock()
            mock_live.__enter__ = MagicMock(return_value=mock_live)
            mock_live.__exit__ = MagicMock(return_value=False)

            with patch("rich.live.Live", return_value=mock_live):
                with multi_spinner("empty"):
                    pass  # nothing completed

        assert printed_texts == [], f"Expected no rows printed, got: {printed_texts!r}"

    def test_completed_rows_ordered(self):
        """Completed rows are printed in completion order."""
        from voidrift_cli.ui import multi_spinner

        printed_texts: list[str] = []

        def fake_print(renderable, **kwargs):
            from rich.text import Text
            if isinstance(renderable, Text):
                printed_texts.append(renderable.plain)

        with patch("voidrift_cli.ui._con") as mock_con, \
             patch("voidrift_cli.ui._MultiSpinner._run"):
            mock_con.print.side_effect = fake_print

            mock_live = MagicMock()
            mock_live.__enter__ = MagicMock(return_value=mock_live)
            mock_live.__exit__ = MagicMock(return_value=False)

            with patch("rich.live.Live", return_value=mock_live):
                with multi_spinner("ordered") as ms:
                    ms.track("first")
                    ms.track("second")
                    ms.track("third")
                    ms.done("first", "alpha", 1.0)
                    ms.done("second", "beta", 2.0)
                    ms.done("third", "gamma", 3.0)

        assert len(printed_texts) == 3
        assert "alpha" in printed_texts[0]
        assert "beta" in printed_texts[1]
        assert "gamma" in printed_texts[2]

    def test_no_duplicate_rows_on_exit(self):
        """Each completed row appears exactly once — not duplicated by live frame + post-exit print."""
        from voidrift_cli.ui import multi_spinner

        printed_texts: list[str] = []

        def fake_print(renderable, **kwargs):
            from rich.text import Text
            if isinstance(renderable, Text):
                printed_texts.append(renderable.plain)

        with patch("voidrift_cli.ui._con") as mock_con, \
             patch("voidrift_cli.ui._MultiSpinner._run"):
            mock_con.print.side_effect = fake_print

            mock_live = MagicMock()
            mock_live.__enter__ = MagicMock(return_value=mock_live)
            mock_live.__exit__ = MagicMock(return_value=False)

            with patch("rich.live.Live", return_value=mock_live):
                with multi_spinner("dedup") as ms:
                    ms.track("only")
                    ms.done("only", "assets: 1 file(s)", 64.0, 0, 71)

        matching = [t for t in printed_texts if "assets: 1 file(s)" in t]
        assert len(matching) == 1, (
            f"Expected exactly one 'assets' row, got {len(matching)}: {printed_texts!r}"
        )
