"""翻譯 / 回答用的模型後端。

- claude：本機的 Claude Code 無頭模式（claude -p），用你已有的登入，不需要 Key；能自己讀原頁圖核對公式和表格。
- codex：本機的 Codex CLI（codex exec），同樣用已有登入，原頁圖作為附件發過去。
- openai：任何 OpenAI 相容介面（Ollama、智譜、矽基流動、DeepSeek、Gemini……），在設定裡填地址、模型和 Key；
  Chat Completions 和 Responses 兩種格式都行（見 openai_api.py）。
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from . import netcheck, usage


class EngineError(RuntimeError):
    pass


class Cancelled(RuntimeError):
    pass


ENGINE_NAMES = {"claude": "Claude Code", "codex": "Codex CLI", "openai": "API", "none": "不翻譯"}


def run(cfg: dict, prompt: str, cwd: Path, images: list[Path] | None = None, cancel: threading.Event | None = None,
        meter: usage.Meter | None = None) -> str:
    """meter：傳了就把這次呼叫的 token 用量記進去（整篇翻譯時用）。"""
    bad = netcheck.problem(cfg)
    if bad:
        raise EngineError(bad)
    try:
        return _run(cfg, prompt, cwd, images, cancel, meter)
    except EngineError as e:
        raise EngineError(netcheck.explain(cfg, str(e))) from None


def _run(cfg: dict, prompt: str, cwd: Path, images: list[Path] | None, cancel: threading.Event | None, meter) -> str:
    engine = cfg.get("engine")
    if engine == "claude":
        return run_claude(cfg["claude"], prompt, cwd, cancel, meter)
    if engine == "codex":
        return run_codex(cfg["codex"], prompt, cwd, images or [], cancel, meter)
    if engine == "openai":
        return run_openai(cfg["openai"], prompt, images or [], cancel, meter)
    raise EngineError("沒有配置翻譯引擎（設定 → 模型）")


def image_mode(cfg: dict) -> str:
    """提示詞裡怎麼說原頁圖：claude 自己用 Read 讀；codex 和能看圖的介面作為附件；其餘沒有圖。"""
    engine = cfg.get("engine")
    if engine == "claude":
        return "claude"
    if engine == "codex" or (engine == "openai" and cfg["openai"].get("vision")):
        return "attached"
    return "text"


def who(cfg: dict) -> str:
    engine = cfg.get("engine")
    if engine == "openai":
        return cfg["openai"].get("model") or "API"
    return {"claude": "claude", "codex": "codex"}.get(engine, "")


# ---------- 本機 CLI ----------
_NO_WINDOW = 0x08000000 if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
# stream-json 比 json 多一條 rate_limit_event（訂閱額度用了百分之幾）；-p 下用它必須加 --verbose
_CLAUDE_ARGS = ["--output-format", "stream-json", "--verbose", "--allowedTools", "Read", "--strict-mcp-config",
                "--disable-slash-commands", "--no-session-persistence"]


def claude_path(c: dict) -> str | None:
    return shutil.which(c.get("command") or "claude")


def codex_path(c: dict) -> str | None:
    return shutil.which(c.get("command") or "codex")


def _popen(args: list[str], cwd: Path):
    return subprocess.Popen(args, cwd=str(cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding="utf-8", errors="replace", creationflags=_NO_WINDOW,
                            env=netcheck.proxy_env())


def run_claude(c: dict, prompt: str, cwd: Path, cancel=None, meter=None) -> str:
    exe = claude_path(c)
    if not exe:
        raise EngineError(f"找不到 Claude Code 命令：{c.get('command') or 'claude'}（先裝好並登入 Claude Code）")
    args = [exe, "-p", *_CLAUDE_ARGS]
    if c.get("model"):
        args += ["--model", c["model"]]
    args += list(c.get("extra_args") or [])
    out = _communicate(_popen(args, cwd), prompt, int(c.get("timeout") or 1200), cancel)
    events = _json_lines(out)
    res = next((e for e in reversed(events) if e.get("type") == "result"), None)
    if res is None:
        raise EngineError(f"Claude Code 輸出不是 JSON：{out[:300]}")
    if meter is not None:
        meter.add(**usage.from_claude(res, next((e for e in reversed(events) if e.get("type") == "rate_limit_event"), None)))
    if res.get("is_error") or res.get("subtype", "success") != "success":
        msg = str(res.get("result") or res.get("terminal_reason") or res.get("subtype"))
        if "limit" in msg.lower():
            msg += "（用量到上限了，等額度恢復後點“重試”，或在設定裡換個引擎）"
        raise EngineError(f"Claude Code 出錯：{msg}")
    return res.get("result") or ""


def run_codex(c: dict, prompt: str, cwd: Path, images: list[Path], cancel=None, meter=None) -> str:
    exe = codex_path(c)
    if not exe:
        raise EngineError(f"找不到 Codex 命令：{c.get('command') or 'codex'}（先裝好並登入 Codex CLI）")
    fd, last = tempfile.mkstemp(suffix=".txt", prefix="easyread-codex-")
    os.close(fd)
    args = [exe, "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "--color", "never", "--json", "-o", last]
    if c.get("model"):
        args += ["--model", c["model"]]
    for img in images:
        args += ["-i", str(img)]
    args += list(c.get("extra_args") or []) + ["-"]
    try:
        out = _communicate(_popen(args, cwd), prompt, int(c.get("timeout") or 1200), cancel)
        text = Path(last).read_text(encoding="utf-8", errors="replace").strip()
    finally:
        Path(last).unlink(missing_ok=True)
    events = _json_lines(out)
    if meter is not None:
        for e in events:
            if e.get("type") == "turn.completed":
                meter.add(**usage.from_codex(e))
    if not text:
        errs = [str(e.get("message") or (e.get("error") or {}).get("message") or "") for e in events if e.get("type") in ("error", "turn.failed")]
        raise EngineError("Codex 沒有給出結果：" + (next((m for m in reversed(errs) if m), "") or (out or "")[-300:]))
    return text


def _json_lines(out: str) -> list[dict]:
    """CLI 一行一個 JSON 事件；夾雜的非 JSON 行跳過。"""
    events = []
    for line in (out or "").splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return events


def _communicate(proc, stdin_text: str, timeout: int, cancel) -> str:
    result = {}

    def talk():
        result["out"], result["err"] = proc.communicate(stdin_text)

    t = threading.Thread(target=talk, daemon=True)
    t.start()
    waited = 0.0
    while t.is_alive():
        t.join(0.5)
        waited += 0.5
        if cancel is not None and cancel.is_set():
            proc.kill()
            raise Cancelled()
        if waited > timeout:
            proc.kill()
            raise EngineError(f"超過 {timeout} 秒沒有結果")
    if proc.returncode not in (0, None) and not result.get("out"):
        raise EngineError((result.get("err") or "")[-500:] or f"退出碼 {proc.returncode}")
    return result.get("out", "")


# ---------- OpenAI 相容介面 ----------
def run_openai(c: dict, prompt: str, images: list[Path], cancel=None, meter=None) -> str:
    from . import openai_api  # 它要用本檔案的 EngineError，放這裡免得迴圈匯入
    return openai_api.complete(c, prompt, images, cancel, meter)


def parse_json(text: str):
    """從模型輸出裡取出 JSON（容忍 ```json 圍欄和前後廢話）。"""
    t = re.sub(r"<think>[\s\S]*?</think>", "", text).strip()  # 推理模型（deepseek-r1、qwen3）先輸出的思考過程
    # 先取最外層的 { … }：譯文裡可能本身帶程式碼塊（論文附錄的 PyTorch 程式碼），按 ``` 圍欄切會切到半截
    bodies = []
    for s in (t, *(m.group(1).strip() for m in re.finditer(r"```(?:json)?\s*([\s\S]*?)```", t))):
        start = min([i for i in (s.find("{"), s.find("[")) if i >= 0], default=-1)
        if start >= 0:
            bodies.append(s[start:max(s.rfind("}"), s.rfind("]")) + 1])
    if not bodies:
        raise EngineError("模型輸出裡沒有 JSON：" + text[:200])
    first = None
    for body in bodies:
        try:
            return json.loads(body)
        except json.JSONDecodeError as e:
            first = first or e
    body = bodies[0]
    # 常見毛病：TeX 反斜槓沒寫成兩個（\alpha、\sum）、字串裡有原樣換行
    fixed = re.sub(r'\\(?!["\\/bfnrtu])', r"\\\\", body)
    try:
        return json.loads(fixed, strict=False)
    except json.JSONDecodeError:
        raise EngineError(f"模型輸出的 JSON 格式有錯（{first}），會自動重試")


def _version(exe: str) -> str:
    try:
        return subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30,
                              creationflags=_NO_WINDOW).stdout.strip().splitlines()[0]
    except Exception:  # noqa: BLE001
        return ""


def test(cfg: dict) -> dict:
    """設定頁“測試”按鈕：真的讓模型回一句，確認引擎能用。"""
    engine = cfg.get("engine")
    if engine in ("claude", "codex"):
        exe = (claude_path if engine == "claude" else codex_path)(cfg[engine])
        if not exe:
            return {"ok": False, "message": f"找不到 {engine} 命令，先安裝並登入"}
    if engine == "none":
        return {"ok": True, "message": "未啟用自動翻譯"}
    try:
        out = run(cfg, '只回復 JSON，不要別的文字：{"ok": true}', Path(tempfile.gettempdir()), None, None)
        parse_json(out)
        return {"ok": True, "message": "可以用：" + out.strip()[:40]}
    except (EngineError, Cancelled) as e:
        return {"ok": False, "message": str(e)[:300]}
