"""Extract model JSON without mistaking citation brackets for a result.

Adapted from bisuwuss-netizen's EasyRead PR #64. Keep block-array responses
supported, and skip malformed outer containers instead of rescuing their children.
"""
from __future__ import annotations

import json
import re

_DECODER = json.JSONDecoder(strict=False)


def _end(text: str, start: int) -> int:
    depth, quoted, escaped = 0, False, False
    for i in range(start, len(text)):
        char = text[i]
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
        elif char in "]}":
            depth -= 1
            if depth == 0:
                return i + 1
    return len(text)


def _payload(text: str):
    error, pos = None, 0
    while pos < len(text):
        match = re.search(r"[\[{]", text[pos:])
        if not match:
            break
        start = pos + match.start()
        pos = _end(text, start)
        try:
            obj, end = _DECODER.raw_decode(text, start)
            if end == pos and (isinstance(obj, dict) or isinstance(obj, list)
                               and all(isinstance(block, dict) for block in obj)):
                return obj, None
        except json.JSONDecodeError as exc:
            error = error or exc
    return None, error


def extract(text: str):
    """Return (object or block array, first decode error); numeric citations lose."""
    text = re.sub(r"<think>[\s\S]*?</think>", "", text).strip()
    obj, error = _payload(text)
    if obj is None:
        obj, _ = _payload(re.sub(r'\\(?!["\\/bfnrtu])', r"\\\\", text))
    return obj, error
