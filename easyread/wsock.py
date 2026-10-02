"""最小的 WebSocket 服務端：只用來知道頁面還開著（握手、讀到斷開為止），不收發業務資料。

為什麼不用一直掛著的普通 HTTP 請求（SSE）：瀏覽器對同一個地址最多同時開 6 條 HTTP 連線，
每個標籤頁佔一條，開到五六個標籤頁所有請求都要排隊。WebSocket 不佔這 6 條的名額。
"""
from __future__ import annotations

import base64
import hashlib
import struct

_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def is_upgrade(headers) -> bool:
    return (headers.get("Upgrade") or "").lower() == "websocket" and bool(headers.get("Sec-WebSocket-Key"))


def accept(handler) -> None:
    """回 101，連線從此是 WebSocket。"""
    key = handler.headers["Sec-WebSocket-Key"].strip()
    digest = base64.b64encode(hashlib.sha1((key + _GUID).encode()).digest()).decode()
    handler.send_response(101, "Switching Protocols")
    handler.send_header("Upgrade", "websocket")
    handler.send_header("Connection", "Upgrade")
    handler.send_header("Sec-WebSocket-Accept", digest)
    handler.end_headers()
    handler.wfile.flush()


def _read(rfile, n: int) -> bytes:
    data = rfile.read(n)
    if len(data) < n:
        raise EOFError
    return data


def _send(wfile, opcode: int, payload: bytes = b"") -> None:
    wfile.write(bytes([0x80 | opcode, len(payload)]) + payload)  # 只發控制幀，長度不會超過 125
    wfile.flush()


def hold(handler) -> None:
    """一直讀，直到頁面關掉（收到關閉幀或連線斷開）。ping 回 pong，其餘訊息忽略。"""
    rfile, wfile = handler.rfile, handler.wfile
    try:
        while True:
            b0, b1 = _read(rfile, 2)
            opcode, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", _read(rfile, 2))[0]
            elif n == 127:
                n = struct.unpack(">Q", _read(rfile, 8))[0]
            mask = _read(rfile, 4) if b1 & 0x80 else b""
            payload = _read(rfile, n) if n else b""
            if mask:
                payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
            if opcode == 0x8:  # 關閉：回一個關閉幀
                _send(wfile, 0x8, payload[:2])
                return
            if opcode == 0x9:
                _send(wfile, 0xA, payload[:125])
    except (EOFError, OSError, ValueError):
        return
