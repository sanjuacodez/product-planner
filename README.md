# Product Planner

A dependency-free Node.js kit for taking a software idea through an interview, competitor research, PRD, UX/UI direction, architecture, task planning and implementation. It installs Markdown personas and workflows into your AI coding tool. The tool's agent performs the work; the CLI tracks state, tasks, research, memory and a self-contained HTML dashboard.

All requirements gathering happens during planning. You review the complete plan once, then the agent implements tasks with QA, continuing through available work when another task is blocked. Host permission prompts and session limits still apply; `pp-resume` recovers persisted context.

## Why use Product Planner?

- **Plan the whole product before coding.** Capture the problem, audience, competitor strengths and weaknesses, requirements, UX/UI direction, architecture and delivery tasks in one process.
- **Reduce repeated decisions during development.** Resolve scope and preferences up front, review the complete plan once, then let the agent execute available tasks with QA.
- **Keep your choice of coding tool.** Use dedicated adapters for supported tools and the same file-based workflow in any editor that can read the instructions and run shell commands.
- **Give specialists clear responsibilities.** Each role receives concrete inputs, owned outputs and acceptance criteria; the host can delegate or run the roles sequentially.
- **See progress outside the editor.** Open an offline HTML dashboard with tabs for the dashboard (charts and tables), tasks (table, board, by-epic and delivery-order views), roadmap and future plans, research, documents and activity.
- **Know who did what.** Every task shows the agent persona and the AI model that worked on it.
- **Resume across sessions and tools.** Project documents and task state stay in the repository, so a new session can recover what was decided and what remains.
- **Start without extra services.** The core CLI has no npm dependencies, API keys or hosted backend. Your chosen AI tool may have its own costs; optional memory downloads are separate.

## Requirements

- Node.js **20 or newer** and npm.
- Git (recommended, so planning documents are versioned).
- An AI coding tool that can read local files, edit the project and run shell commands.
- Internet access when doing live research or downloading optional tools/models.

## Install

The repository is public: https://github.com/sanjuacodez/product-planner. The core CLI has no npm dependencies, so installing takes a few seconds.

**Recommended: install the CLI globally from GitHub**

```sh
npm install -g github:sanjuacodez/product-planner
product-planner --version
```

This puts `product-planner` and its short alias `pp` on your PATH. The installed agents and workflows call `product-planner …` from the shell, so a global install (or `npm link`) is needed for normal use.

**Alternative: clone and link** (best if you want to modify the kit or follow `main`)

```sh
git clone https://github.com/sanjuacodez/product-planner.git
cd product-planner
npm link            # keep this checkout in place while the link is used
```

**One-off run without installing:** `npx -y github:sanjuacodez/product-planner init --tools claude`. Agents still need the CLI afterwards, so install it globally before planning.

### Add Product Planner to a project

Run `init` in the root of the product you want to plan or build. For a new product, create the folder and run `git init` first.

```sh
cd /path/to/your-product
product-planner init --tools claude          # Claude Code
# product-planner init --tools claude,codex  # several tools at once
# product-planner init --tools gemini | opencode | cursor | windsurf | generic
# product-planner init --tools all --yes     # every adapter, no prompt
# product-planner init                       # choose interactively
```

`init` asks which tools to install for when run interactively; `--yes` uses detected tools plus the universal AGENTS.md adapter. It preserves your existing AGENTS.md/CLAUDE.md/GEMINI.md content outside its marked block. Re-running it refreshes the bundled kit and adapter files while keeping all planning data. Edit project decisions and documents outside `.product-planner/kit`, because the installed kit is overwritten on update.

![Terminal session: npm install from GitHub, product-planner init --tools claude, and the generated Claude Code commands](docs/screenshots/install-terminal.png)

*Real output captured from a scratch project, shown in a terminal-style frame.*

## Install and run it inside Claude Code or your IDE

You do not need to leave your editor. Use whichever entry point you already work in. The **terminal** column means any terminal, including the IDE's integrated terminal (VS Code, Cursor and Windsurf: `` Ctrl+` ``; JetBrains: the *Terminal* tool window). The **chat** column means the AI tool's prompt or chat panel.

| Where you work | Install from the terminal | Install from the chat window | Then start planning |
|---|---|---|---|
| **Claude Code in a terminal** (`claude`) | Run the install and `init` commands above, then start `claude` in the project folder | Prefix shell commands with `!` to run them directly from the Claude prompt:<br>`! npm install -g github:sanjuacodez/product-planner`<br>`! product-planner init --tools claude` | `/pp-plan <your idea>` |
| **Claude Code in VS Code, Cursor or Windsurf** (Claude Code extension) | Integrated terminal: install + `init --tools claude` | In the Claude panel, ask: *“Install product-planner with `npm install -g github:sanjuacodez/product-planner`, then run `product-planner init --tools claude` in this project.”* Approve the shell commands when asked | `/pp-plan` in the Claude panel |
| **Claude Code in JetBrains IDEs** (Claude Code plugin) | Terminal tool window: install + `init --tools claude` | Same prompt as above in the Claude session | `/pp-plan` |
| **Claude desktop app** (Claude Code on a local folder) | Any terminal: install + `init --tools claude` in that folder | Ask Claude to run the same two commands | `/pp-plan`, or “run pp-plan” |
| **OpenAI Codex** (CLI or IDE extension) | `init --tools codex` | Ask Codex to run the install and `init --tools codex` commands | Invoke the `pp-plan` skill, or “run pp-plan” |
| **Gemini CLI** | `init --tools gemini` | `!` runs shell commands in Gemini CLI too, or ask it to run them | `/pp:plan` |
| **Cursor** (Agent chat) | `init --tools cursor` | Ask the agent to run the commands | `/pp-plan`, or “run pp-plan” |
| **Windsurf** (Cascade) | `init --tools windsurf` | Ask Cascade to run the commands | `/pp-plan`, or “run pp-plan” |
| **OpenCode** | `init --tools opencode` | Ask the agent to run the commands | `/pp-plan` |
| **VS Code with Copilot agent mode, Cline, Roo Code, Kilo Code; Zed, Aider, Monocode, T3 Code** | `init --tools generic` | Ask the agent to run the commands | “Read AGENTS.md and run pp-plan” |

After `init`, **reload the window or start a new chat session** if the new `/pp-*` commands do not appear yet. Agent tools ask for permission before running shell commands; approve `npm install` and `product-planner` when prompted. In Claude Code you can pre-approve the CLI with the permission rule `Bash(product-planner:*)`.

Here Claude Code runs the installed `/pp-status` command in the freshly initialized project:

![Claude Code running /pp-status in the initialized project and summarizing phase, planning steps and next milestone](docs/screenshots/claude-pp-status.png)

*Real Claude Code response captured with `claude -p "/pp-status"` in the project above; the interactive chat shows the same answer.*

## First project walkthrough

1. Initialize your product repository with the adapter for your coding tool.
2. Open that repository in the tool and run `pp-plan` with your idea.
3. Answer two or three short rounds of multiple-choice questions (or reply “use your recommendations”), accept or defer the proposed features, and confirm the one-page concept brief.
4. Review the complete product plan and approve it when ready.
5. Let the agent build the dependency-ordered tasks and verify them with QA. Open `product-dashboard.html` to follow progress.
6. If a session ends, run `pp-resume` in a new session to continue from the saved files.

Example starting prompt:

> Run pp-plan for a booking app for independent tutors. Tutors should manage availability, students should book sessions, and both should see upcoming appointments. Research competing products, suggest a simple UI and use free/open-source tools where practical.

## How planning asks you questions

You give a one-line idea; the agent does the drafting and asks you to choose. It follows the [interview guide](kit/guides/interview.md):

1. **Draft first, then ask.** It writes its best guess at the product from your idea, your repository and any material you supplied, and asks only where the answer would change scope, user experience, architecture, cost or acceptance. Everything else becomes a listed assumption you can correct.
2. **Short multiple-choice rounds.** At most 3 rounds of at most 5 questions (2 rounds in the quick track). Every question has 2–4 options with one marked *recommended* and a reason. Reply `1a 2b 3 recommended`, “use your recommendations”, or in your own words. Tools with a built-in question picker show the same choices as buttons.
3. **Pick the size of the plan.** Round 1 confirms the track:

   | Track | For | Interview and documents |
   |---|---|---|
   | `quick` | Small apps, prototypes, one feature (≈15 tasks or fewer) | 2 rounds; no research unless asked; UX goes inside the PRD; short architecture |
   | `standard` | A new product with several journeys | 3 rounds; research offered; separate UX and architecture documents |
   | `existing` | Changes to an existing codebase | Code inspected and baseline.md written first; questions cover only the change |

4. **Features you accept, not prose you re-read.** Round 2 proposes a feature list (`features.json`) with priority (must / should / could / won't), release (MVP / Next / Later) and where each idea came from. Accept, defer or reject them in one reply. The agent then asks only about gaps in the accepted MVP features: who uses it, the main flow, data, roles, edge cases, integrations and what “done” looks like.
5. **A one-page concept brief.** When `pp feature check` passes (every feature decided; MVP features have acceptance criteria and no open questions), the agent shows a one-page brief to confirm: problem, user, MVP features, non-goals, success metric and key assumptions. PRD, UX, architecture and tasks are all derived from those features.
6. **Nothing gets lost.** Every task lists the feature IDs it delivers, and `pp task validate` fails if an accepted MVP feature has no task. The Roadmap tab shows each feature with its decision and task progress.

A real first round, produced by Claude Code from the one-line idea (no answers given yet):

![Claude Code's first planning round: a drafted concept, five multiple-choice questions with recommended answers, and listed assumptions](docs/screenshots/interview-round1.png)

After answering “use your recommendations”, round 2 proposed 15 features and saved them. They appear on the dashboard straight away:

![Roadmap tab listing 15 proposed features with release, priority and decision](docs/screenshots/features-scope.png)

*Both screenshots come from a real run of `/pp-plan` (Claude Code, Opus 5.5) in a scratch project. Round 1 cost about $0.30 and round 2 about $0.56 at API prices, mostly cached reads of the instructions and files.*

```sh
pp feature list                    # the agreed scope, with task progress per feature
pp feature show F5                 # story, flow, acceptance, open questions, assumptions
pp feature set F12 release Later   # change a decision yourself
pp feature check                   # is the scope ready for requirements and tasks?
```

## Automatic mode and replanning

After `init`, you don't have to type commands. **Automatic mode** is on by default: the instruction file your tool loads every session (CLAUDE.md, AGENTS.md, GEMINI.md, or Cursor/Windsurf rules) tells the agent to pick the workflow from what you say:

| You say something like… | The agent runs |
|---|---|
| “I want to build a habit tracker for students” | `pp-plan`: the planning interview starts |
| “Also add a weekly email summary”, “drop payments”, “switch to mobile”, “replan” (after the plan was approved) | `pp-replan`: the change is analysed, then applied after your approval |
| “continue”, “keep going”, or a new session on a planned project | `pp-resume`: continues planning or the build from saved state |
| “how far along are we?”, “open the dashboard” | `pp-status` |
| “why did we pick SQLite?” | `pp-ask` |
| “fix this typo”, “write a quick script” | Nothing: small work outside the plan is done directly, with no planning overhead |

The agent announces the workflow in one line (“Starting pp-plan; say stop to skip”). The slash commands still work. Turn automatic mode off or back on per project:

```sh
pp auto off      # only /pp-* commands or "run pp-plan" start workflows
pp auto on
pp auto status
```

### Replanning an approved plan

You don't need to plan again from scratch. `pp-replan`:
1. Lets the task in progress finish, or parks it.
2. Shows the impact: features added, changed or dropped; tasks affected; documents to edit; new risks and costs.
3. Asks at most 5 questions, only about the change.
4. **Writes nothing until you approve the change summary.**

Then it applies the change: it edits only the affected document sections, revises tasks that haven't started (`pp task update`), removes obsolete ones (`pp task remove`), and adds follow-up tasks for completed work instead of rewriting it. Finally it validates, logs the replan in decisions.md and continues the build.

```sh
pp task update T5 --json '{"acceptance":["…","Can reschedule"]}' --note "replan: reschedule"
pp task remove T7 --reason "replan: payments deferred"
```

*Tested with Claude Code (Opus 5.5) in scratch projects:*
- *A plain idea, with no `/pp-plan`, started the interview: about $0.27.*
- *“Write a tiny hello.js” was done directly without a workflow: about $0.12.*
- *“Also add a weekly email summary” on an approved plan produced the impact analysis and 5 questions: about $0.27.*

## Start with your AI coding tool

Open the initialized product repository and invoke `pp-plan` with your idea (see the table above for each tool's syntax). The planning workflow gathers concept, audience, business goals, constraints, MVP boundaries, design preferences, research inputs and access, browser access, optional marketing, memory, which AI model should run each agent, git choices and dashboard preferences. It generates the plan and dashboard for one final review. After approval it opens the dashboard by default and continues the build. You can ask it to stop after planning or disable auto-open.

| Workflow | Purpose |
|---|---|
| `pp-plan` | Interview, research, requirements, UX, architecture and task plan |
| `pp-build` | Implement approved tasks with QA until done or all remaining work is blocked |
| `pp-resume` | Recover context and continue after an interrupted session |
| `pp-status` | Inspect progress; open the dashboard when requested |
| `pp-ask` | Answer questions or add requested dashboard information |
| `pp-replan` | Change an approved plan: impact, a few questions, one approval, synced tasks |

## Supported IDEs, coding tools and models

The package supplies workflow instructions; your chosen coding tool supplies the model and execution environment. It does not bundle a model or require a specific model vendor.

| IDE / tool | Support path today | How to start |
|---|---|---|
| Claude Code CLI / IDE integration | Dedicated agent and slash-command files | `/pp-plan` |
| OpenAI Codex | Dedicated workflow skills and AGENTS.md | Invoke `pp-plan` or say “run pp-plan” |
| Gemini CLI | Dedicated TOML custom commands and GEMINI.md | `/pp:plan` |
| OpenCode | Dedicated agents and commands | `/pp-plan` or plain-language workflow request |
| Cursor | Dedicated rules and commands | `/pp-plan` or plain-language workflow request |
| Windsurf | Dedicated rules and workflows | `/pp-plan` or plain-language workflow request |
| Monocode, T3 Code | Universal file-based instructions; no dedicated adapter | Explicitly read AGENTS.md and request pp-plan |
| VS Code with Cline, Roo Code, Kilo Code, or other coding extensions | Universal file-based instructions; loading depends on the extension | Explicitly read AGENTS.md and the installed workflow |
| Zed, Aider and other shell-capable coding tools | Universal file-based instructions; loading depends on the tool | Explicitly read the installed manual/workflow |

Dedicated integrations are tested for generated-file correctness. The Claude Code commands were also run end to end (`/pp-status`, screenshot above); other editors and versions are not yet verified end to end. Universal support requires local file access, editing and shell execution; it does not promise native slash commands or subagents. Use native delegation only when the host exposes it. Model effectiveness depends on its ability to follow instructions, use tools and verify changes.

## Tool adapter files and delegation

| Tool | Installed integration |
|---|---|
| Claude Code | `.claude/agents/pp-*.md`, `.claude/commands/pp-*.md`, CLAUDE.md block |
| Codex | `.agents/skills/pp-*/SKILL.md`, AGENTS.md block |
| Gemini CLI | `.gemini/commands/pp/*.toml`, GEMINI.md block |
| OpenCode | `.opencode/agents/pp-*.md`, `.opencode/commands/pp-*.md` |
| Cursor | `.cursor/rules/product-planner.mdc`, `.cursor/commands/pp-*.md` |
| Windsurf | `.windsurf/rules/product-planner.md`, `.windsurf/workflows/pp-*.md` |
| Generic | AGENTS.md and the complete `.product-planner/kit/` |
| Browser (only after `pp browser setup`) | Playwright MCP entry in `.mcp.json`, `.cursor/mcp.json`, `.gemini/settings.json`, `.vscode/mcp.json` or `opencode.json` |

Ten personas cover orchestration, analysis, research, product management, UX, architecture, task planning, development, QA and optional marketing. When the host exposes delegation, the coordinator assigns specialists concrete input/output files and acceptance criteria. Otherwise it adopts those same personas sequentially. A single coordinator owns state writes; no agent framework, server or paid orchestration service is required. Compatibility depends on the host reading the installed instructions; native command availability varies by editor version.

## Agents and AI models

The CLI does not run a model: your coding tool does. To make it visible which model did what, agents pass `--agent` and `--model` on every task transition:

```sh
pp task start T3 --agent developer --model claude-opus-5-5
pp task review T3 --agent developer --model claude-opus-5-5
pp task done T3 --agent qa --model claude-sonnet-5-5 --note "Acceptance verified"
```

Each task keeps a `workedBy` list of agent/model pairs. The dashboard shows them in every task view, in the *Tasks by agent and AI model* chart and in the *Agents and AI models* table. During planning you can choose models per agent, for example a stronger model for architecture and a faster one for QA:

```sh
pp state set models.default claude-opus-5-5
pp state set models.qa claude-sonnet-5-5
```

Planned models show as *(planned)* with a dashed outline until a task records the model that actually ran. Whether a persona can run on a different model depends on the host. Claude Code subagents and OpenCode agents support per-agent models; elsewhere, the session's model runs every persona, and that is what gets recorded.

Adapter references: [OpenCode agents](https://opencode.ai/docs/agents/), [OpenCode commands](https://opencode.ai/docs/commands/), [Gemini custom commands](https://geminicli.com/docs/cli/custom-commands/).

## Planning an existing product

Initialize Product Planner inside the existing product repository, then ask:

> Run pp-plan for this existing product. First inspect its current features, architecture, data model and tests. Compare what exists with our goal of adding team workspaces, then propose an incremental roadmap. Cite the code evidence, reuse existing modules and preserve completed work.

The workflow now instructs agents to produce `.product-planner/baseline.md` before revising the PRD, architecture or roadmap. That report maps capabilities to source files, records verification and unknowns, and explains the gap to the desired outcome. Tasks should name affected components, dependencies and acceptance checks. Verified lessons go in lessons.md and can be retrieved through enabled document memory.

**Available now:** direct-inspection discovery guidance, baseline/lessons templates, existing document memory and manually maintained custom dashboard sections. This is agent-led execution, not an automatic code scan performed by init.

**Planned:** one optional SocratiCode integration for semantic code search and graph analysis, automatic source freshness checks, and better task-specific memory retrieval. GraphCode is an alternative under evaluation. Optional LanceDB remains for project documents/lessons; the design avoids duplicating the provider's entire code index. Nothing installs all these tools by default.

Read the [existing-product guide](kit/guides/existing-products.md) and [implementation stages and acceptance criteria](kit/guides/code-intelligence-plan.md).

## Browser setup

Product Planner never changes your default browser, and `init` installs nothing. Agents need a browser for research and UI QA, which is decided once, during planning:

1. **Use the AI tool's own browser if it has one.** Many tools ship one: a built-in browser or preview, a browser extension integration, or an already-configured browser MCP server. The agent checks its own tool list (the shell cannot see host tools) and records it with `pp browser use host --detail "…"`.
2. **If the tool has no browser, the agent asks you** whether to install a free, open-source option: **Playwright MCP + Chromium** (Apache-2.0, maintained by Microsoft; about 150 MB in Playwright's shared cache).
3. **If you approve, it installs and connects it:**

   ```sh
   pp browser setup                       # tools chosen at init
   pp browser setup --tools claude,vscode # or pick tools; add --headless or --engine firefox|webkit
   ```

   This pins one `@playwright/mcp` version, downloads the matching browser build, and registers the server in project-scoped config: `.mcp.json` (Claude Code), `.cursor/mcp.json`, `.gemini/settings.json`, `.vscode/mcp.json` (VS Code agent mode) and `opencode.json`. Codex and Windsurf keep MCP servers in user-level config, so the command prints the exact `codex mcp add …` command or JSON snippet to apply. Existing entries are kept unless you pass `--force`. **Reload the AI tool session afterwards** so it picks up the server, and approve it if asked.
4. **If you decline,** `pp browser use none` is recorded. Research uses `pp research search|fetch` (HTML/text only) and your supplied sources; QA records what could not be verified.

```sh
pp browser status    # recorded choice, browser MCP servers, cached browsers, installed browsers
pp browser options   # the options above
pp browser remove    # remove the Playwright entry from project configs
```

The dashboard is a local HTML file and needs none of this. Product test suites (for example Playwright Test in your product repo) are a separate architecture decision. See the [browser policy](kit/guides/browser-policy.md).

## CLI examples

```sh
pp status
pp task list
pp task next
pp task add --file .product-planner/plan.json
pp task add --json '{"title":"Document local setup","acceptance":["README setup works"]}'
pp task start T1 --agent developer --model claude-opus-5-5
pp task review T1 --agent developer --model claude-opus-5-5 --note "Implementation checks pass"
pp task done T1 --agent qa --model claude-sonnet-5-5 --note "Acceptance verified"
pp task block T2 --reason "Provider credentials missing"
pp task unblock T2
pp task validate
pp task update T5 --json '{"priority":"high"}' --note "replan"
pp task remove T7 --reason "replan: out of scope"
pp auto status
pp feature list
pp feature check
pp dashboard --open
pp dashboard --watch
pp browser status
pp doctor
pp help
```

Tasks follow `todo → in_progress → review → done`; block/unblock and reopen support recovery. Starting requires completed dependencies. `task next` chooses ready work by priority, epic order and task ID. It exits 2 when no task is ready (`ALL_DONE`, `ALL_BLOCKED` or `NONE_READY`; JSON mode prints null). `NONE_READY` calls for recovering active/review tasks or inspecting dependencies. IDs are E#/T#, priorities critical/high/medium/low and estimates S/M/L. Each task needs verifiable acceptance criteria. The template in `kit/templates/task-plan.json` shows the import format.

## Dashboard

`product-dashboard.html` is a single self-contained file that works offline. It is organised in tabs:

| Tab | What it shows |
|---|---|
| **Dashboard** | Phase and planning progress, KPI tiles, blocked tasks, charts (status donut, tasks per epic, tasks by agent and AI model, burn-up) with data tables, summary tables (epic progress; agents and AI models) and recent activity |
| **Tasks** | Status filters and search (by task, agent or model) across four views: **Table** (expand a task for acceptance criteria, dependencies and notes), **Board** (kanban by status), **By epic**, and **Delivery order** (dependency steps). Every task shows its agent and AI model |
| **Roadmap** | Features and scope from the interview (decision, release, task progress), then future plans: each `##` section of roadmap.md (MVP, Next release, Later…) as a lane, plus delivery milestones per epic |
| **Research** | Competitor comparison, market research and sources |
| **Documents** | Concept, PRD, UX, marketing, architecture, baseline, lessons, risks and decisions |
| **Activity** | Full activity log with agent and model |

Links are addressable, for example `product-dashboard.html#tasks/board` or `#roadmap`, and `?theme=dark` selects dark mode. Task/state/log commands regenerate the file automatically. The browser reloads every 30 seconds by default and stays on the selected tab. Editing planning documents directly requires `pp dashboard`, or a running `pp dashboard --watch`. `pp dashboard --no-refresh` disables auto-refresh; `pp state set options.autoOpenDashboard false` stops it opening at the planning/build handoff.

Ask for extra sections in plain language, such as “show API endpoints and their implementation status”. The agent writes `.product-planner/dashboard/<slug>.json` (types: table, metrics, list, bar, Markdown text; `"tab"` picks where it appears) and regenerates. See `kit/templates/dashboard-section.json`.

Preview fictional demo data without initializing this source repository:

```sh
node examples/demo.js            # then open output/demo/product-dashboard.html
node examples/planning-demo.js   # planning-phase example: output/planning-demo/product-dashboard.html
```

## Screenshots: following the work

These screenshots show the current dashboard with **fictional Fieldnotes demo data** (`node examples/demo.js`). They show what you follow while the coding agent works in your editor.

### Dashboard: graphs and tables

Phase, KPIs, blocked work, status and epic charts, the agent/model chart, burn-up history, summary tables and recent activity with the agent and model behind each change.

![Dashboard tab with KPI tiles, charts including tasks by agent and AI model, summary tables and recent activity](docs/screenshots/dashboard-overview.png)

### Tasks: table view with agent and AI model

Planned assignments have a dashed outline marked *(planned)*. Recorded ones show the model that actually ran.

![Task table showing each task's epic, agent and AI model, priority and status](docs/screenshots/tasks-table.png)

### Tasks: board view

![Kanban board with To do, In progress, In review, Blocked and Done columns; each card shows agent and model](docs/screenshots/tasks-board.png)

### Tasks: delivery order

Tasks grouped into dependency steps, a roadmap of the build itself.

![Delivery order view grouping tasks into dependency steps](docs/screenshots/tasks-delivery-order.png)

### Roadmap and future plans

![Roadmap tab with MVP, Next release, Later opportunities and Review triggers lanes, plus epic milestones](docs/screenshots/roadmap.png)

### Planning phase

Interview and document milestones while planning. For existing products, the current capability baseline appears as a custom section.

![Planning dashboard showing planning milestones and a current product baseline table](docs/screenshots/planning-progress.png)

### Dark mode

![Dark dashboard showing the same progress data and charts](docs/screenshots/dashboard-dark.png)

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

## Where your files are saved

Everything Product Planner creates lives **inside your product repository**: one folder, `.product-planner/`, plus the generated dashboard and the small adapter files for your tools. Nothing is stored in a hidden global location except the CLI itself and, if you opt in, shared download caches.

```
your-product/
├── .product-planner/                 ← all project data (commit this)
│   ├── state.json                    phase, planning steps, options (research, browser, memory…), planned models
│   ├── config.json                   tools installed, dashboard/research/memory settings
│   ├── features.json                 feature register from the interview (scope, decisions, acceptance)
│   ├── tasks.json                    epics and tasks, incl. features delivered and workedBy agent/model history
│   ├── plan.json                     task plan written by pp-planner before import
│   ├── log.jsonl                     append-only activity log (feeds burn-up and Activity tab)
│   ├── concept.md  prd.md  ux.md  architecture.md  marketing.md
│   ├── roadmap.md  risks.md  decisions.md  baseline.md  lessons.md
│   ├── research/                     market.md, competitors.json, sources.md
│   ├── dashboard/*.json              custom dashboard sections you asked for
│   ├── memory/index.json             keyword memory index (rebuildable)
│   ├── memory/lancedb/               optional vector DB          ┐ git-ignored,
│   ├── memory/node_modules/, models/ optional libs + embeddings ┘ rebuildable
│   └── kit/                          installed copy of agents/workflows/templates (regenerated by init)
├── product-dashboard.html            generated dashboard (path set in config.json)
├── AGENTS.md / CLAUDE.md / GEMINI.md marked Product Planner block inside your file
├── .claude/ .agents/ .gemini/ .opencode/ .cursor/ .windsurf/   adapter files (regenerated by init)
└── .mcp.json, .cursor/mcp.json, …    only if you approved `pp browser setup`
```

Outside the project, only these exist: the global CLI from `npm install -g`, npm's `npx` cache, Playwright's shared browser cache (`~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright` on Linux, `%LOCALAPPDATA%\ms-playwright` on Windows) if you approved a browser, and user-level MCP config for Codex/Windsurf if you applied it.

### Moving a project to another folder, machine or repository

Yes, you can. Everything that matters is in `.product-planner/`.

1. **Same repository, new machine:** `.product-planner/` is committed with your code, so clone the repo, install the CLI (`npm install -g github:sanjuacodez/product-planner`) and run `product-planner init --tools <your tools>` to regenerate adapter files. Planning data is kept as-is.
2. **Different folder or repository:** copy the whole `.product-planner/` folder into the new project root (optionally also `product-dashboard.html`), then run `product-planner init --tools <your tools>` there. Init keeps the copied state/tasks/docs and rewrites the kit and adapter files. If the source code also moved, ask the agent to run `pp-resume`; it compares the baseline with the new repository before continuing.
3. **Rebuild what isn't copied:** run `pp memory index` (and `pp memory setup` first if you used vector memory, because `memory/lancedb`, `node_modules` and `models` are git-ignored), `pp dashboard` to regenerate the HTML, and `pp browser setup` again if the new machine needs the Playwright browser.
4. **Check it:** `pp status`, `pp task validate` and `pp doctor`.

The phase, approvals, task history, agent/model records and activity log travel with the folder. Paths inside the docs are relative, so nothing needs editing.

## Git and removal

`.product-planner/` is intended for git; heavy local vector/model artifacts are ignored by its own `.gitignore`. The agent commits per task when agreed during planning, while preserving unrelated user changes. It never pushes without prior authorization. The CLI does not push or commit automatically.

`pp uninstall` removes the known adapter files and marked instruction blocks, while keeping project state/docs, the installed kit and dashboard. `pp browser remove` removes the Playwright MCP entry. Generated adapter files are managed by this package; do not store unrelated custom content in them.

## Updating and uninstalling

To update, reinstall the CLI (or pull your linked checkout), then refresh the generated files in each product project:

```sh
npm install -g github:sanjuacodez/product-planner   # global install
# or, in a linked checkout: git pull --ff-only

# In each product project; keep the same desired tool selection
product-planner init --tools claude,codex
```

Keep custom project instructions outside the marked Product Planner blocks and custom decisions outside the installed kit. Commit or back up your product project before updating generated files. Task and planning data are retained by init.

To remove integration files from a product project:

```sh
product-planner uninstall
```

To remove the global CLI:

```sh
npm uninstall --global product-planner
```

## Troubleshooting

| Problem | What to do |
|---|---|
| `product-planner` or `pp` is not found | Run `npm install -g github:sanjuacodez/product-planner` (or `npm link` from a checkout) and make sure npm's global bin directory (`npm prefix -g`/bin) is on PATH. IDE terminals and agent shells may need a restart to see a new PATH. |
| A slash command does not appear | Reload the window or start a new chat session after init, check that the right adapter is selected, or ask the agent to read `.product-planner/kit/workflows/pp-plan.md` directly. |
| The browser MCP server does not show up | Reload the AI tool session after `pp browser setup` and approve the project MCP server if prompted; run `pp browser status`. For Codex/Windsurf apply the printed user-level command or snippet. |
| The dashboard shows “model not recorded” | The agent moved tasks without `--model`. Plan models with `pp state set models.<agent> <id>`, or ask the agent to pass `--model` on transitions. |
| The dashboard looks stale | Run `pp dashboard`; use `pp dashboard --watch` while editing docs directly. Browser refresh reads the last generated HTML. |
| Research is blocked or empty | Use native browser tools or supplied sources and record the limitation. The keyless search service may rate-limit or change its HTML. |
| No task is ready | Run `pp status` and `pp task validate`; recover active/review tasks or resolve recorded blockers. |

Run `pp doctor` from an initialized product repository for environment checks, or set `PP_DEBUG=1` when diagnosing CLI errors.

## License and distribution

The repository is public on GitHub. `package.json` keeps `private: true` so it is never accidentally published to the npm registry; install it from GitHub as shown above. No license file has been added yet (`UNLICENSED`), so default copyright applies until one is chosen. Your AI provider's data handling is unchanged: research, model requests and optional downloads use the tools you authorize.

## Development and verification

```sh
npm test
npm run check
npm pack --dry-run
```

Tests use temporary directories and cover all adapter outputs, repeat installation, removal preservation, task dependency/cycle checks, CLI import and lifecycle, agent/model recording, feature readiness and coverage, automatic-mode routing on/off, replanning task updates/removals, dashboard tabs/views/escaping/custom data, delivery-order and roadmap parsing, browser MCP registration, research parsing, memory retrieval and state-path validation. No network is needed for the test suite. Editor command loading and actual LLM execution require a session in each host; generated-file checks do not replace that integration testing. Optional vector and browser downloads are not part of the core tests.
