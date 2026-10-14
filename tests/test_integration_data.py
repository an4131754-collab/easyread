import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from easyread import api_keys, backups, chat_models, config, settings_api
from easyread.library import Library
from easyread.store import DataReadError, Workspace, write_json_atomic


class IntegrationDataTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.lib = Library(Path(self.tmp.name))
        self.ws = Workspace(self.lib.root / 'paper0001')
        self.ws.root.mkdir()
        write_json_atomic(self.ws.paper_path, {'meta': {}, 'blocks': []})
        write_json_atomic(self.ws.reader_path, {'notes': {'n': {'lang': 'en', 'unmarked': True, 'body': '保留筆記'}}})

    def test_endpoint_keys_do_not_cross_custom_hosts_and_legacy_migrates(self):
        o = {'preset': '', 'base_url': 'https://a.test/v1/', 'api_key': 'secret-a', 'keys': {'': 'secret-a'}}
        self.assertEqual(api_keys.resolve(o, '', 'https://a.test/v1'), 'secret-a')
        self.assertEqual(api_keys.resolve(o, '', 'https://b.test/v1'), '')
        cfg = {'openai': o, 'chat': {'models': [{'id': 'b', 'engine': 'openai', 'base_url': 'https://b.test/v1', 'model': 'fake'}]}}
        self.assertEqual(chat_models.engine_cfg(cfg, 'b')[0]['openai']['api_key'], '')
        with patch('easyread.config.load', return_value={'openai': o}):
            saved = config.with_key({'base_url': 'https://b.test/v1', 'api_key': 'secret-b'})
        self.assertEqual(saved['keys']['url:https://a.test/v1'], 'secret-a')
        self.assertEqual(saved['api_key'], 'secret-b')
        public = config.public({'openai': saved})
        self.assertNotIn('secret-a', json.dumps(public))
        self.assertNotIn('secret-b', json.dumps(public))

    def test_corrupt_paper_is_isolated_and_not_overwritten(self):
        broken = Workspace(self.lib.root / 'paper0002')
        broken.root.mkdir()
        broken.paper_path.write_bytes(b'\xffbroken')
        self.assertEqual(len(self.lib.list()), 2)
        self.assertTrue(next(i for i in self.lib.list() if i['id'] == broken.id)['load_error'])
        self.ws.reader_path.write_text('{broken', encoding='utf-8')
        with self.assertRaises(DataReadError):
            self.ws.apply_reader_ops([{'op': 'paper_note', 'body': 'must not overwrite'}])
        self.assertEqual(self.ws.reader_path.read_text(), '{broken')

    def test_full_backup_restore_preserves_notes_chat_images_and_pre_restore_copy(self):
        (self.ws.root / 'figures').mkdir()
        (self.ws.root / 'figures' / 'a.webp').write_bytes(b'original image')
        write_json_atomic(self.ws.root / 'chat.json', {'threads': [{'refs': [{'source': 'assistant', 'quote': 'keep'}]}]})
        name = backups.create(self.ws)
        self.ws.reader_path.write_text('{damaged', encoding='utf-8')
        (self.ws.root / 'figures' / 'a.webp').write_bytes(b'changed')
        result = backups.restore(self.ws, name)
        self.assertTrue(result['ok'])
        self.assertTrue(self.ws.load('reader')['notes']['n']['unmarked'])
        self.assertEqual((self.ws.root / 'figures' / 'a.webp').read_bytes(), b'original image')
        self.assertEqual(self.ws.load('chat')['threads'][0]['refs'][0]['quote'], 'keep')
        before = self.lib.root / '.backups' / self.ws.id / result['before']
        self.assertEqual((before / 'reader.json').read_text(), '{damaged')
        with self.assertRaises(ValueError):
            backups.restore(self.ws, '../../other')

    def test_invalid_paper_concurrency_rejected_without_saving(self):
        with patch('easyread.config.save') as save:
            for value in [0, 5, '2', True]:
                with self.assertRaises(ValueError):
                    settings_api.save_config({'paper_concurrency': value})
            save.assert_not_called()
