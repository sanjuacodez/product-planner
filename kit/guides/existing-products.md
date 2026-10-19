# Existing-product discovery and roadmap planning

This guide is executable agent guidance for the existing `pp-plan` workflow. Direct repository inspection works today. Automated provider setup, source indexing and freshness enforcement are proposed in [the implementation plan](code-intelligence-plan.md); do not present those as shipped CLI features.

## When to run

Before writing a new PRD, architecture or roadmap, determine whether the repository contains a product already. A new Product Planner installation does not mean a new product. For an existing product, first establish its current capabilities and constraints. On subsequent planning sessions, refresh the baseline from changes rather than repeating the interview or rebuilding the product plan from scratch.

## Procedure and ownership

1. **Orchestrator: establish scope.** Record the repository root, branch, commit if available, dirty-worktree state, target product goals and areas in scope. Ask only missing product/installation questions during planning. Record the agreed provider, memory and browser choices in decisions.md. Preserve user files, existing tasks and approved plans. Discovery itself does not authorize refactoring or migrations.
2. **Architect: map the implementation.** Inspect manifests, entry points, routes, UI screens, modules, data schemas/migrations, auth, integrations, infrastructure and tests. Search with available tools, then read source around each finding. Trace representative flows across modules. Record file paths, symbols and line references where helpful. Use a connected code-intelligence provider when available; otherwise use file search and direct reads. Note unsupported languages, dynamic links and incomplete coverage. Never infer a complete call graph from text matches.
3. **Analyst/PM: map product capabilities.** For each capability distinguish present in code, behavior verified, partial, absent within inspected scope, and unknown. A route or TODO alone does not prove a usable feature. Compare existing behavior with the human's desired outcomes, supplied feedback and agreed research. Record gaps, UX friction and constraints without inventing demand from code structure.
4. **QA: establish evidence.** Inspect the existing test commands before running appropriate checks. Use local test fixtures for browser flows when agreed. Record commands, outcomes, missing prerequisites and checks not run. Distinguish pre-existing failures from new regressions. Do not mark coverage or behavior verified from static inspection alone.
5. **Architect/PM: persist the baseline.** Write `.product-planner/baseline.md` using the template. Include the discovery scope, implementation map, capability/evidence matrix, baseline checks, risks, limitations and desired outcome gaps. Keep secrets, personal data and raw production data out of the report. A provider index is supporting evidence, not the authoritative product specification.
6. **Planner: produce an incremental roadmap.** Prioritize outcomes together with technical prerequisites. Each item names its evidence, affected modules, dependencies, benefit, effort/uncertainty, migration/backward-compatibility needs and acceptance checks. Prefer extending proven existing components. Rebuild work requires a specific justified decision. Separate known product gaps, defects, enabling technical work and hypotheses requiring validation. Include existing technical debt only when it materially affects an outcome or a verified risk.
7. **Orchestrator: reconcile and review once.** Preserve previous approved PRDs/roadmaps with a dated or commit-linked baseline before replacing them. Existing `task add --file` merges new IDs and does not update existing tasks: read tasks.json, allocate unused E#/T# IDs, import only new work, and explicitly reconcile changed existing tasks without resetting completed statuses. Validate tasks and present the baseline, roadmap and limitations together at the final planning review.

## Reuse during build and resume

Before an affected task, read the baseline and current source; retrieve relevant decisions, code and dependencies. Provider output must include source references where available. If files or branches changed, refresh relevant evidence and provider indexes before relying on them; if refresh is unavailable, inspect source directly and record the gap. During build, the coordinator saves verified lessons after QA using the lessons template, updates the baseline where behavior changed and re-indexes enabled document memory. Planning choices cover routine refreshes; do not add per-task approval gates.

When resuming, compare the saved baseline with the current checkout and dirty files. Treat summaries about changed sources as needing review. Do not import lessons from another project without an explicit decision and relevant evidence.

## Dashboard with existing features

Write `.product-planner/dashboard/current-product.json` as a supported `table` section with columns such as Capability, State, Evidence and Gap. Add a `text` section summarizing discovery scope and missing evidence. Existing roadmap rendering shows roadmap.md. The agent maintains these sections manually today; no automated code graph visualization or freshness badge is currently implemented.

## Planning without an installed provider

Continue with repository inspection and documented uncertainty. If enough evidence exists, produce the roadmap. If critical behavior cannot be verified, identify a discovery/validation task before dependent implementation. Never silently call an uninspected feature absent. The user can approve a scoped plan with explicit unknowns at the normal final review.
