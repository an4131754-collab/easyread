import threading
from unittest.mock import patch
from tests.test_jobs import JobsTest
from easyread.jobs import Jobs
from easyread.store import Workspace, write_json_atomic

class ParallelJobsTest(JobsTest):
    def test_worker_count_clamps_and_defaults(self):
        for value, count in [(1,1),(3,3),(9,4),(0,1),('4',1),(True,1)]:
            with patch('easyread.jobs.config.load', return_value={'paper_concurrency':value}), patch('easyread.jobs.threading.Thread.start') as start:
                Jobs(self.lib)
                self.assertEqual(start.call_count,count+1)

    def test_two_papers_really_overlap_and_cleanup_their_events(self):
        other=Workspace(self.lib.root/'paper0002'); other.root.mkdir()
        write_json_atomic(other.paper_path,{'meta':{},'blocks':[]})
        for ws in (self.ws,other): self.jobs.enqueue(ws,translate_after=False)
        barrier=threading.Barrier(2,timeout=5)
        seen=[]
        def run(ws,job,event):
            seen.append(ws.id); barrier.wait(); self.jobs._write(ws,state='done')
        with patch.object(self.jobs,'_run_bulk',side_effect=run):
            threads=[threading.Thread(target=self.jobs._process_bulk,args=(ws.id,)) for ws in (self.ws,other)]
            for t in threads:t.start()
            for t in threads:t.join(10)
            self.assertFalse(any(t.is_alive() for t in threads))
        self.assertEqual(set(seen),{self.ws.id,other.id})
        self.assertEqual(self.jobs.cancels,{})
        self.assertTrue(all(ws.load('job')['state']=='done' for ws in (self.ws,other)))

    def test_finalizer_does_not_remove_replacement_cancel_event(self):
        replacement=threading.Event()
        self.jobs.enqueue(self.ws,translate_after=False)
        def run(ws,job,event):
            self.jobs.cancels[ws.id]=replacement
        with patch.object(self.jobs,'_run_bulk',side_effect=run): self.jobs._process_bulk(self.ws.id)
        self.assertIs(self.jobs.cancels[self.ws.id],replacement)

    def test_damaged_or_deleted_paper_does_not_block_next_paper(self):
        for damaged in (True,False):
            other=Workspace(self.lib.root/('paper0003' if damaged else 'paper0004')); other.root.mkdir()
            write_json_atomic(other.paper_path,{'meta':{},'blocks':[]})
            self.jobs.enqueue(other,translate_after=False)
            if damaged:(other.root/'job.json').write_text('{broken',encoding='utf-8')
            else:self.lib.trash(other.id)
            self.jobs.enqueue(self.ws,translate_after=False)
            with patch.object(self.jobs,'_run_bulk',side_effect=lambda ws,j,e:self.jobs._write(ws,state='done')) as run:
                self.drain()
                run.assert_called_once()
            self.assertEqual(self.ws.load('job')['state'],'done')
