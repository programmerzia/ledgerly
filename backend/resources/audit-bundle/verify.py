#!/usr/bin/env python3
"""Verifies a Ledgerly audit evidence bundle. Python 3.8+, standard library only.

    python3 verify.py <bundle.zip | folder with the unzipped files>

Exit status 0: every check passed. 1: a check failed (the first problems are printed).
README.txt explains what each check proves and what it does not.
"""
import hashlib
import ipaddress
import json
import os
import sys
import zipfile

SCALARS = ["tenant_id", "company_id", "actor_type", "actor_id", "action", "subject_type", "subject_id",
           "user_agent", "request_id", "prev_hash"]
DOCUMENTS = ["before", "after", "context"]
NAMES = ["manifest.json", "events.jsonl", "seals.json"]


def read_all(path):
    if os.path.isdir(path):
        return {n: open(os.path.join(path, n), "rb").read() for n in NAMES + ["README.txt", "verify.py"] if os.path.exists(os.path.join(path, n))}
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in z.namelist()}


def same_ip(a, b):
    if a is None or b is None:
        return a is b
    try:
        return ipaddress.ip_address(a) == ipaddress.ip_address(b)
    except ValueError:
        return a == b


def column_problem(e):
    """The first column that differs from the canonical record, or None (step 2 of README.txt)."""
    try:
        c = json.loads(e["canonical"])
    except ValueError:
        return "canonical"
    if not isinstance(c, dict):
        return "canonical"
    for f in SCALARS:
        if c.get(f) != e.get(f):
            return f
    if not same_ip(c.get("ip"), e.get("ip")):
        return "ip"
    if c.get("occurred_at") != e.get("occurred_at"):
        return "occurred_at"
    for f in DOCUMENTS:
        if c.get(f) != e.get(f):
            return f
    return None


def main(path):
    files = read_all(path)
    problems = []
    for n in NAMES:
        if n not in files:
            print("FAIL: %s is missing" % n)
            return 1
    manifest = json.loads(files["manifest.json"])
    for name, digest in manifest.get("files", {}).items():
        if name in files and hashlib.sha256(files[name]).hexdigest() != digest:
            problems.append("%s differs from the digest in manifest.json" % name)

    entries = [json.loads(line) for line in files["events.jsonl"].decode("utf-8").splitlines() if line.strip()]
    seals = json.loads(files["seals.json"])
    by_id = {}
    previous = None
    full = 0
    for e in entries:
        eid = e["id"]
        by_id[eid] = e
        if previous is not None and e["prev_hash"] != previous["hash"]:
            problems.append("event %s: prev_hash does not match the hash of event %s (an event was removed, added or reordered)" % (eid, previous["id"]))
        if previous is not None and eid <= previous["id"]:
            problems.append("event %s: ids are not increasing" % eid)
        if e.get("included"):
            full += 1
            digest = hashlib.sha256(((e["prev_hash"] or "") + e["canonical"]).encode("utf-8")).hexdigest()
            if digest != e["hash"]:
                problems.append("event %s: hash does not match sha256(prev_hash + canonical)" % eid)
            col = column_problem(e)
            if col is not None:
                problems.append("event %s: column %s differs from the canonical record" % (eid, col))
        previous = e

    for s in seals:
        sealed = by_id.get(s["sealed_through_id"])
        if sealed is None:
            problems.append("seal through %s: that event is not in the bundle" % s["sealed_through_id"])
        elif sealed["hash"] != s["tip_hash"]:
            problems.append("seal through %s: the event hash differs from the sealed tip" % s["sealed_through_id"])

    head = manifest.get("chain_head")
    if head and manifest.get("includes_chain_head") and entries:
        if entries[-1]["id"] != head["last_id"] or entries[-1]["hash"] != head["last_hash"]:
            problems.append("the last event is not the chain head recorded in manifest.json")

    print("entries: %d (%d with full content, %d link-only), seals checked: %d" % (len(entries), full, len(entries) - full, len(seals)))
    if problems:
        for p in problems[:50]:
            print("FAIL: " + p)
        return 1
    print("OK: every check passed")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
