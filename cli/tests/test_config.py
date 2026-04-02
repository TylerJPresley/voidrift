"""Tests for config.py — per-stage max_tokens (REQ-CFG-7) and model limits (REQ-MC-3)."""

from __future__ import annotations

import pytest

from voidrift_cli.config import get_max_tokens, clear_config_cache
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
        assert get_max_tokens(mc, "analysis") == 2000

    def test_model_cap_wins_when_lower(self):
        mc = _mc(max_tokens=4096)
        assert get_max_tokens(mc, "consolidation") == 4096  # stage=8192, cap=4096

    def test_plan_stage_high_cap(self):
        mc = _mc(max_tokens=32768)
        assert get_max_tokens(mc, "plan") == 32768

    def test_plan_stage_low_cap(self):
        mc = _mc(max_tokens=4096)
        assert get_max_tokens(mc, "plan") == 4096

    def test_unknown_stage_defaults_to_4096(self):
        mc = _mc(max_tokens=16384)
        assert get_max_tokens(mc, "unknown_stage") == 4096

    def test_task_stage(self):
        mc = _mc(max_tokens=16384)
        assert get_max_tokens(mc, "task") == 4000

    def test_triage_stage(self):
        mc = _mc(max_tokens=16384)
        assert get_max_tokens(mc, "triage") == 4096


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
