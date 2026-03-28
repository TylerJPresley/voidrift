"""Tests for config.py token budget helpers (REQ-CFG-6, REQ-CFG-7)."""

from __future__ import annotations

import pytest
from unittest.mock import patch

from voidrift_cli.config import get_max_tokens, get_max_input_chars, clear_config_cache


@pytest.fixture(autouse=True)
def clear_cache():
    clear_config_cache()
    yield
    clear_config_cache()


class TestGetMaxTokens:
    def test_local_analysis_uses_phase_default(self):
        with patch("voidrift_cli.config.load_config", return_value={}):
            assert get_max_tokens("local", "analysis") == 2000

    def test_local_task_uses_phase_default(self):
        with patch("voidrift_cli.config.load_config", return_value={}):
            assert get_max_tokens("local", "task") == 4000

    def test_cloud_consolidation_uses_phase_default(self):
        with patch("voidrift_cli.config.load_config", return_value={}):
            assert get_max_tokens("cloud", "consolidation") == 8192

    def test_cloud_plan_uses_phase_default(self):
        with patch("voidrift_cli.config.load_config", return_value={}):
            assert get_max_tokens("cloud", "plan") == 32768

    def test_cap_wins_when_lower_than_phase_default(self):
        # local cap 1500 < task default 4000 → cap wins
        cfg = {"limits": {"local_max_tokens": 1500}}
        with patch("voidrift_cli.config.load_config", return_value=cfg):
            assert get_max_tokens("local", "task") == 1500

    def test_phase_default_wins_when_lower_than_cap(self):
        # local cap 3000 > analysis default 2000 → phase default wins
        cfg = {"limits": {"local_max_tokens": 3000}}
        with patch("voidrift_cli.config.load_config", return_value=cfg):
            assert get_max_tokens("local", "analysis") == 2000

    def test_missing_limits_section_uses_defaults(self):
        with patch("voidrift_cli.config.load_config", return_value={}):
            # local default cap is 4096; triage default is 4096
            assert get_max_tokens("local", "triage") == 4096

    def test_unknown_phase_falls_back_to_4096(self):
        with patch("voidrift_cli.config.load_config", return_value={}):
            result = get_max_tokens("local", "unknown_phase")
            assert result == 4096

    def test_gateway_treated_like_cloud(self):
        with patch("voidrift_cli.config.load_config", return_value={}):
            assert get_max_tokens("gateway", "task") == 4000


class TestGetMaxInputChars:
    def test_local_returns_default_8000(self):
        with patch("voidrift_cli.config.load_config", return_value={}):
            assert get_max_input_chars("local") == 8000

    def test_cloud_returns_unlimited(self):
        with patch("voidrift_cli.config.load_config", return_value={}):
            assert get_max_input_chars("cloud") == 0

    def test_gateway_returns_unlimited(self):
        with patch("voidrift_cli.config.load_config", return_value={}):
            assert get_max_input_chars("gateway") == 0

    def test_config_override_applies_to_all_types(self):
        cfg = {"limits": {"max_input_chars": 5000}}
        with patch("voidrift_cli.config.load_config", return_value=cfg):
            assert get_max_input_chars("local") == 5000
            assert get_max_input_chars("cloud") == 5000

    def test_zero_means_unlimited(self):
        cfg = {"limits": {"max_input_chars": 0}}
        with patch("voidrift_cli.config.load_config", return_value=cfg):
            assert get_max_input_chars("local") == 0
