"""Validate correlated API and durable-worker records from a files-only research run."""
import json
import sys

allowed = {"trace_id", "job_id", "attempt", "duration_ms", "method", "route", "status", "operation"}
jobs = {}

for line in sys.stdin:
    if not line.startswith("{"):
        continue
    record = json.loads(line)
    if "trace_id" not in record:
        continue
    if record.keys() - allowed or not isinstance(record.get("duration_ms"), int):
        raise SystemExit("Unexpected trace fields")
    job_id = record.get("job_id")
    if job_id:
        if record["trace_id"] != job_id:
            raise SystemExit("Trace does not match the durable job")
        jobs.setdefault(job_id, []).append(record)

for records in jobs.values():
    request = any(r["operation"] == "http.request" and r["method"] == "POST" and r["status"] in (200, 202) for r in records)
    stages = {r["operation"] for r in records}
    finished = any(r["operation"] == "research.attempt" and r["status"] == "completed" and r["attempt"] >= 1 for r in records)
    if request and finished and "research.activity" in stages:
        print("OK correlated request, worker attempt and research activities with allowed trace fields")
        break
else:
    raise SystemExit("No complete request-to-worker trace")
