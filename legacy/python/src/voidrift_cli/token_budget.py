"""Token budget tracking for command runs (REQ-ARCH-13)."""

from __future__ import annotations


class BudgetExhaustedError(Exception):
    """Raised when a token budget limit is exceeded."""


class TokenBudget:
    """Tracks cumulative token usage and enforces limits.

    Created once per command run, shared across all agent instances.
    """

    def __init__(
        self,
        max_input_tokens: int | None = None,
        max_output_tokens: int | None = None,
    ) -> None:
        self.max_input_tokens = max_input_tokens
        self.max_output_tokens = max_output_tokens
        self.input_tokens = 0
        self.output_tokens = 0

    def record(self, input_tokens: int, output_tokens: int) -> None:
        """Record token usage from an API response."""
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens

    def check(self) -> None:
        """Raise BudgetExhaustedError if any limit is exceeded."""
        if self.max_input_tokens and self.input_tokens >= self.max_input_tokens:
            raise BudgetExhaustedError(
                f"Input token budget exhausted: {self.input_tokens:,} / {self.max_input_tokens:,}"
            )
        if self.max_output_tokens and self.output_tokens >= self.max_output_tokens:
            raise BudgetExhaustedError(
                f"Output token budget exhausted: {self.output_tokens:,} / {self.max_output_tokens:,}"
            )

    def summary(self) -> str:
        """Return a human-readable summary of usage vs limits."""
        parts = []
        if self.max_input_tokens:
            parts.append(f"input: {self.input_tokens:,} / {self.max_input_tokens:,}")
        if self.max_output_tokens:
            parts.append(f"output: {self.output_tokens:,} / {self.max_output_tokens:,}")
        if not parts:
            parts.append(f"input: {self.input_tokens:,} · output: {self.output_tokens:,}")
        return " · ".join(parts)
