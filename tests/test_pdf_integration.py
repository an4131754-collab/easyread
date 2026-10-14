import json
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from easyread import backups, figure_geometry_v2, pdfwork
from easyread.library import Library
from easyread.server import Handler
from easyread.store import write_json_atomic
from tests.test_figure_geometry import make_pdf, loc

class PDFIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.lib=Library(Path(self.tmp.name)/'library')
        p=Path(self.tmp.name)/'sample.pdf'
        make_pdf(p,images=[[.12,.3,.85,.65]],words=[('Figure 1: A complete illustration.',.1,.7)])
        self.ws,_=self.lib.create_from_pdf(p.read_bytes(),'sample.pdf')

    def test_v2_geometry_really_reads_pdf_and_returns_separate_crop(self):
        result=figure_geometry_v2.locate_figures(self.ws.root,[{'id':'fig','type':'figure','page':1}],{'fig':loc([.1,.68,.9,.74])})
        self.assertIn('fig',result)
        self.assertLess(result['fig']['crop'][1],.31)
        self.assertGreater(result['fig']['crop'][3],.64)
        self.assertGreater(result['fig']['box'][3],result['fig']['crop'][3])

    def test_repeat_import_does_not_opt_old_paper_in(self):
        self.ws.update('paper',lambda p:p['meta'].pop('pdf_layout_policy'))
        before=self.ws.paper_path.read_bytes()
        ws,fresh=self.lib.create_from_pdf((self.ws.root/'source.pdf').read_bytes(),'again.pdf')
        self.assertFalse(fresh);self.assertEqual(ws.paper_path.read_bytes(),before)

    def handler(self,action,body):
        h=object.__new__(Handler);h.path=f'/api/p/{self.ws.id}/{action}'
        h.app=types.SimpleNamespace(lib=self.lib,request_lock=threading.Lock(),active_posts=1,jobs=Mock(busy=lambda:False))
        h._body=Mock(return_value=json.dumps(body).encode());h._json=Mock()
        return h

    def test_http_maintenance_routes_and_failed_refresh_roll_back_all_data(self):
        write_json_atomic(self.ws.reader_path,{'notes':{'n':{'body':'keep','unmarked':True}}})
        h=self.handler('backup',{})
        with patch('easyread.server.reader_files.busy',return_value=False):h._post()
        name=h._json.call_args.args[1]['backup']
        self.ws.update('reader',lambda r:r['notes']['n'].update(body='changed'))
        h=self.handler('restore-backup',{'name':name})
        with patch('easyread.server.reader_files.busy',return_value=False):h._post()
        self.assertEqual(self.ws.load('reader')['notes']['n']['body'],'keep')
        before=self.ws.paper_path.read_bytes()
        def fail(ws):
            ws.update('paper',lambda p:p['meta'].update(pdf_layout_policy='bad'))
            raise RuntimeError('synthetic PDF failure')
        h=self.handler('refresh-pdf',{})
        with patch('easyread.server.reader_files.busy',return_value=False),patch('easyread.server.reader_files.refresh_now',side_effect=fail):
            with self.assertRaisesRegex(ValueError,'已從更新前完整備份還原'):h._post()
        self.assertEqual(self.ws.paper_path.read_bytes(),before)
        self.assertTrue(self.ws.load('reader')['notes']['n']['unmarked'])

    def test_busy_maintenance_does_not_make_or_restore_backup(self):
        h=self.handler('backup',{})
        h.app.jobs.busy=Mock(return_value=True)
        with patch('easyread.backups.create') as create:
            with self.assertRaisesRegex(ValueError,'正在翻譯'):h._post()
            create.assert_not_called()


    def test_actual_pdf_cross_page_paragraph_regions(self):
        from pypdf import PdfWriter
        a=Path(self.tmp.name)/'first.pdf';b=Path(self.tmp.name)/'second.pdf'
        head='This paragraph begins near the bottom of the first page.'
        tail='It continues near the top of the second page with further explanation.'
        make_pdf(a,words=[(head,.08,.85)]);make_pdf(b,words=[(tail,.08,.1)])
        writer=PdfWriter();writer.append(a);writer.append(b);writer.write(self.ws.root/'source.pdf')
        self.ws.update('paper',lambda p:p.update(blocks=[{'id':'cross','type':'para','en':head+' '+tail,'zh':'keep translation','page':1}]))
        pdfwork.prepare(self.ws.root)
        layout=pdfwork.locate(self.ws.root)
        self.assertEqual([r['page'] for r in layout['cross']['regions']],[1,2])
        self.assertEqual(self.ws.load('paper')['blocks'][0]['zh'],'keep translation')
