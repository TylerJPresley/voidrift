"""Shared fixtures for worker-cli tests."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
os.environ["VOIDRIFT_HOME"] = str(REPO_ROOT)
