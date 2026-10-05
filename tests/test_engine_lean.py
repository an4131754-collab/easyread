"""翻譯時本機 CLI 只帶用得到的東西：Claude 只給 Read 工具，Codex 關掉使用者的 MCP 和用不到的功能；不認新參數時退回原樣。
python -m unittest tests.test_engine_lean"""
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from easyread import codex_lean, engines

CONFIG = """model = "gpt-x"
notify = ["C:\\\\x\\\\notify.exe", "turn-ended"]

[mcp_servers.firecrawl]
command = "npx"

[mcp_servers.firecrawl.env]
KEY = "secret"

[mcp_servers."my.server"]
command = "x"

[ mcp_servers.node_repl ]
command = 'C:\\x\\node_repl.exe'

[model_providers.mine]
base_url = "https://example.invalid"
"""


class CodexLeanTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, True)

    def test_server_names_skip_subtables(self):
        self.assertEqual(codex_lean.server_names(CONFIG), ["firecrawl", "my.server", "node_repl"])

    def test_args_disable_each_server_and_notify_keep_provider(self):
        (self.dir / "config.toml").write_text(CONFIG, encoding="utf-8")
        a = codex_lean.args(self.dir / "config.toml")
        pairs = [a[i + 1] for i in range(0, len(a), 2)]
        self.assertTrue(all(a[i] == "-c" for i in range(0, len(a), 2)))
        self.assertIn("mcp_servers.firecrawl.enabled=false", pairs)
        self.assertIn('mcp_servers."my.server".enabled=false', pairs)
        self.assertIn("mcp_servers.node_repl.enabled=false", pairs)
        self.assertIn("notify=[]", pairs)
        self.assertIn("features.plugins=false", pairs)
        self.assertFalse(any("provider" in p or p.startswith("model") for p in pairs))  # 使用者的 provider、模型不動
        self.assertNotIn("--ignore-user-config", a)

    def test_missing_or_odd_config_only_turns_features_off(self):
        self.assertEqual(codex_lean.args(self.dir / "nope.toml"), codex_lean.features())
        (self.dir / "config.toml").write_bytes(b"\xff\xfe\x00garbage")
        self.assertEqual(codex_lean.args(self.dir / "config.toml"), codex_lean.features())

    def test_codex_home_env(self):
        with mock.patch.dict("os.environ", {"CODEX_HOME": str(self.dir)}):
            self.assertEqual(codex_lean.config_path(), self.dir / "config.toml")


def fake_popen(calls, replies):
    """記下每次的命令行，按順序返回 replies 裡的 (stdout, 'stderr' 或 None)。"""
    def popen(args, cwd):
        calls.append(list(args))
        return replies[len(calls) - 1]
    return popen


class EngineLeanTest(unittest.TestCase):
    def test_for_translation_marks_cli_engines_only(self):
        cfg = {"engine": "claude", "claude": {"model": "opus"}, "codex": {}, "openai": {"model": "m"}}
        out = engines.for_translation(cfg)
        self.assertTrue(out["claude"]["lean"] and out["codex"]["lean"])
        self.assertEqual(out["claude"]["model"], "opus")
        self.assertNotIn("lean", out["openai"])
        self.assertNotIn("lean", cfg["claude"])  # 原設定不改（問 AI 還用它）

    def run_claude(self, c, outcomes):
        calls = []

        def communicate(proc, text, timeout, cancel):
            calls.append(proc)
            r = outcomes[len(calls) - 1]
            if isinstance(r, Exception):
                raise r
            return r

        ok = json.dumps({"type": "result", "subtype": "success", "result": "譯文", "usage": {}})
        outcomes = [ok if o == "ok" else o for o in outcomes]
        with mock.patch.object(engines, "claude_path", lambda c: "claude"), \
                mock.patch.object(engines, "_popen", lambda args, cwd: list(args)), \
                mock.patch.object(engines, "_communicate", communicate):
            return engines.run_claude(c, "p", Path(".")), calls

    def test_claude_lean_uses_tools_read_and_keeps_model(self):
        text, calls = self.run_claude({"lean": True, "model": "opus", "reasoning_effort": "high"}, ["ok"])
        self.assertEqual(text, "譯文")
        self.assertIn("--tools", calls[0])
        self.assertEqual(calls[0][calls[0].index("--tools") + 1], "Read")
        self.assertIn("opus", calls[0])
        self.assertNotIn("--effort", calls[0])
        _, calls = self.run_claude({"model": "opus"}, ["ok"])  # 問 AI：不加
        self.assertNotIn("--tools", calls[0])

    def test_claude_falls_back_when_option_unknown(self):
        text, calls = self.run_claude({"lean": True}, [engines.EngineError("error: unknown option '--tools'"), "ok"])
        self.assertEqual(text, "譯文")
        self.assertIn("--tools", calls[0])
        self.assertNotIn("--tools", calls[1])

    def test_claude_other_errors_not_retried(self):
        with self.assertRaises(engines.EngineError):
            self.run_claude({"lean": True}, [engines.EngineError("network down")])

    def run_codex(self, c, outcomes):
        calls = []

        def once(exe, c_, prompt, cwd, images, cancel, extra):
            calls.append(list(extra))
            r = outcomes[len(calls) - 1]
            if isinstance(r, Exception):
                raise r
            return r

        with mock.patch.object(engines, "codex_path", lambda c: "codex"), mock.patch.object(engines, "_codex_once", once), \
                mock.patch.object(codex_lean, "args", lambda: ["-c", "mcp_servers.x.enabled=false"]):
            return engines.run_codex(c, "p", Path("."), []), calls

    def test_codex_lean_passes_overrides(self):
        text, calls = self.run_codex({"lean": True}, [("譯文", "")])
        self.assertEqual((text, calls), ("譯文", [["-c", "mcp_servers.x.enabled=false"]]))
        _, calls = self.run_codex({}, [("譯文", "")])
        self.assertEqual(calls, [[]])

    def test_codex_falls_back_on_config_error(self):
        text, calls = self.run_codex({"lean": True}, [engines.EngineError("Error loading config: unknown field `enabled`"), ("譯文", "")])
        self.assertEqual(text, "譯文")
        self.assertEqual(calls[1], [])
        text, calls = self.run_codex({"lean": True}, [("", '{"type":"error","message":"invalid config override"}'), ("譯文", "")])
        self.assertEqual((text, calls[1]), ("譯文", []))

    def test_codex_other_errors_not_retried(self):
        with self.assertRaises(engines.EngineError):
            self.run_codex({"lean": True}, [engines.EngineError("stream disconnected")])


if __name__ == "__main__":
    unittest.main()
