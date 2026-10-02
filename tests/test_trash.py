import tempfile
import unittest
from pathlib import Path

from easyread import trash


class TrashTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        for name in ("aaaaaaaaaaaa-20261001120000", "bbbbbbbbbbbb-20261001130000"):
            (self.root / ".trash" / name).mkdir(parents=True)

    def test_list_newest_first(self):
        self.assertEqual([t["id"] for t in trash.items(self.root)], ["bbbbbbbbbbbb", "aaaaaaaaaaaa"])

    def test_restore_and_conflict(self):
        self.assertEqual(trash.restore(self.root, "aaaaaaaaaaaa-20261001120000"), "aaaaaaaaaaaa")
        self.assertTrue((self.root / "aaaaaaaaaaaa").is_dir())
        (self.root / "bbbbbbbbbbbb").mkdir()  # 後來又匯入過同一篇
        with self.assertRaises(ValueError):
            trash.restore(self.root, "bbbbbbbbbbbb-20261001130000")

    def test_purge_needs_a_valid_name(self):
        for bad in ("", "../x", "aaaaaaaaaaaa"):
            with self.assertRaises(ValueError):
                trash.purge(self.root, bad)
        self.assertEqual(len(trash.items(self.root)), 2)  # 名字不對時什麼都沒刪
        trash.purge(self.root, "aaaaaaaaaaaa-20261001120000")
        self.assertEqual(trash.empty(self.root), 1)
        self.assertEqual(trash.items(self.root), [])


if __name__ == "__main__":
    unittest.main()
