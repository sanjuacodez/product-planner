# Focused execution, models and parallel tasks

Product Planner supplies instructions and task data. The host supplies the model runtime,
subagent tools, permissions and concurrency limits. A CLI task command never launches a model.

## Model selection

Resolve a requested model from the task's `model`, then `state.models.<agent>`, then
`state.models.default`. These are preferences, not proof that a switch happened.
Use the host's documented per-agent model control only when exposed and allowed by
the session. Otherwise inherit the current model and record the fallback in the task note.
Never claim to change the parent session model by updating planner state.
Record the actual worker model with `--model` on each transition; when the host does not
identify it, omit the value and note that it is unknown. Never substitute the requested
model for an unknown actual model.

Prefer a lower-cost available model for bounded, low-risk work with clear acceptance;
use a stronger available model for architecture, ambiguous requirements, security-sensitive
changes or failed attempts. Respect the user's explicit choices. Escalate with failure
evidence and a revised brief rather than repeating the same attempt. Model identifiers,
availability and switching controls differ by host; the kit does not install model access.

## Schedule independent work

1. Recover active/review tasks before assigning new work. Inspect `task ready --json`
   for all dependency-ready candidates, ordered by priority. Validate the graph first.
   Readiness alone does not prove safe concurrency.
2. The coordinator records each worker's exclusive output paths in the task's `writes`
   field and the paths it reads in `sources` (`task update T# --json '{"writes":[…]}'`;
   concrete repository-relative files or directories, no globs). `task batch --json`
   proposes a batch that respects those declarations, active work and the concurrency
   limit; it does not start tasks. Its check is path-based, so also review against every
   active worker: shared files, generated outputs,
   package manifests/lockfiles, schemas and API contracts can create conflicts even
   without a dependency edge. Serialize these changes unless contracts are already fixed
   and writes are disjoint. Unknown ownership means sequential execution.
3. Where the host permits delegation, automatically delegate eligible independent work.
   Default to at most two active build tasks, including coordinator implementation work;
   `state.options.maxConcurrentTasks` may override this with a positive integer (1 is
   sequential). Obey the smaller host limit and do not recursively fan out workers.
   Tiny tasks may stay sequential when setup and coordination outweigh the work.
4. Start tasks sequentially through the coordinator before launching workers. Run `task capture T#`
   after starting so the brief can report changed sources later. Give each
   worker `task context T#`, the persona, owned paths, affected source paths, relevant
   original request wording and acceptance checks. Prefer a fresh context when the host
   supports it; read missing evidence rather than guessing. Do not copy full transcripts
   by default. Reuse the product concept and shared constraints included in every brief.
5. Workers edit only owned outputs and return changed paths, checks/results, decisions,
   blockers and the actual model. Only the coordinator runs task/state/log/dashboard
   mutations, edits shared planning records, changes ownership, commits or integrates
   work. The CLI uses whole-file state writes and has no concurrent-writer locking.
6. Review each result against acceptance, inspect the combined diff and run relevant
   integration checks after each batch before releasing dependent tasks. A completed
   worker is not automatically a completed task. Persist evidence with `task complete`
   (see pp-build step 4).
   Refill free slots with eligible work; when a worker fails, recover or block its task
   and recheck related ownership/contracts before continuing.

If the host disables delegation, perform the same tasks sequentially with their briefs.
Do not launch external AI CLIs to bypass host limits. Parallel execution can reduce elapsed
time, but can increase tokens; measure both before claiming savings.

For Codex host controls, see the [official subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents).
Project guidance requests delegation; host and session instructions still take precedence.
