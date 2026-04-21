"""Tests for token budget enforcement (REQ-ARCH-13)."""

import pytest
from voidrift_cli.token_budget import TokenBudget, BudgetExhaustedError


class TestTokenBudget:
    def test_record_accumulates(self):
        tb = TokenBudget(max_input_tokens=10000)
        tb.record(3000, 500)
        tb.record(4000, 600)
        assert tb.input_tokens == 7000
        assert tb.output_tokens == 1100

    def test_check_raises_on_input_exceeded(self):
        tb = TokenBudget(max_input_tokens=5000)
        tb.record(6000, 0)
        with pytest.raises(BudgetExhaustedError, match="Input"):
            tb.check()

    def test_check_raises_on_output_exceeded(self):
        tb = TokenBudget(max_output_tokens=1000)
        tb.record(0, 1500)
        with pytest.raises(BudgetExhaustedError, match="Output"):
            tb.check()

    def test_check_passes_when_within_limits(self):
        tb = TokenBudget(max_input_tokens=10000, max_output_tokens=5000)
        tb.record(5000, 2000)
        tb.check()

    def test_no_limits_never_raises(self):
        tb = TokenBudget()
        tb.record(999999, 999999)
        tb.check()

    def test_summary_format(self):
        tb = TokenBudget(max_output_tokens=10000)
        tb.record(5000, 3000)
        s = tb.summary()
        assert "3,000" in s
        assert "10,000" in s
