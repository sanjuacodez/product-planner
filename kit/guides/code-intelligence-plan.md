# Code intelligence and persistent memory implementation plan

Status: design and implementation backlog. The current release provides agent instructions for evidence-based discovery, document BM25 retrieval and an optional LanceDB vector backend. It does not yet provision code-intelligence providers, parse code symbols, combine vector/keyword rankings, or enforce index freshness automatically.

## Decision

Use one optional code-intelligence provider for a project, with durable product knowledge in repository files. Start by integrating SocratiCode; evaluate GraphCode as an alternative rather than installing both. Keep the dependency-free inspection path and existing optional LanceDB document memory.

The user selects the setup during planning. No provider, Docker image, embedding model or browser is installed by `init` today. The proposed setup assistant must detect existing resources and describe downloads and local services before the user's choice. Once selected, routine querying/refreshing proceeds within the approved scope.

| Need | Selected approach | Reason |
|---|---|---|
| Product decisions and verified lessons | Git-tracked Markdown/structured records | Auditable, portable and readable without a service |
| Basic retrieval | Current BM25 plus direct source inspection | No dependencies; usable in any shell-capable host |
| Optional semantic retrieval over project docs/lessons | Existing LanceDB backend with local embeddings, then measured improvements | Reuses our implementation; no separate database service required |
| Code search and relationships | SocratiCode as first optional integration | One provider supplies semantic search and graph capabilities |
| Alternative code provider | GraphCode evaluation after the first adapter | CLI and MCP paths; additional runtime/version compatibility must be checked |
| Browser access and testing | Host tools or optional Playwright/Chromium | See browser policy; dashboard uses OS default browser |

Do not duplicate a provider's full source-code index in LanceDB. When SocratiCode handles code retrieval, use it for code and use Product Planner documents for product decisions/lessons; semantic document retrieval is optional. For unindexed or unsupported files, fall back to direct inspection. A future local code indexing option should be justified by measured coverage gaps or host limitations, not built in parallel by default.

## Upstream findings and boundaries

Reviewed 2026-10-19 against upstream READMEs; implementation must recheck supported versions and licenses before pinning dependencies or distributing upstream code.

- [SocratiCode](https://github.com/giancarloerra/SocratiCode): offers hybrid search, dependency graphs and symbol-level analysis. Its default local configuration uses Qdrant, Docker and Ollama/local embeddings, with other configurations available. Index/watch capabilities can support refreshes; the adapter must verify actual project status and coverage. Do not assume every installed host exposes the same tools.
- [GraphCode](https://github.com/ericnerwala/GraphCode): offers code/git/docs graphs, a query CLI and MCP server. Its README requires Node >=22.5. Query/MCP use does not require the API key used by its separate built-in agent. This does not automatically fit our Node >=20 baseline.
- [LanceDB](https://github.com/lancedb/lancedb): open-source embedded storage with JavaScript support and vector/full-text retrieval. Our optional implementation currently performs vector retrieval with BM25 fallback; it does not fuse both rankings. Downloads and local compute still have resource costs.

We adopt integration ideas and documented interfaces. We do not copy upstream implementation or claim upstream benchmark improvements for Product Planner. Each adapter needs versioned contracts and local evaluation.

## Provider boundary

Expose consistent internal operations: availability/capabilities, project/index status, initial indexing, incremental refresh, search, symbol lookup, impact and relevant flow exploration. Only advertise operations that the provider actually exposes. SocratiCode starts through the host's available MCP tools; hosts without those tools use direct inspection. GraphCode's CLI is a later fallback option, not a fabricated SocratiCode CLI.

Normalize output into evidence records: repository, root, branch/commit when available, file, symbol, line span when returned, content hash or freshness marker, retrieval method, provider/version and confidence/limitations. Treat inferred graph edges differently from parsed/resolved links. Agents re-read source before editing. Provider scores are not interchangeable or calibrated confidence probabilities.

## Memory lifecycle

- Store explicit human decisions and verified QA lessons, not every conversation or unverified model summary.
- Lessons link to task, supporting files/tests, verification result and checkout identity. A source hash catches dirty-worktree changes that a commit alone misses.
- Index only intended source/doc files; honor ignore/exclusion rules and exclude secrets, dependency/build trees, database artifacts and generated memory itself. Report skipped files/languages.
- Key cached entries by repository/worktree and source identity. Refresh changed entries, remove deleted ones, handle renames and invalidate affected lessons. A lesson about a modified file is pending revalidation, not automatically false or trusted.
- Preserve durable records in git. Treat generated embeddings and provider databases as rebuildable local caches, with explicit cleanup and update behavior.
- Track embedding model/version/dimension. A model change requires compatible re-embedding, not mixing incompatible vectors.
- Compare BM25 and vector candidate lists, fuse ranks (for example reciprocal-rank fusion), deduplicate source ranges and enforce a bounded context budget. Apply exact symbol/path matches and freshness filters before adding semantic context.
- Keep providers project-scoped and serialise shared state writes through the coordinator. External indexes do not grant authority to change the approved product plan.

## Delivery stages and acceptance

| Stage | Deliverables | Acceptance |
|---|---|---|
| 1: Evidence-based discovery | Agent guide, baseline/lessons templates, PRD/architecture/roadmap evidence requirements, browser policy | Fresh install contains guides; agent can inspect an existing fixture and produce capability matrix, incremental roadmap and explicit limitations without external providers |
| 2: Discovery state and freshness | Validated discovery settings/status, source inventory, hashes, baseline reconciliation and dashboard status | Modified/deleted/renamed files and branch/worktree changes cannot silently reuse stale evidence; missing Git works with file identity; upgrades preserve old projects |
| 3: SocratiCode adapter | Versioned capability mapping, setup guidance/detection, provider index status and normalized results | Supported host indexes/searches/traces an existing fixture; missing Docker/MCP/unsupported files degrade explicitly; no duplicate server/index installation |
| 4: Verified memory and hybrid retrieval | Source-linked lesson records, bounded code/document context, incremental doc indexing and rank fusion | Changed source invalidates relevant cached evidence; keyword-only path works; semantic path retrieves held-out paraphrases; removed files disappear; lessons include verification |
| 5: Roadmap and build integration | Evidence linked to requirements/tasks, changed-area impact context, discovery status/dashboard sections | Existing features are reused; completed tasks retained; new IDs do not collide; QA checks affected journeys; roadmap hypotheses remain labelled |
| 6: Portability and alternatives | Host integration matrix, GraphCode evaluation, documented exclusions and resource measurements | Test macOS/Linux/Windows and supported Node versions; optional providers cannot raise core runtime requirements silently; choose alternatives only on measured need |

Stage 1 guidance/templates are delivered by this documentation update; repeatable agent-level fixture evaluation and automated portions remain acceptance work. There are no new `pp discover` or `pp context` commands in this release. Later command names and config schemas must be finalized with implementation, documented and tested before use.

## Evaluation before enabling recommendations by default

Use held-out tasks from small and larger existing repositories. Compare direct inspection, document memory and one code provider on feature discovery accuracy, missed dependencies, regressions, stale-result detection, evidence citation quality, retrieval time and context size. Include dynamic dispatch, partial features, misleading TODOs, failing baseline tests and unsupported languages. Measure first-run setup/storage and warm refresh costs. Establish thresholds from the baseline and report both gains and regressions. Better product-roadmap choices still require user goals and feedback; source structure cannot prove demand.
