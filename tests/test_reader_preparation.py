import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from easyread import pdfwork, reader_files
from easyread.server import Handler
from easyread.store import Workspace, write_json_atomic


class ReaderPreparationTest(unittest.TestCase):
    def test_old_paper_is_not_recalculated_on_open(self):
        self.check_preparation(None, False)

    def test_new_paper_uses_current_layout_rules(self):
        self.check_preparation(pdfwork.LOCATE_VERSION, True)

    def check_preparation(self, version, recalculate):
        with tempfile.TemporaryDirectory() as temp:
            ws = Workspace(Path(temp))
            write_json_atomic(ws.root / "paper.json", {"meta": {"pdf_layout_version": version}, "blocks": []})
            write_json_atomic(ws.root / "reader.json", {"notes": {"n": {"body": "保留筆記"}}})
            before = (ws.root / "reader.json").read_bytes()
            threads = []
            def start(**kwargs):
                threads.append(kwargs["target"])
                return Mock(start=lambda: None)
            with patch.object(reader_files.threading, "Thread", side_effect=start), \
                    patch.object(reader_files.pdfwork, "refresh_layout") as layout, \
                    patch.object(reader_files.figures, "fill") as figures, \
                    patch.object(reader_files.pdfwork, "warm_variants") as warm:
                reader_files.prepare_later(ws)
                reader_files.prepare_later(ws)
                self.assertEqual(len(threads), 1)
                self.assertTrue(reader_files.busy())
                threads[0]()
                self.assertFalse(reader_files.busy())
                self.assertEqual(layout.called, recalculate)
                self.assertEqual(figures.called, recalculate)
                warm.assert_called_once_with(ws.root)
            self.assertEqual((ws.root / "reader.json").read_bytes(), before)


class ShutdownTest(unittest.TestCase):
    def handler(self, active=0, jobs=False):
        h = object.__new__(Handler)
        h.app = types.SimpleNamespace(request_lock=threading.Lock(), shutting_down=False,
                                     active_posts=active, jobs=Mock(busy=lambda: jobs))
        h.server = Mock()
        h._json = Mock()
        return h

    def test_active_writes_jobs_and_preparation_block_install(self):
        for active, jobs, preparing in ((1, False, False), (0, True, False), (0, False, True)):
            h = self.handler(active, jobs)
            with patch.object(reader_files, "busy", return_value=preparing), patch("easyread.server.threading.Thread") as thread:
                h._shutdown()
            self.assertEqual(h._json.call_args.args[0], 409)
            self.assertFalse(h.app.shutting_down)
            thread.assert_not_called()

    def test_idle_shutdown_closes_admission_before_starting_shutdown(self):
        h = self.handler()
        with patch.object(reader_files, "busy", return_value=False), patch("easyread.server.threading.Thread") as thread:
            h._shutdown()
        self.assertTrue(h.app.shutting_down)
        self.assertEqual(h._json.call_args.args[0], 200)
        thread.return_value.start.assert_called_once()

    def test_disconnected_client_does_not_leave_backend_stuck(self):
        h = self.handler()
        h._json.side_effect = BrokenPipeError()
        with patch.object(reader_files, "busy", return_value=False), patch("easyread.server.threading.Thread") as thread:
            with self.assertRaises(BrokenPipeError):
                h._shutdown()
        thread.return_value.start.assert_called_once()
