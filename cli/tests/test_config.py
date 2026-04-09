"""Tests for config.py — per-stage max_tokens (REQ-CFG-7) and model limits (REQ-MC-3)."""

from __future__ import annotations

import pytest

from voidrift_cli.config import get_max_tokens, clear_config_cache, _expand_env
from voidrift_cli.models import ModelConfig


@pytest.fixture(autouse=True)
def clear_cache():
    clear_config_cache()
    yield
    clear_config_cache()


def _mc(**overrides) -> ModelConfig:
    """Build a ModelConfig with defaults, overriding specified fields."""
    defaults = dict(alias="test", model_id="test-model", max_tokens=16384)
    return ModelConfig(**{**defaults, **overrides})


class TestGetMaxTokens:
    """REQ-CFG-7: min(stage_default, model.max_tokens)."""

    def test_stage_default_wins_when_lower(self):
        mc = _mc(max_tokens=32768)
        assert get_max_tokens(mc, "gather.analysis") == 8192

    def test_model_cap_wins_when_lower(self):
        mc = _mc(max_tokens=4096)
        assert get_max_tokens(mc, "gather.consolidation") == 4096  # stage=8192, cap=4096

    def test_plan_stage_high_cap(self):
        mc = _mc(max_tokens=32768)
        assert get_max_tokens(mc, "plan.architecture") == 32768

    def test_plan_stage_low_cap(self):
        mc = _mc(max_tokens=4096)
        assert get_max_tokens(mc, "plan.architecture") == 4096

    def test_unknown_stage_defaults_to_4096(self):
        mc = _mc(max_tokens=16384)
        assert get_max_tokens(mc, "unknown_stage") == 4096

    def test_task_stage(self):
        mc = _mc(max_tokens=16384)
        assert get_max_tokens(mc, "plan.task") == 4000

    def test_triage_stage(self):
        mc = _mc(max_tokens=16384)
        assert get_max_tokens(mc, "gather.triage") == 8192

    def test_config_override_wins_over_builtin(self, tmp_path, monkeypatch):
        """config.yml stage_max_tokens overrides built-in default."""
        cfg = tmp_path / "config.yml"
        cfg.write_text("stage_max_tokens:\n  gather.analysis: 16384\n")
        monkeypatch.setenv("VOIDRIFT_HOME", str(tmp_path))
        clear_config_cache()
        mc = _mc(max_tokens=32768)
        assert get_max_tokens(mc, "gather.analysis") == 16384

    def test_config_override_still_capped_by_model(self, tmp_path, monkeypatch):
        """config.yml override is still capped by model.max_tokens."""
        cfg = tmp_path / "config.yml"
        cfg.write_text("stage_max_tokens:\n  gather.analysis: 32768\n")
        monkeypatch.setenv("VOIDRIFT_HOME", str(tmp_path))
        clear_config_cache()
        mc = _mc(max_tokens=4096)
        assert get_max_tokens(mc, "gather.analysis") == 4096


class TestModelConfigDefaults:
    """REQ-MC-3: ModelConfig carries operational limits with defaults."""

    def test_default_max_tokens(self):
        mc = _mc()
        assert mc.max_tokens == 16384

    def test_default_max_read_lines(self):
        mc = _mc()
        assert mc.max_read_lines == 2000

    def test_default_max_input_chars(self):
        mc = _mc()
        assert mc.max_input_chars == 0

    def test_default_concurrency(self):
        mc = _mc()
        assert mc.concurrency == 1

    def test_override_all(self):
        mc = _mc(max_tokens=4096, max_read_lines=1000, max_input_chars=8000, concurrency=8)
        assert mc.max_tokens == 4096
        assert mc.max_read_lines == 1000
        assert mc.max_input_chars == 8000
        assert mc.concurrency == 8


class TestExpandEnvNewlineStripping:
    """REQ-CFG-10: _expand_env strips CR and LF from resolved values."""

    def test_lf_stripped_from_env_var(self, monkeypatch):
        """LF in env var value is removed before return."""
        monkeypatch.setenv("MY_VAR", "line1\ninjected_line")
        result = _expand_env("${MY_VAR}")
        assert "\n" not in result
        assert result == "line1injected_line"

    def test_crlf_stripped_from_env_var(self, monkeypatch):
        """Both CR and LF are stripped when the value contains \\r\\n."""
        monkeypatch.setenv("MY_VAR", "value\r\nmore")
        result = _expand_env("${MY_VAR}")
        assert "\r" not in result
        assert "\n" not in result

    def test_lf_stripped_from_default(self, monkeypatch):
        """LF in the default branch (${UNSET:-default\\ninjection}) is stripped."""
        monkeypatch.delenv("UNSET_VAR", raising=False)
        result = _expand_env("${UNSET_VAR:-default\ninjection}")
        assert "\n" not in result
        assert result == "defaultinjection"

    def test_normal_value_unchanged(self, monkeypatch):
        """A value without newlines is returned unchanged."""
        monkeypatch.setenv("CLEAN_VAR", "sk-abc123")
        result = _expand_env("${CLEAN_VAR}")
        assert result == "sk-abc123"
