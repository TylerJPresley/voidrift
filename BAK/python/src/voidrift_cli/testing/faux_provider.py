"""FauxProvider — record/replay test fixture for OpenAI-compatible API calls (REQ-TEST-1)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class CassetteNotFoundError(Exception):
    """Raised when replay mode has no fixture for a request."""


@dataclass
class FixtureEntry:
    """One recorded request/response pair."""

    request_hash: str
    request: dict
    response: dict
    recorded_at: str


def _hash_request(request: dict) -> str:
    """SHA-256 of canonical request, excluding non-deterministic fields."""
    canonical = {
        k: v for k, v in sorted(request.items())
        if k not in ("api_key", "timestamp", "x-request-id")
    }
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True, ensure_ascii=True).encode()
    ).hexdigest()


class _Completions:
    """Mimics ``client.chat.completions`` with a ``.create()`` method."""

    def __init__(self, provider: "FauxProvider"):
        self._provider = provider

    def create(self, **kwargs: Any) -> Any:
        return self._provider._handle_call(kwargs)


class _Chat:
    """Mimics ``client.chat`` with a ``.completions`` attribute."""

    def __init__(self, provider: "FauxProvider"):
        self.completions = _Completions(provider)


class FauxProvider:
    """Drop-in replacement for the OpenAI client backed by JSONL cassette files.

    Implements ``client.chat.completions.create(**kwargs)`` interface.

    Args:
        cassette_path: Path to the JSONL cassette file.
        mode: ``replay`` (default), ``record``, or ``passthrough``.
        real_client: Required when mode is ``record`` or ``passthrough``.
    """

    def __init__(
        self,
        cassette_path: Path,
        mode: str = "replay",
        real_client: Any = None,
    ):
        self._cassette_path = Path(cassette_path)
        self._mode = mode
        self._real_client = real_client
        self._entries: dict[str, FixtureEntry] = {}
        self.chat = _Chat(self)
        if self._cassette_path.exists():
            self._load_cassette()

    def _load_cassette(self) -> None:
        with open(self._cassette_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                entry = FixtureEntry(**json.loads(line))
                self._entries[entry.request_hash] = entry

    def _handle_call(self, kwargs: dict) -> Any:
        req_hash = _hash_request(kwargs)

        if self._mode == "replay":
            if req_hash not in self._entries:
                raise CassetteNotFoundError(
                    f"No fixture for request hash {req_hash[:12]}. "
                    f"Run with VCR_MODE=record to record it.\n"
                    f"Cassette: {self._cassette_path}"
                )
            return self._entries[req_hash].response

        if self._mode == "record":
            response = self._real_client.chat.completions.create(**kwargs)
            entry = FixtureEntry(
                request_hash=req_hash,
                request=kwargs,
                response=response,
                recorded_at=datetime.now(timezone.utc).isoformat(),
            )
            self._cassette_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self._cassette_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(asdict(entry)) + "\n")
            self._entries[req_hash] = entry
            return response

        # passthrough
        return self._real_client.chat.completions.create(**kwargs)
