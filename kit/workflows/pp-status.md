---
name: pp-status
description: Show current planning/build progress and optionally open the dashboard.
---

# Status

Read the manual and run `product-planner status --json`. Summarize phase, planning steps, done/total, active/review tasks (with the agent and model working on them), ready work, blockers and next milestone. Use tasks.json and persisted docs as evidence. Regenerate the dashboard; use `dashboard --open` if the user asks to view it. If asked for specific data, add a suitable custom dashboard JSON section using verified project data and regenerate. Do not start build or alter task status just because the user asked for status.
