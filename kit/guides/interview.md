# Planning interview: how to ask the developer questions

The interview turns a one-line idea into an agreed feature list and a one-page concept brief, with as few questions as possible. All questions happen here, in planning. The build phase never asks.

## Rules for every question

1. **Draft first, then ask.** Before asking anything, write your best guess from the idea, the repository, supplied material and (if done) research. Ask only where your guess is uncertain **and** the answer would change scope, user experience, architecture, cost or acceptance. Everything else becomes a recorded assumption that the user sees at the final review.
2. **At most 5 questions per round, at most 3 rounds** (2 in the quick track). If more remain, keep the 5 with the biggest impact and record the rest as assumptions.
3. **Make answering cheap.** Every question offers 2–4 concrete options, marks one *(recommended)* with a short reason, and allows a custom answer. "Use your recommendation" must always be a valid reply. If the host has a structured multiple-choice question tool, use it; otherwise use the numbered format below.
4. **Never ask what is already known.** Reuse the user's words, earlier answers, README, code, configs and existing planning files. For existing products, read baseline.md first.
5. **Ask about behaviour, not implementation.** "What happens when a booking conflicts?" is useful. "Which ORM?" is the architect's call unless the user has a preference.
6. **Record as you go.** Answers go into features.json, concept.md, decisions.md and state options immediately, so an interrupted session resumes without asking again.

Numbered format when no question tool exists:

```
Round 1 of 3: who it's for and what it must do (reply "1b 2a 3 recommended", or write your own)

1. Who is the first user you are building for?
   a) Independent tutors managing their own students (recommended: matches your description)
   b) Tutoring agencies with several tutors
   c) Students looking for tutors
2. How do students pay?
   a) Outside the app; the MVP only books (recommended: avoids payment integration in the MVP)
   b) Card payment at booking
...
Assumed unless you say otherwise: web app, English only, email notifications.
```

## Step 1: pick the track (part of round 1)

Propose a track from the idea and repository, and confirm it with the first round of questions. Record it with `product-planner state set options.track <track>`.

| Track | When | What changes |
|---|---|---|
| `quick` | A small app, tool, prototype or a single feature; about 15 tasks or fewer | 2 rounds. Research off unless asked. UX direction goes inside prd.md (`ux` step skipped). Marketing skipped. Short architecture. |
| `standard` | A new product with several user journeys | 3 rounds, research offered, separate UX and architecture documents. |
| `existing` | Adding to or changing an existing codebase | Inspect the code and write baseline.md **before** round 1. Questions focus on the change, not on what the code already shows. |

## Step 2: the rounds

**Round 1: frame the product.** Track, primary user, the problem/job, how they solve it today, platform (web, mobile, desktop, CLI, API), and the single signal of success. Write the first concept draft and a draft feature list right after this round.

**Round 2: features.** Show the proposed feature list as a table: ID, feature, one-line description, suggested priority (must / should / could / won't now), suggested release (MVP / Next / Later), and where the idea came from (user, research, inferred). Ask the user to accept, change, defer or reject in one reply ("accept all", "F4 later, drop F6"). Then go deeper on the **accepted MVP features only**, asking about the gaps that matter most across all of them together:

| Feature detail | Ask only if unclear |
|---|---|
| Who uses it and with what role/permission | Several user types exist |
| Trigger and main flow (3–7 steps) | The flow has real choices |
| Data captured, shown or changed | Data shape affects storage, privacy or integrations |
| Edge and failure cases (conflicts, empty, invalid, offline) | They change behaviour the user would notice |
| Integrations (email, payments, auth providers, APIs) | Any external service is involved |
| "Done looks like" — observable acceptance | You cannot write a testable criterion yourself |

**Round 3: constraints and setup** (standard and existing tracks; in quick, show defaults to confirm in one line). Deadline, budget and paid-service limits, stack/hosting preferences, design style and accessibility, then the setup options in one batch with defaults: research and web access, browser access (`guides/browser-policy.md`), project memory, models per agent, commit-per-task and push/deploy permission, dashboard sections and auto-open.

## Step 3: stop when the scope is ready

Stop asking when `product-planner feature check` passes: every feature is accepted, deferred or rejected; at least one MVP feature is accepted; every accepted MVP feature has acceptance criteria and no open questions. If the user stops answering, move remaining questions into assumptions (with confidence and when to revisit) and keep going; do not loop.

## Step 4: confirm the concept brief

Show the one-page concept brief from concept.md (problem, users, MVP features, non-goals, success metric, key assumptions) and ask one question: "Is this the product? Reply yes, or tell me what to change." This is still requirements gathering; the single approval gate remains the whole-plan review at the end of pp-plan. After this, the PM, UX, architect and planner work from the agreed features without new questions unless something material is discovered, in which case batch it into the final review.

## Where answers go

| Answer | Saved with |
|---|---|
| Features, priorities, releases, flows, acceptance, open questions, assumptions | `product-planner feature add --file …` / `feature set F# status accepted` → features.json |
| Problem, users, value, non-goals, success metric | concept.md (concept brief template) |
| Track, research, browser, memory, git and dashboard options | `product-planner state set options.<key> <value>` |
| Planned models per agent | `product-planner state set models.<agent> <model-id>` |
| Push/deploy scope, stack preferences, constraints, assumptions | decisions.md |

features.json shape (see `templates/features.json`):

```json
{ "features": [{ "id": "F1", "title": "Book a session", "priority": "must", "status": "accepted", "release": "MVP",
  "story": "As a student, I want to book an open slot so that I get a confirmed lesson time.",
  "flow": ["Open the tutor's page", "Pick a free slot", "Confirm", "Both receive an email"],
  "acceptance": ["A booked slot disappears for other students", "Both parties receive a confirmation email"],
  "openQuestions": [], "assumptions": ["Time zone comes from the browser"], "source": "user" }] }
```
