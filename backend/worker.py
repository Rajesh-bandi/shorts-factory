"""Durable background worker pool."""
import threading
import time
import traceback

from . import config, db, pipeline

_wake_event = threading.Event()
_lock = threading.Lock()
_threads = []
_stopping = threading.Event()
_claim_lock = threading.Lock()


def wake():
    _wake_event.set()


def _execute(job):
    kind = job.get("kind") or "analyze"
    try:
        if kind == "manual":
            pipeline.run_manual(job["id"])
        elif kind == "render":
            pipeline.run_render(job["id"])
        else:
            pipeline.run_analyze(job["id"])
    except Exception as e:
        db.log(job["id"], f"Worker crashed: {e}", "error")
        db.update_job(job["id"], status="error", error=str(e))
        traceback.print_exc()


def _loop():
    while not _stopping.is_set():
        _wake_event.clear()
        job = None
        try:
            with _claim_lock:
                job = db.claim_next_job()
            if job:
                _execute(job)
                continue
        except Exception as e:
            print(f"[worker] claim failed: {e}", flush=True)
        _wake_event.wait(timeout=config.WORKER_POLL_SECONDS)


def start():
    global _threads
    with _lock:
        if _threads:
            return
        _stopping.clear()
        requeued = db.requeue_interrupted_jobs()
        if requeued:
            print(f"[worker] requeued {requeued} interrupted job(s)", flush=True)
        for i in range(config.WORKER_CONCURRENCY):
            thread = threading.Thread(target=_loop, name=f"job-worker-{i + 1}", daemon=True)
            thread.start()
            _threads.append(thread)
        print(f"[worker] started {len(_threads)} worker(s)", flush=True)


def stop():
    _stopping.set()
    _wake_event.set()
    with _lock:
        _threads.clear()
