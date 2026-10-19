# Benchmark: does planning give better results?

This benchmark checks Product Planner's claim with measurements. The same written request goes to Claude Code in three set-ups, and the result is scored by **hidden acceptance tests** the agent never sees.

| Arm | Set-up | How the work starts |
|---|---|---|
| `plain` | Claude Code with no kit | The request as the first message |
| `planner` | `product-planner init --tools claude` (automatic mode) | The same request, no slash command |
| `speckit` | `specify init --integration claude` (spec-kit v1.2.1) | `/speckit-specify <request>`, then `/speckit-plan`, `/speckit-tasks`, `/speckit-implement` (its documented minimum flow) |

## Fairness rules

- Same model, same tool permissions, no web search or fetch, a fresh temporary git repository per run.
- One scripted user for every arm: whenever the agent asks something or ends a turn unfinished, it gets the same reply: *"Use your recommendations. If you are asking for approval, it is approved: continue until everything is built and verified."* The scripted user never mentions the hidden tests.
- Hidden tests check only behaviour stated explicitly in the scenario's `prompt.md`. Each scenario ships a reference implementation that passes them (`BENCH_TARGET=… node --test bench/scenarios/<s>/hidden-tests.js`), which proves the tests are correct and achievable.
- A run stops when the agent finishes without asking anything (planner arm: when its phase is `done` or only blocked tasks remain), or at the message or budget limit.
- Cost, tokens and duration come from Claude Code's own JSON output (`--output-format json`).

## Scenarios

| Scenario | Size | What it tests |
|---|---|---|
| `todo-cli` | Small | A command-line to-do app with exact output formats and exit codes (8 hidden tests). Plain prompting is expected to be cheapest here; it shows the cost of planning on tiny jobs. |
| `booking-lib` | Medium | A tutoring scheduler library with 17 hidden tests on stated rules: alignment, overlap and buffer, notice and horizon, cancel window, atomic reschedule, error codes. It measures whether requirements survive into tested code. |

## Run it

```sh
node bench/run.js --scenario booking-lib --arm planner   # also: plain, speckit
node bench/run.js --scenario booking-lib --arm plain --model sonnet --budget 10
node bench/report.js                                    # writes bench/RESULTS.md
```

Each run writes `bench/results/<scenario>-<arm>-<time>/` with `result.json`, the full `transcript.json`, the hidden test output and a tarball of the workspace (git-ignored). Requirements: Claude Code CLI signed in, Node 20+, and `uvx` for the spec-kit arm. Runs spend real API usage; `--budget` caps each run.

## Limits

Single runs vary: model output is not deterministic, so repeat runs before drawing firm conclusions. Two scenarios are not a general benchmark. Hidden tests measure stated behaviour, not design quality, UX or maintainability. The scripted user always accepts recommendations, which favours tools whose recommendations are good. That is part of what is being measured, but a real user would sometimes disagree.
