---
name: pp-direct
description: Build a small, precisely specified request directly - request captured, scope mapped, tests with the code, verified tasks and a final audit, without the planning documents. Use when the request states exact behaviour, fits about 5 tasks and the user authorized building.
---

# Direct build

For small, precise work. Everything that protects scope and quality stays: the request word for word, every request statement mapped, tests written with the code, recorded verification and the final audit. Planning documents, research and the interview are skipped. Use pp-plan instead when product decisions are open, the work needs more than about 5 tasks, an existing product is affected broadly, or a platform or regulation applies (a marketplace plugin, personal data, payments).

1. **Capture.** `product-planner state set options.track direct`. Save the user's message verbatim to `.product-planner/request.md`. `product-planner request list` shows its statements as R1, R2, …. If the request is for a platform or marketplace (WordPress, WooCommerce, Shopify, app stores) or handles personal data, payments, health or children's data, stop and use pp-plan: those need a quality profile, architecture decisions and gates (`product-planner check` enforces this). If a decision only the user can make is missing, ask it now in one short multiple-choice round (with a recommended answer); otherwise ask nothing.
2. **Plan in one file.** Write `.product-planner/plan.json` and import it with `product-planner plan import --file .product-planner/plan.json`:
   - `features`: one per capability (`status: accepted`, `priority: must`, `release: MVP`), with `requests` listing the R ids it delivers and `acceptance` copying every rule, name, number and error code exactly.
   - `notFeatures`: request statements that are delivery instructions or excluded scope, each with a reason (for example "build, test and document" → covered by every task).
   - `epics` (one is enough) and 1–5 `tasks`, each with `features`, `risk` (low unless it touches data deletion, security or money), `writes` (paths it changes) and acceptance criteria.
   The import runs the plan check; fix every error. Then `product-planner state product --name "…" --summary "…"` and `product-planner plan approve --reason "request authorized building"`.
3. **Build each task** in order (`product-planner task next`). `task start` prints the task's recommended model; if it differs from your session's model, hand the task to the sub-agent with that model as described next. If `product-planner models show` reports delegated tasks, you always coordinate and do not implement: after `task start`, hand the `task context T#` brief, owned paths and acceptance to the pp-developer sub-agent (tests with the code, full suite, returns changed paths and results), then the brief, changed paths and report template path to the pp-qa sub-agent (runs the suite, fills the report); review the evidence and run `task complete`. `risk: high` tasks stay with you. Otherwise do it yourself:
   - `product-planner task start T# --agent developer --model <model-id>`.
   - Write the tests first, one or more per acceptance criterion and named after it, using the exact values; see them fail; implement until they pass. Then run the full test suite once.
   - `product-planner task verify T# --template --out .product-planner/verification/T#.report.json`, fill every row with the test or command that proves it and the suite result, then `product-planner task complete T# --file .product-planner/verification/T#.report.json --agent qa --model <model-id>`.
   - When the CLI reports an epic complete and there is more than one epic, run the integration checks and `product-planner epic review E# --evidence "…"`.
4. **Accept.** Run the full suite. `product-planner audit template --out .product-planner/audit-report.json`; fill each R# and feature row with its evidence and `integration` with the suite command and result; `product-planner audit check --file .product-planner/audit-report.json`. A row that cannot pass becomes a task (`task add`), then repeat step 3. Finish with `product-planner state phase done` and report what was built, how it was verified and any limitations.

Do not create concept.md, prd.md, plan.md or research files on this path. If the work turns out larger or less precise than expected, stop and continue with pp-plan from its interview, keeping what is already recorded.
