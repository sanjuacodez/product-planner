# Benchmark: does planning give better results?

This benchmark checks Product Planner's claim with measurements. The same written request goes to Claude Code in three set-ups, and the result is scored by **hidden acceptance tests** the agent never sees.

| Arm | Set-up | How the work starts |
|---|---|---|
| `plain` | Claude Code with no kit | The request as the first message |
| `planner` | `product-planner init --tools claude` (automatic mode) | The same request, no slash command |
| `speckit` | `specify init --integration claude` (spec-kit v1.2.1) | `/speckit-specify <request>`, then `/speckit-plan`, `/speckit-tasks`, `/speckit-implement` (its documented minimum flow) |
| `bmad` | `npx bmad-method@6.12.4 install --modules bmm --tools claude-code --yes` (BMAD-METHOD 6.12.4, MIT) | `/bmad-build <request>`, BMAD's documented one-session path (spec, checkpoint, implement, review) |

## Fairness rules

- Same model, same tool permissions, no web search or fetch, a fresh temporary git repository per run.
- One scripted user for every arm: whenever the agent asks something or ends a turn unfinished, it gets the same reply: *"Use your recommendations. If you are asking for approval, it is approved: build the full requested scope now, without splitting or deferring any part, and continue until everything is built and verified."* The scripted user never mentions the hidden tests. (Harness 2 added the full-scope sentence so no arm can defer part of the request by recommendation; results record the harness version.)
- Product-owner scenarios (`facts.md`): when the agent asks something, a small model (Haiku) answers only the questions asked, only from the fact sheet, then adds the same approval sentence. Every arm gets the same responder; asking is what earns the facts. Its cost is reported separately and not added to the arm's cost.
- Existing-product scenarios (`seed/`): the seed is committed into the workspace before the arm is installed.
- Hidden tests check only behaviour stated explicitly in the scenario's `prompt.md`. Each scenario ships a reference implementation that passes them (`BENCH_TARGET=… node --test bench/scenarios/<s>/hidden-tests.js`), which proves the tests are correct and achievable.
- Scenarios with a `changes.json` send each change request, in order, after the initial request (spec-kit: after its four commands), before any scripted reply.
- A run stops when the agent finishes without asking anything (planner arm: when its phase is `done` or only blocked tasks remain), or at the message or budget limit.
- Cost, tokens and duration come from Claude Code's own JSON output (`--output-format json`).

## Scenarios

| Scenario | Size | What it tests |
|---|---|---|
| `todo-cli` | Small | A command-line to-do app with exact output formats and exit codes (8 hidden tests). Plain prompting is expected to be cheapest here; it shows the cost of planning on tiny jobs. |
| `booking-lib` | Medium | A tutoring scheduler library with 17 hidden tests on stated rules: alignment, overlap and buffer, notice and horizon, cancel window, atomic reschedule, error codes. It measures whether requirements survive into tested code. |
| `product-owner` | Small, incomplete | A café loyalty ledger whose request says the owner has specific rules and to ask before deciding them. 17 hidden tests: 5 on stated behaviour, 12 on facts only the owner knows (`facts.md`), each fact tested independently. Measures whether asking the right questions produces the right product. |
| `long-spec` | Medium | An event box office with 40 numbered rules in one message (validation order, boundaries, atomicity, interacting rules). 40 hidden tests, one per rule. Measures whether every rule of a long specification survives. |
| `change-sequence` | Small, five stages | A shopping-cart pricing engine, then four change requests including one that reverses an earlier rule. 20 hidden tests on the final state. Measures whether earlier rules survive repeated changes and the reversal takes effect. |
| `existing-codebase` | Small, seeded | An existing invoice library with tests and documented conventions (`seed/`), plus a change request. 18 hidden tests: 8 on existing behaviour that must not regress, 10 on the change. |
| `woo-extension` | Small, PHP platform | A WooCommerce extension (minimum order per role) to be sold on the WooCommerce Marketplace; the request names no tools. 14 hidden behaviour tests run the plugin against WordPress/WooCommerce stubs, and `quality.json` scores platform quality separately: PHPCS WordPress standard, PHP 7.4 compatibility, PHPStan level 5 with WordPress and WooCommerce stubs, and a security/Marketplace scan (sanitising, escaping, nonces, capabilities, prefixes, uninstall, i18n, HPOS). Needs PHP 8.1+ and Composer. |
| `scope-change` | Small, two stages | An inventory core, then a scripted mid-build change request (`changes.json`) adding `release` with a new error code. 8 hidden tests check the original rules and the change together, so they measure whether earlier requirements survive a scope change. |

## Scoring: behaviour, regressions and quality

Each run reports separate scores, so cost is always set against the quality it bought:

1. **Hidden tests, by group.** Test-name prefixes split stated behaviour (`prompt`), owner-only facts, each `change N`, `existing` behaviour and long-spec `rules`. The report's "Hidden tests by group" table shows each group.
2. **Quality checks** (never shown to the agent): committed secrets; whether the agent's own test suite exists and passes; semgrep findings when semgrep is installed (otherwise "not run", never "pass"); and scenario platform checks from `quality.json` (tools are installed once into `BENCH_TOOLS`, default `~/.cache/pp-bench-tools`).
3. **Blind review** (`--review`, extra cost): a separate model scores correctness risks, maintainability, tests, documentation and security from 1 to 5 without being told which arm built the code.

## Run it

```sh
node bench/run.js --scenario booking-lib --arm planner   # also: plain, speckit
node bench/run.js --scenario booking-lib --arm plain --model sonnet --budget 10
node bench/run.js --scenario scope-change --arm planner --repeat 3 --budget 8   # three sequential runs
node bench/run.js --scenario scope-change --arm planner --repeat 3 --dry-run     # prints the plan and maximum spend; launches nothing
node bench/run.js --scenario product-owner --arm bmad --review                  # BMAD arm with a blind review
node bench/report.js                                    # writes bench/RESULTS.md
```

`--repeat n` (at most 10) runs the same arm n times, one after another, each in a fresh workspace with its own result folder; `--budget` applies to each run, so the maximum spend is budget × repeats. `--dry-run` prints that maximum and the number of follow-up messages without starting Claude Code.

The report groups runs by scenario, arm and kit digest (a hash of `kit/` and `src/` at run time), so runs before and after a kit change are never averaged together. With several runs it shows the min–max range next to each mean, how many runs finished on their own (status `completed`) rather than at a limit, and the cost per passing hidden test.

Each run writes `bench/results/<scenario>-<arm>-<time>-<id>/` with `result.json`, the full `transcript.json`, the hidden test output and a tarball of the workspace (git-ignored). Requirements: Claude Code CLI signed in, Node 20+, `uvx` for the spec-kit arm, `uv` for the BMAD arm (its skills run Python helpers), and PHP with Composer for PHP scenarios. Runs spend real API usage; `--budget` caps each run. On macOS, prefix long runs with `caffeinate -i`: if the machine sleeps, the request stalls and the per-message timeout does not advance, so the run hangs instead of failing.

## Limits

Single runs vary: model output is not deterministic, so repeat runs before drawing firm conclusions. A handful of small scenarios is not a general benchmark. Hidden tests measure stated behaviour, not design quality, UX or maintainability. The scripted user always accepts recommendations, which favours tools whose recommendations are good. That is part of what is being measured, but a real user would sometimes disagree.
