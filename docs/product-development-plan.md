# Product development plan: agile, complete, verified, cost-effective

Goal: the best way to build a product with AI agents using an agile method. Understand the
idea fully first (asking the developer as often as needed), research where it matters and
recommend a flow, lock the plan with the developer, then build epic by epic and task by task
with tests written alongside the code. No requested feature or task may be lost and quality
may not be compromised anywhere, including the platform and regulatory checks the
product needs. Quality is measured, not assumed. The whole process must cost less than
current open-source alternatives (spec-kit, BMAD-METHOD).

## 1. What "better" means, measurably

| Goal | How it is enforced | How it is measured |
|---|---|---|
| Nothing lost | A traceability chain checked by the CLI (no model tokens): request statement → feature or recorded out-of-scope decision → acceptance criterion → task → test → verification → final audit | Hidden tests on scenarios where requirements are spread across a long specification, revealed only when the agent asks, or changed several times mid-build |
| Quality | Tests written with each task, the full suite green after every task, verification depth by risk, an integration check at the end of each epic, final acceptance audit | Hidden tests, including the original rules after change requests (regressions) |
| Cost | Process depth scaled to the work, small always-loaded instructions, deterministic CLI checks instead of model work, cheaper models for low-risk tasks where the host allows | API cost and time per run, and cost per passing hidden test, against plain Claude Code, spec-kit and BMAD-METHOD |

## 2. Where we are (evidence)

Already built: planning interview with recommended answers, feature register with
readiness checks, optional research, one approval gate, epics and tasks with acceptance
criteria, tests first, per-task verification gate, final acceptance audit, replanning,
dashboard, token tracking and a hidden-test benchmark.

Measured on three precise, small requests (`todo-cli`, `booking-lib`, `scope-change`):
every approach passed 100% of hidden tests. Product Planner cost 54–73% less than
spec-kit, but 3–4× more than plain Claude Code. BMAD-METHOD has not been measured.

The core claim, that agents without this kit lose tasks or skip quality checks, did not
appear on precise, small requests. It is expected on vague, large and frequently changing
work, which the benchmark does not yet cover. This plan has to prove it there, not
assume it.

Session logs show the planner's overhead: 60–90 tool calls against about 20 for plain,
16–19 files written against 4, tests run 4–10 times, a final audit that forced earlier
tasks to be verified again after later tasks edited the same file, 42 audit rows for a
two-paragraph request, and 18 KB of instructions read at the start.

## 3. Target workflow

1. **Discover.** Save the request word for word. Draft the product from it, then ask
   rounds of at most 5 multiple-choice questions, each with a recommended answer. There is
   no fixed round limit: rounds continue until the readiness gate passes. The gate
   requires every request statement to map to a feature or a recorded out-of-scope
   decision, and every MVP feature to have its user, flow, data, edge cases, observable
   acceptance and no open questions. "Use your recommendations" ends the questioning at
   any time and turns what is left into visible assumptions. A precise request may need
   no questions.
2. **Research and recommend.** Only when a decision depends on outside knowledge
   (competitors, libraries, APIs, platform limits, regulations). Output: 2–3 options with
   trade-offs and sources, and one recommendation. The developer confirms the user flow
   and the approach before architecture is written.
3. **Lock.** One review of the concept, features (MVP / later), flows, architecture,
   epics, tasks and risks. `pp check` must pass. Approval records a locked baseline.
   Any later change goes through a change request: impact analysis, at most one round of
   questions, approval. Completed work is never rewritten.
4. **Backlog.** Epics are increments that each deliver a working vertical slice. Every
   task has acceptance criteria, risk, owned paths and named tests. The CLI checks a
   Definition of Ready before a task starts and a Definition of Done before it closes:
   tests written and passing, full suite green, verification recorded.
5. **Build in increments.** Tasks run one by one, or in safe parallel batches where the
   host allows. Each task is test-first, and the full suite runs once after it. At the end
   of each epic: an integration check and an increment summary on the dashboard. No
   questions during the build; blockers are recorded with reasons.
6. **Accept.** The final audit checks the request and the features against evidence.
   Gaps become tasks. The product is marked done only when the audit passes.

## 4. Workstreams

**W1. Remove overhead** (from the session logs).
- The audit accepts each task's verification as recorded when the task was completed;
  the audit and the full suite check the current code.
- Audit rows come from the request and the accepted features, without repeating task criteria.
- `--out` on template commands, so no shell redirection is needed.
- One import command for features and tasks.
- A 2–3 KB core instruction file; the full manual and workflows are read only when that
  path is taken.

**W2. Scope routing.** Direct, quick, standard and existing paths, chosen from the
request and the repository. The direct path, for small precise work, writes
`request.md`, one test per stated rule, the code and one audit. Target: at most 1.5× the
cost of plain prompting at the same pass rate.

**W3. Discovery depth.** The readiness gate described in step 1 replaces the fixed limit
of 3 rounds. Add a request-coverage check to `pp check`, and record the lock as a
snapshot so drift after approval is detected.

**W4. Research to recommendation.** A research brief template (options, trade-offs,
sources, recommendation) and a flow-confirmation step before architecture.

**W5. Agile execution.** Definition of Ready and Done enforced by the CLI, an end-of-epic
integration check and increment summary, increment progress on the dashboard, and the
full suite run recorded with every verification.

**W6. Cost controls.** Model tiering by risk where the host supports it, stable
cache-friendly instruction prefixes, fewer file writes, and a single full-suite run per task.

**W8. Quality profiles: which checks and regulations apply.** Today platform and
compliance requirements are a free-text constraint in the concept, so nothing makes
sure they are found or met. A quality profile makes them explicit, verified and enforced.
- *Detect* from repository signals (a WordPress plugin header, `composer.json`,
  `shopify.app.toml`, `package.json` dependencies, mobile project files) and from
  interview questions that are always asked when relevant: target platform and
  marketplace, where the users are, what personal data is handled (accounts, payments,
  health, children's data), and how it is sold.
- *Map* to gates using a catalog shipped in the kit, one entry per platform or
  regulation. Examples: WordPress plugin (PHPCS with WordPress coding standards,
  PHPStan, Plugin Check; WooCommerce QIT for marketplace extensions; escaping,
  sanitisation, nonces and capability checks). Shopify app (Polaris and App Bridge for
  the admin UI, app review requirements, the mandatory privacy webhooks, Built for
  Shopify criteria where targeted). SaaS web app (OWASP ASVS level chosen by risk,
  WCAG 2.2 AA). Regulations follow where the users and their data are, not where the
  developer is: GDPR (EU/EEA users), UK GDPR, CCPA/CPRA (California residents, above
  its thresholds), India's DPDP Act, plus PCI DSS for card data, HIPAA for US health
  data and COPPA for children under 13 in the US.
- *Verify:* catalog entries are a starting point with a "last verified" date. Platform
  and legal requirements change, so the research step checks each selected entry against
  its official source and records the source links and versions found.
- *Shape the architecture:* the profile is an input to architecture, not a test bolted
  on at the end. architecture.md gets a "Quality and compliance profile" section with one
  design decision per selected gate. Examples: where personal data is stored and in which
  region, what is encrypted, how consent is captured and stored, how export and deletion
  requests reach every data store, retention periods and audit logging (privacy laws);
  prefixes, capability checks, nonces, uninstall clean-up and hooks instead of core
  edits (WordPress); session tokens, HMAC-verified webhooks and the privacy webhooks
  (Shopify). `pp check` fails when a selected gate has no architecture decision.
- *Plan the tasks from it:* the planner turns each gate into tasks: tooling setup in the
  first epic (PHPStan level, PHPCS ruleset, linters), the controls themselves (consent,
  export, deletion, audit log) as features with acceptance criteria and their own tests,
  and a release checklist task for manual items.
- *Fix at code level, every task:* automated gates (static analysis, coding standards,
  dependency and security scans) run with each task's verification. New findings are
  fixed in that task, not deferred; a finding can only be accepted with a recorded reason.
  On existing products the current findings are recorded as a baseline and the rule is
  "no new findings" (a ratchet), so legacy debt does not block work but never grows.
- *Enforce:* each gate becomes a non-functional requirement with acceptance criteria,
  linked to setup tasks (for example PHPStan level and PHPCS configuration in the first
  epic) and to the Definition of Done. Automated gates run with every task's
  verification; manual checklists are filled before release. `pp check` fails when a
  selected gate has no task, and the final audit includes every gate.
- *Confirm:* the profile is shown at the lock review ("these checks and laws apply,
  because…") so the developer can add or remove gates before the build.
- *Limits:* the kit can implement and test technical controls such as consent capture,
  data export and deletion, retention, encryption and access logging. It cannot
  guarantee legal compliance. Legal obligations are listed as "needs legal review"
  items, never marked as passed by a test.

**W9. Dashboard: roles, models, cost and live updates.**

Today the dashboard already shows an "Agents and AI models" table (role, model, tasks,
done, active) and the role and model on each task. Models are recorded with `--model` on
task transitions, which is what the agent reports. It also shows token totals per phase,
task and model, but no cost. The HTML is regenerated by every `pp task`/`pp state`
command, and the page reloads itself every 30 seconds (`dashboard.autoRefreshSeconds`)
while keeping the selected tab, view and scroll position. Gaps: the token hook records
usage without rebuilding the page, so token figures lag until the next task command, and
edits to planning documents appear only with `pp dashboard --watch` running.

- *Role and model as one label:* "Developer · Sonnet 5.5", "QA · Haiku 5.5", built from
  the model identifier the host reports, with friendly names from a small editable table
  and the raw identifier on hover. Planned models stay marked "planned" until work is
  recorded.
- *Actual model check:* the usage hook reads the model from each transcript message.
  The dashboard compares it with the model the agent reported and flags differences, so
  the label reflects what really ran.
- *Cost:* tokens × price per model, split into input, cache writes, cache reads and
  output. Prices live in an editable table in config with a "verified on" date; the
  defaults are checked against the provider's published prices when the table is updated.
  Shown as a total for the product, and by phase (planning, build, QA, replan), epic,
  task, role and model, with cost per completed task. Labelled "estimated at API list
  prices": subscription plans are billed differently, and hosts without a usage hook
  show "not recorded" rather than a guess.
- *Live updates without a cron job:* rebuild the HTML on every event that changes the
  data: CLI mutations (already), each usage hook event (Stop, subagent stop, and `pp`
  commands), and planning-file edits when `--watch` runs. The page keeps reloading every
  30 seconds, or a configured interval, from the local file. A cron job is not needed: it
  would rebuild when nothing has changed and still lag behind real events. No server is
  needed either; the dashboard stays a single local HTML file.

**W7. Proof: benchmark v2.**
- *Simulated product owner:* the request is incomplete, and a hidden fact sheet holds the
  owner's answers. When the agent asks, a small model answers strictly from the fact
  sheet. Hidden tests cover the request and the facts. Any arm may ask, so the comparison
  is fair, and it measures whether asking questions produces the right product.
- *Long specification:* about 40 rules, where agents tend to drop some.
- *Change sequence:* 3–4 change requests, including one that reverses an earlier rule.
- *Existing codebase:* a repository with tests and conventions; the change must not regress them.
- Arms: plain Claude Code, Product Planner, spec-kit, BMAD-METHOD.
- *Platform scenario:* for example "a WooCommerce extension to sell on the WooCommerce
  Marketplace", without listing the checks that platform requires. Tests whether the
  quality profile (W8) finds them unprompted.
- Screening: one plain run per new scenario. A scenario where plain still passes 100%
  cannot show a difference and is dropped.
- Quality is scored on more than behaviour, and each score is reported separately so
  cost is always set against the quality it bought:
  1. *Stated behaviour:* hidden acceptance tests (as today).
  2. *Regressions:* the original rules still pass after every change request.
  3. *Platform and static quality:* the checks a competent developer would run for the
     stated platform (for example PHPStan, PHPCS with WordPress coding standards and
     Plugin Check for a WordPress plugin; ESLint, type checks and `npm audit` for a
     Node app). Run by the harness after the build; never shown to the agent.
  4. *Security:* a scanner pass (for example Semgrep's default rules) and a check for
     committed secrets.
  5. *Blind review:* a rubric score (correctness risks, maintainability, tests,
     documentation) from a reviewer model that does not know which arm wrote the code,
     with a human spot check of a sample.
  6. *Completeness:* request statements and accepted features with no implementation
     or no test, counted from the hidden fact sheet.

## 5. Success criteria

- On scenarios that pass screening, averaged over 3 runs, Product Planner's hidden-test
  pass rate is clearly above plain Claude Code's, and no accepted MVP feature is missing.
- Cost per passing hidden test is lower than spec-kit and BMAD-METHOD on every scenario.
- On small precise requests: 100% pass at no more than 1.5× plain cost.
- After change requests, the hidden tests for the original rules still pass.
- Platform, static-analysis and security scores at least as good as every other arm,
  and better than plain on the platform scenario.
- The real-project trial (M6) finishes with no missing agreed feature and a passing
  audit, and the developer rates the result usable without rework of the core flows.

## 6. Order

1. **M1:** W1, W2 and W9. No paid runs, apart from one check run (about $5).
2. **M2:** W7 scenarios, the BMAD-METHOD arm and screening runs (about $10–15). This
   happens before the feature work, so every later change is measured on scenarios that
   can show a difference.
3. **M3:** W3, W4 and W8, then a re-measure on the screened scenarios and the platform scenario.
4. **M4:** W5 and W6.
5. **M5:** Full comparison: 4 arms × screened scenarios × 3 runs. The maximum spend is
   confirmed with `--dry-run` and approved before it starts.
6. **M6: real-project trial.** The developer builds a new product idea and improves an
   existing product with the kit, outside the benchmark. A scorecard is kept for each
   project: questions asked and whether they mattered, features missed or added late,
   defects found after the build, platform and compliance gates found versus expected,
   rework needed, cost and time. The findings feed the next round of changes.

## 7. Implementation status (2026-10-20)

| Workstream | Status | What exists now |
|---|---|---|
| W1 Overhead | Done | The audit accepts verification recorded when a task was completed (rejected if the task's specification changed), so later tasks editing the same file no longer force re-verification. Audit rows are request statements, MVP feature criteria and gates, without repeated task criteria. `--out` on template commands. `plan import` loads features, epics and tasks in one step and runs the check. The always-loaded instruction block is under 3.5 KB and treats the kit README as reference only. `task complete` replaces review + verify + done. |
| W2 Scope routing | Done | `direct` track and `pp-direct` workflow (request, features with request mapping, tasks, tests, verification, audit; no planning documents). Automatic mode routes small precise build requests to it. |
| W3 Discovery depth | Done | Interview rounds continue until the readiness gate passes (no fixed limit). `request list` numbers request statements; `check` fails on any statement not mapped to a feature or `notFeatures`. `plan approve` records a lock snapshot; `check` warns about drift since approval. |
| W4 Research to recommendation | Done (workflow) | `templates/recommendation.md`; pp-plan step 4 writes options, trade-offs, sources and one recommendation, and confirms the main flow with the user before architecture. |
| W5 Agile execution | Done | Definition of Ready warnings at `task start`; Definition of Done in `task complete` (acceptance, full test suite, task gates, risk checks). End-of-epic `epic review`, required by the audit when there is more than one epic; reviews shown on the dashboard. |
| W6 Cost controls | Partial | Lean instructions, single suite run per task, direct path, fewer CLI round trips. Model tiering stays guidance in the execution guide; hosts control model switching. |
| W7 Benchmark v2 | Built and screened | Scenarios `product-owner` (Haiku answers from facts.md, topic-aware), `long-spec`, `change-sequence`, `existing-codebase` (seeded repository), `woo-extension` (PHPCS, PHP compatibility, PHPStan, security scan); `bmad` arm (BMAD-METHOD 6.12.4); grouped hidden-test scores, quality checks (npm or composer test suites), optional blind review; pipeline tested with a fake CLI before paid runs. Screening (plain, Opus 5.5, one run each): long-spec 40/40, change-sequence 20/20, existing-codebase 18/18, product-owner 16/17, woo-extension 14/14 with every platform check passing. Two harness issues found and fixed during screening (a hidden test that let one missed fact fail six tests; PHPStan not seeing plugin constants); affected runs were rescored with the reason recorded. |
| W8 Quality profiles | Done | Catalog of 12 profiles (web baseline, Node, WordPress, WooCommerce, Shopify, GDPR, UK GDPR, CCPA/CPRA, DPDP, PCI DSS, HIPAA, COPPA) with detection, interview questions, sources and gates. `profile detect/set/verify/gate/run`; `check` requires an architecture decision and a task per non-legal gate; verification requires gate evidence; the audit has gate rows and a legal-review list. Catalog entries are not yet verified by the maintainers (`lastVerified` null): planning must verify them. |
| W9 Dashboard | Done | "Developer · Sonnet 5.5" labels with the model id on hover; transcript-model mismatch flag; estimated cost by product, phase, epic, task, role and model from a dated, editable price table (verified 2026-10-06); dashboard rebuilt on every usage hook event; quality profile section. |

### Findings and next measurements (2026-10-20)

- Screening did not find a scenario where plain Claude Code (Opus 5.5) loses requirements or platform quality in a single session; none of the five new scenarios separates the arms on quality. Per the plan, they stay as regression scenarios rather than proof.
- One planner run on scope-change after the overhead work: $2.66 and 5.6 minutes, against $4.04 and 9.9 minutes before (mean of 3) and $0.98 for plain. Repeat before claiming the saving.
- Next scenarios, chosen to stress what a single session cannot hold: a product built over several sessions with a fresh context each time (resume from files only); a vague one-paragraph idea with a simulated owner; 5+ epics; the same scenarios on cheaper models (Sonnet 5.5, Haiku 5.5) where plain prompting is more likely to drop rules; and a compliance scenario (personal data with export and deletion) scored on the controls.
- The M5 comparison (plain, planner, spec-kit, BMAD × 3 runs) waits for approval of its budget.
