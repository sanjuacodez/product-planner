# Product Planner

A private, dependency-free Node.js kit for taking a software idea through an interview, competitor research, PRD, UX/UI direction, architecture, task planning and implementation. It installs Markdown personas and workflows into your AI coding tool. The tool's agent performs the work; the CLI tracks state, tasks, research, memory and a self-contained HTML dashboard.

All requirements gathering happens during planning. You review the complete plan once, then the agent implements tasks with QA, continuing through available work when another task is blocked. Host permission prompts and session limits still apply; `pp-resume` recovers persisted context.

## Why use Product Planner?

- **Plan the whole product before coding.** Capture the problem, audience, competitor strengths and weaknesses, requirements, UX/UI direction, architecture and delivery tasks in one process.
- **Reduce repeated decisions during development.** Resolve scope and preferences up front, review the complete plan once, then let the agent execute available tasks with QA.
- **Keep your choice of coding tool.** Use dedicated adapters for supported tools and the same file-based workflow in any editor that can read the instructions and run shell commands.
- **Give specialists clear responsibilities.** Each role receives concrete inputs, owned outputs and acceptance criteria; the host can delegate or run the roles sequentially.
- **See progress outside the editor.** Open an offline HTML dashboard with charts, task status, roadmap, risks, research and custom data sections.
- **Resume across sessions and tools.** Project documents and task state stay in the repository, so a new session can recover what was decided and what remains.
- **Start without extra services.** The core CLI has no npm dependencies, API keys or hosted backend. Your chosen AI tool may have its own costs; optional memory downloads are separate.

## Requirements

- Node.js **20 or newer** and npm.
- Git, plus access to this private repository to clone it.
- An AI coding tool that can read local files, edit the project and run shell commands.
- Internet access when doing live research or downloading optional tools/models.

## Install from GitHub

This repository is private. Sign in to a GitHub account with repository access first. GitHub CLI users can run:

```sh
gh auth login
gh repo clone sanjuacodez/product-planner
cd product-planner
npm link
product-planner --version
```

Alternatively, clone using your configured Git credentials:

```sh
git clone https://github.com/sanjuacodez/product-planner.git
cd product-planner
npm link
```

No `npm install` is required for the core CLI because it has no dependencies. `npm link` makes `product-planner` and `pp` available globally from this checkout; keep the checkout in place while using the link.

## Initialize your product project

Run initialization in the repository for the product you want to build:

```sh
cd /path/to/your-product
# For a new project, create its directory and run git init first.
product-planner init --tools claude,codex

# Or choose tools interactively:
# product-planner init

# Other examples:
# product-planner init --tools gemini
# product-planner init --tools opencode,cursor,windsurf
# product-planner init --tools generic
# product-planner init --tools all --yes
```

For installation without a global link, run `npm pack` here, then `npm install --global /absolute/path/product-planner-0.1.0.tgz`. The package is marked `private: true` and cannot be published to npm accidentally. No public registry installation is assumed.

`pp` is a shorter alias. `init` prompts for tools on an interactive terminal; `--yes` uses detected tools plus the universal adapter. `--tools all` installs every adapter. Installation preserves existing AGENTS.md/CLAUDE.md/GEMINI.md content outside its marked block. Re-running init refreshes bundled kit/adapter files while preserving planning data. Edit project decisions/docs outside `.product-planner/kit`; that installed kit is overwritten on update.

## First project walkthrough

1. Initialize your product repository with the adapter for your coding tool.
2. Open that repository in the tool and run `pp-plan` with your idea.
3. Answer the planning questions, including research access, design preferences and optional marketing.
4. Review the complete product plan and approve it when ready.
5. Let the agent build the dependency-ordered tasks and verify them with QA. Open `product-dashboard.html` to follow progress.
6. If a session ends, run `pp-resume` in a new session to continue from the saved files.

Example starting prompt:

> Run pp-plan for a booking app for independent tutors. Tutors should manage availability, students should book sessions, and both should see upcoming appointments. Research competing products, suggest a simple UI and use free/open-source tools where practical.

## Start with your AI coding tool

Open the initialized product repository and invoke `pp-plan` with your idea. Examples:

- Claude Code: `/pp-plan Build an appointment booking app`.
- Codex: invoke the installed `pp-plan` skill, or say “run pp-plan for an appointment booking app”.
- Gemini CLI: `/pp:plan Build an appointment booking app`.
- OpenCode, Cursor and Windsurf: `/pp-plan`, or say “run pp-plan”.
- Monocode, T3 Code and other editors: ask the agent to read `AGENTS.md` and “run pp-plan”. If the editor does not load AGENTS.md, explicitly point it to `.product-planner/kit/README.md` and `.product-planner/kit/workflows/pp-plan.md`.

The planning workflow gathers concept, audience, business goals, constraints, MVP boundaries, design preferences, research inputs/access, optional marketing, memory, git choices and dashboard preferences. It generates the plan and dashboard for one final review. After approval it opens the dashboard by default and continues the build. You can ask to stop after planning or disable auto-open.

| Workflow | Purpose |
|---|---|
| `pp-plan` | Interview, research, requirements, UX, architecture and task plan |
| `pp-build` | Implement approved tasks with QA until done or all remaining work is blocked |
| `pp-resume` | Recover context and continue after an interrupted session |
| `pp-status` | Inspect progress; open the dashboard when requested |
| `pp-ask` | Answer questions or add requested dashboard information |

## Tool adapters and delegation

| Tool | Installed integration |
|---|---|
| Claude Code | `.claude/agents/pp-*.md`, `.claude/commands/pp-*.md`, CLAUDE.md block |
| Codex | `.agents/skills/pp-*/SKILL.md`, AGENTS.md block |
| Gemini CLI | `.gemini/commands/pp/*.toml`, GEMINI.md block |
| OpenCode | `.opencode/agents/pp-*.md`, `.opencode/commands/pp-*.md` |
| Cursor | `.cursor/rules/product-planner.mdc`, `.cursor/commands/pp-*.md` |
| Windsurf | `.windsurf/rules/product-planner.md`, `.windsurf/workflows/pp-*.md` |
| Generic | AGENTS.md and the complete `.product-planner/kit/` |

Ten personas cover orchestration, analysis, research, product management, UX, architecture, task planning, development, QA and optional marketing. When the host exposes delegation, the coordinator assigns specialists concrete input/output files and acceptance criteria. Otherwise it adopts those same personas sequentially. A single coordinator owns state writes; no agent framework, server or paid orchestration service is required. Compatibility depends on the host reading the installed instructions; native command availability varies by editor version.

Adapter references: [OpenCode agents](https://opencode.ai/docs/agents/), [OpenCode commands](https://opencode.ai/docs/commands/), [Gemini custom commands](https://geminicli.com/docs/cli/custom-commands/).

## CLI examples

```sh
pp status
pp task list
pp task next
pp task add --file .product-planner/plan.json
pp task add --json '{"title":"Document local setup","acceptance":["README setup works"]}'
pp task start T1 --agent developer
pp task review T1 --note "Implementation checks pass"
pp task done T1 --agent qa --note "Acceptance verified"
pp task block T2 --reason "Provider credentials missing"
pp task unblock T2
pp task validate
pp dashboard --open
pp dashboard --watch
pp doctor
pp help
```

Tasks follow `todo → in_progress → review → done`; block/unblock and reopen support recovery. Starting requires completed dependencies. `task next` chooses ready work by priority, epic order and task ID. It exits 2 when no task is ready (`ALL_DONE`, `ALL_BLOCKED` or `NONE_READY`; JSON mode prints null). `NONE_READY` calls for recovering active/review tasks or inspecting dependencies. IDs are E#/T#, priorities critical/high/medium/low and estimates S/M/L. Each task needs verifiable acceptance criteria. The template in `kit/templates/task-plan.json` shows the import format.

## Dashboard

`product-dashboard.html` works offline from the filesystem. It includes phase and planning status, progress tiles, status donut, tasks per epic, burn-up history, a searchable/filterable task table, epics, roadmap, risks, decisions, competitor comparison, planning docs and recent activity. Charts include data tables, tooltips, theme selection and optional patterns.

Task/state/log commands regenerate it automatically. The browser reloads every 30 seconds by default; refreshing reads the latest generated HTML. Editing planning documents directly requires `pp dashboard`, or a running `pp dashboard --watch` process to regenerate. `pp dashboard --no-refresh` disables browser auto-refresh. Dashboard auto-open at the planning/build handoff is controlled by `pp state set options.autoOpenDashboard false`.

Request extra sections in plain language, such as “show API endpoints and their implementation status”. The agent writes `.product-planner/dashboard/<slug>.json` and regenerates. Supported types: table, metrics, list, bar and Markdown text. See `kit/templates/dashboard-section.json` and the operating manual for schema details. Task filters scope the task table; progress charts show the complete plan.

Preview fictional demo data without initializing this source repository:

```sh
node examples/demo.js
# Open output/demo/product-dashboard.html in a browser
```

## Research and memory

Planning explicitly establishes whether research is wanted, what the user can supply, and which web tools are available. Use native search when available or the built-in keyless fallback:

```sh
pp research search "appointment booking software competitors" --max 5
pp research fetch https://example.com --max-chars 12000
pp research options
```

The fallback uses DuckDuckGo HTML and may encounter blocking, rate limits or page changes. It reports HTTP/challenge failures; the agent should use an agreed alternative or supplied sources. Dynamic/paywalled pages may need the host browser. Optional tools are discussed during planning; nothing is installed automatically. For page fetching, the official MCP reference server uses [`uvx mcp-server-fetch`](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch). Save dated evidence and URLs in `.product-planner/research/sources.md`; distinguish observations from assumptions.

```sh
pp memory index
pp memory search "how does authentication work?"
pp memory status
# Optional, only when chosen: downloads npm libraries and a model on first indexing
pp memory setup
pp memory index
```

Default memory uses a local BM25 keyword index. The optional LanceDB/Transformers.js backend uses local embeddings after the initial download. Re-index when documents change. Project memory is independent of a vector database chosen for the product itself.

## State, git and removal

All durable project planning data lives in `.product-planner/`: state/config/tasks JSON, append-only activity log, Markdown deliverables, research, custom dashboard sections and optional memory. It is intended for git; heavy local vector/model artifacts are ignored. The agent commits per task when agreed during planning, while preserving unrelated user changes. It never pushes without prior authorization. The CLI does not push or commit automatically.

`pp uninstall` removes the known adapter files and marked instruction blocks, while keeping project state/docs, the installed kit and dashboard. Generated adapter files are managed by this package; do not store unrelated custom content in those files. Other files alongside them are retained.

## Updating and uninstalling

To update a linked installation, pull the latest source and refresh the generated files in each product project:

```sh
# In the product-planner checkout
git pull --ff-only

# In each product project; keep the same desired tool selection
product-planner init --tools claude,codex
```

Keep custom project instructions outside the marked Product Planner blocks and custom decisions outside the installed kit. Commit or back up your product project before updating generated files. Task and planning data are retained by init.

To remove integration files from a product project:

```sh
product-planner uninstall
```

To remove the global CLI installed with `npm link` or a tarball:

```sh
npm uninstall --global product-planner
```

## Troubleshooting

| Problem | What to do |
|---|---|
| `product-planner` or `pp` is not found | Run `npm link` from this checkout and make sure npm's global executable directory is on PATH. You can also run `node /absolute/path/product-planner/bin/product-planner.js help`. |
| A slash command does not appear | Restart/reload the editor after init, check that the right adapter is selected, or ask the agent to read `.product-planner/kit/workflows/pp-plan.md` directly. |
| The dashboard looks stale | Run `pp dashboard`; use `pp dashboard --watch` while editing docs directly. Browser refresh reads the last generated HTML. |
| Research is blocked or empty | Use native browser tools or supplied sources and record the limitation. The keyless search service may rate-limit or change its HTML. |
| No task is ready | Run `pp status` and `pp task validate`; recover active/review tasks or resolve recorded blockers. |
| You cannot clone the repository | Check the signed-in GitHub account and confirm it has access to this private repository. |

Run `pp doctor` from an initialized product repository for environment checks, or set `PP_DEBUG=1` when diagnosing CLI errors.

## Privacy and distribution

The GitHub repository is private, and `package.json` has `private: true` to prevent npm publication. Access is limited to authorized repository collaborators. This does not change how your selected AI provider handles project content: research, model requests and optional downloads use the tools you authorize. The project is currently `UNLICENSED`; no open-source redistribution license is granted.

## Development and verification

```sh
npm test
npm run check
npm pack --dry-run
```

Tests use temporary directories and cover all adapter outputs, repeat installation, removal preservation, task dependency/cycle checks, CLI import and lifecycle, dashboard escaping/custom data, research parsing, memory retrieval and state-path validation. No network is needed for the test suite. Editor command loading and actual LLM execution require a session in each host; generated-file checks do not replace that integration testing. Optional vector downloads are not part of the core tests.
