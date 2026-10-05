# NEXT GENT build handoff

Everything a builder needs, in reading order:

1. `chatgpt-originals/` — the architecture documents the owner chose, word for word.
2. `SPEC.md` — the build spec taken from those documents (each line cites its source).
3. `DECISIONS.md` — every choice the builder made on the owner's behalf; each can be overruled by number.
4. `STATUS.md` — which step is done, proven how, and every repo's head commit.
5. `PLAN-EXACT.md`, `STEP3-CONTRACT.md` — the step plan and the install contract.
6. `review/` — line-by-line reviews of each repo against the spec, plus the scoping reports per step.
7. `proofs/` — the end-to-end proof runs (two real servers over HTTP) with full transcripts; `run.sh` re-runs each.
8. `FOLLOWUPS.md` — loose ends and owner-facing changes to confirm.

Owner rules that bind every builder are in `SPEC.md` §10. Nothing here touches a live database or deploys anything.
