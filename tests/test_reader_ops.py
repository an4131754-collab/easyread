import tempfile
import unittest
from pathlib import Path

from easyread.store import Workspace


class ReaderOpsTest(unittest.TestCase):
    def test_deletion_wins_over_delayed_creation_in_both_orders(self):
        note = {"op": "note", "note": {"id": "n1", "body": "舊筆記", "updated": "2026-10-01T00:01:00Z"}}
        delete = {"op": "note_del", "id": "n1", "at": "2026-10-01T00:02:00Z"}
        for ops in [[note, delete], [delete, note]]:
            with self.subTest(ops=ops), tempfile.TemporaryDirectory() as d:
                ws = Workspace(Path(d))
                for op in ops:
                    ws.apply_reader_ops([op])
                self.assertTrue(ws.load("reader")["notes"]["n1"]["deleted"])
                # Explicitly restoring with a newer edit is still possible.
                ws.apply_reader_ops([{**note, "note": {**note["note"], "updated": "2026-10-01T00:03:00Z"}}])
                self.assertFalse(ws.load("reader")["notes"]["n1"].get("deleted", False))
