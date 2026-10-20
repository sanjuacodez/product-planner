# Cost, context and delivery improvement plan

The goal is lower execution cost and shorter delivery time while preserving the agreed
product concept, original request, acceptance criteria and verification evidence.
The initial single-run benchmarks achieved equal hidden-test pass rates but cost more
than plain prompting. They are a baseline, not evidence that these improvements save money.

All six items are implemented in the CLI and the kit workflows. The first repeated
measurement (below) shows no cost saving against plain prompting yet.

1. **Complete task briefs — implemented.** `task context` includes the concept, complete
   matching requirement sections, architecture and global constraints, decisions,
   dependency acceptance/evidence, relevant lessons, evidence freshness and requested-model
   preferences. IDs match exactly; table headers and multiline rules are preserved; missing
   concept or requirements produce a warning in the brief. Exact original wording and
   current source still require inspection.
2. **Scale planning to scope — implemented.** `plan profile` reports the depth
   (`options.planningDepth`, or `quick` from the quick track). Quick plans write one
   `plan.md` (`templates/quick-plan.md`) with Requirements, UX, Architecture, Risks and
   Roadmap sections; briefs, `check` and the dashboard read those sections. Request
   capture, concept, feature register, traceability and the final audit apply on every
   track. `pp-plan`, `pp-replan` and the planner persona describe the quick path.
3. **Focused task execution — implemented as a proposal.** Tasks declare `writes` and
   `sources` (validated concrete repository-relative paths). `task batch --json` selects
   ready tasks whose paths do not overlap each other or active work (symlink aliases and
   directory containment included), up to `options.maxConcurrentTasks` (default 2); tasks
   without `writes` run alone. It starts nothing. Launching workers and choosing models
   remain host capabilities; there is no state locking, so one coordinator writes state.
4. **Fresh context retrieval — implemented.** `task capture` fingerprints planning
   documents and declared paths by content, with the git revision; `task freshness` and
   the brief list changed or deleted files and task-specification changes. The memory
   index stores per-file fingerprints and search excludes changed or deleted files until
   re-indexed, with a warning. Freshness covers declared paths only.
5. **Risk-based verification — implemented.** `task policy` derives checks from `risk`
   (escalated to high after three QA returns). `task verify --template` prints a report
   skeleton; `task verify --file` requires passing evidence for every exact criterion,
   an independent reviewer from medium risk, and integration plus security/data review
   for high risk. With `options.requireVerification` (default for new projects; existing
   state files keep the old behaviour unless set) `task done` refuses missing or stale
   evidence. `audit template|check|status` gates `state phase done` on every request
   paragraph, accepted MVP feature criterion and task criterion, plus integration
   evidence; later changes make the audit stale.
6. **Measure delivered behavior against cost — implemented and run once.** Usage records
   keep mixed models per message, `usage bind` attributes subagent transcripts to tasks,
   attribution is session-local and split integer-exactly across concurrent tasks, and
   `usage --json` separates estimated from recorded attribution. The benchmark adds the
   `scope-change` scenario (scripted mid-build change, 8 hidden tests; the reference
   implementation passes them), `--repeat` (≤10) and `--dry-run` (prints the maximum
   spend). The report groups by kit digest and shows finished runs and min–max ranges.

## Verification

30 automated tests pass (`npm test`); CLI syntax (`npm run check`) and diff whitespace
checks pass. Coverage includes quick-plan sections, batching conflicts and symlink aliases,
content-based freshness, stale-memory exclusion, the verification and audit gates (also
through the documented CLI commands end to end), the shipped task-plan template, and usage
attribution across models and subagents.

## Results: scope-change, 3 runs per arm (kit 325d2f103fca, Opus, $8 cap per run)

| Arm | Hidden tests | Cost | Minutes | Tokens |
|---|---|---|---|---|
| plain | 8/8 in 3/3 runs | $0.98 ($0.89–$1.07) | 2.6 (2.2–3.1) | 337k |
| planner | 8/8 in 3/3 runs | $4.04 ($2.82–$5.69) | 9.9 (6.1–15.3) | 2.67M |

Total spend $15.06 for the six valid runs, plus an abandoned planner attempt ($1.62 recorded
for its first message, plus an unknown amount for the second; the Mac slept mid-request,
so it was discarded and rerun with `caffeinate`).
Every planner run chose the quick track (one plan.md), recorded task verification and the
final audit, and kept the original rules through the change. Quality was equal; the
planner cost about 4× more and took about 4× longer.

Where planner tokens went (its own usage records): 91–95% were cache reads. Each message
used 16–44 agent turns versus 7–17 for plain, and every turn re-reads a larger context
(instructions, kit manual, workflows, briefs). QA and the post-change cycle (replan,
re-verification, new audit) were the largest stages in the costliest run (1.9M QA tokens).
Task attribution was mostly estimated because workers were not bound.

Next cost work, in order of expected effect: a lighter path for small precise requests
(skip workflow/kit reads, direct implement + tests + audit), shorter always-loaded
instructions, cheaper verification for low-risk tasks, and replan without a full re-audit
when the change is additive. Then measure vague and larger scenarios, where planning
should help quality.

## Not yet done

- Ambiguous-request and larger benchmark scenarios; `booking-lib` repeats on the current kit.
- Host integration: no automatic worker launcher, per-task model switching or locking.
