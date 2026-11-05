LEDGERLY AUDIT EVIDENCE BUNDLE
==============================

This bundle holds audit events of one company, with the hash chain that links them and the seals that anchor the
chain, so a third party can check that none of them was edited, removed or reordered after the fact, without access to
Ledgerly. manifest.json says who exported what, when, and which filters were used.

FILES
-----
manifest.json   Export details, the id range, the chain head at export time, and the SHA-256 digest of the other files.
events.jsonl    One JSON object per line, in id order, for every event id from first_id to last_id of the range.
                  "included": true   the full event: id, tenant_id, company_id, actor_type, actor_id, action,
                                     subject_type, subject_id, before, after, context, ip, user_agent, request_id,
                                     occurred_at, canonical, prev_hash, hash.
                  "included": false  an event that did not match the filters (another company of the same organisation,
                                     or filtered out). Only id, prev_hash and hash are given: they keep the chain
                                     checkable without revealing the event.
seals.json      The nightly seals that fall inside the range: sealed_through_id, tip_hash, sealed_at.
verify.py       A checker for the steps below (Python 3.8+, standard library only).
README.txt      This file.

HOW THE CHAIN IS BUILT
----------------------
Each event has a "canonical" text: its fields as one JSON document in the canonical form of RFC 8785 (JCS). The text is
stored exactly as it was hashed. The event's hash is

    hash = SHA-256( prev_hash || canonical )     (lower-case hex; "||" is plain concatenation of the two strings;
                                                  prev_hash is the empty string for the very first event of the chain)

where prev_hash is the hash of the previous event of the organisation's chain, so changing, removing or reordering any
event changes every hash after it.

HOW TO VERIFY (repeat these steps; verify.py does them)
--------------------------------------------------------
1. Hash. For every event with "included": true, compute SHA-256 over the UTF-8 bytes of  prev_hash + canonical  (do not
   re-serialize the canonical text: hash it as it is) and compare with "hash".
2. Columns. Parse the canonical text as JSON. Its fields must equal the event's own fields: tenant_id, company_id,
   actor_type, actor_id, action, subject_type, subject_id, user_agent, request_id, prev_hash, ip, occurred_at as text, and
   before, after and context as JSON values. A mismatch means a field was edited without touching the canonical text.
3. Links. Go through events.jsonl in order. Each entry's prev_hash must equal the previous entry's hash. A gap or a
   reordering breaks this.
4. Seals. For each seal in seals.json, the entry with id = sealed_through_id must have hash = tip_hash.
5. Head. If manifest.json says "includes_chain_head": true, the last entry must be chain_head (last_id, last_hash).
6. Files. SHA-256 of events.jsonl, seals.json, README.txt and verify.py must equal the digests in manifest.json.

Run:   python3 verify.py <this folder or the .zip>        Exit status 0 means every step passed.

WHAT A PASS PROVES, AND WHAT IT DOES NOT
----------------------------------------
- A pass proves the events in this bundle are internally consistent: each event's content matches its hash, and the
  events form one unbroken chain, so no event inside the range was edited, removed or reordered.
- It proves nothing about events outside the range, and it does not prove that the chain is the one Ledgerly holds.
  Someone who controls the whole bundle could recompute every hash. What stops that is anchoring: compare the hashes in
  seals.json (and chain_head) with a copy you obtained another way, for example one you were sent earlier or one read
  directly from the system by a person you trust. The nightly seals exist for this purpose. External timestamping of
  the seals (RFC 3161) is not yet available.
- The ip address and user agent are recorded as received; Ledgerly does not vouch that they are genuine.
