# Quality profiles: platform and regulatory checks

A quality profile lists the checks a product must meet because of where it ships and whose data it handles: platform standards (WordPress coding standards and PHPStan for a plugin, the mandatory privacy webhooks for a Shopify app) and regulations (GDPR, UK GDPR, CCPA/CPRA, India's DPDP Act, PCI DSS, HIPAA, COPPA). Regulations follow where the users and their data are, not where the developer is.

## Profiles are folders, used like skills

Each profile is a folder with a `profile.json`: when it applies, how to detect it, official sources,
practical guidance and its gates. Three places are read, later ones overriding earlier ones:

- `kit/profiles/<id>/`: shipped with the kit.
- `~/.product-planner/profiles/<id>/`: your library, shared by all your projects.
- `.product-planner/profiles/<id>/`: this project only.

When a profile is selected it is installed as a skill for the installed tools
(`.claude/skills/pp-profile-<id>/SKILL.md`, `.agents/skills/pp-profile-<id>/SKILL.md`), so a model
keeps only its one-line description in context and reads the gates and guidance when the work
touches it. Unselected profiles cost no tokens; the CLI reads the folders, not the model.

**A platform or law the kit does not cover:** `profile new <id> --title "…"` scaffolds a project
profile. The researcher fills it from the official documentation (when it applies, detection
signals and request words, sources, gates with the architecture decision, acceptance and, for
automated gates, a command), `profile validate <id>` checks it, the user confirms it at the plan
review, and `profile save <id>` copies it to the library so the next project gets it for free.

## In planning

1. `product-planner check` fails when the request mentions a platform or regulated data and no profile is chosen (`profile none --because "…"` records that none applies). `product-planner profile detect` lists repository signals (a plugin header, `shopify.app.toml`, payment SDKs). `product-planner profile catalog` lists every profile and the questions to ask.
2. Ask the profile questions in the interview: platform or marketplace, where the users are, what personal data is handled, how payments work. Select with `profile set <ids> --because "<answers or evidence>"`. Profiles that extend another (WooCommerce extends WordPress) bring both sets of gates.
3. Verify each selected profile against its official sources during research (the catalog is a starting point; platform rules and laws change): `profile verify <id> --sources "url,url" --note "what was checked, what changed"`. Adjust a gate for the project with `profile gate <id> --command "…"`, or remove it with `--remove --reason "…"` after the user agrees.
4. The architect writes one decision per non-legal gate in the architecture's "Quality and compliance profile" section, naming the gate id. The planner links gates to tasks (`"gates": ["G-…"]`): tooling setup in the first epic, controls as their own tasks with tests. `product-planner check` fails while a gate lacks a decision or a task.
5. The final plan review shows the profile: which checks and laws apply and why, and the legal items.

## In build

- Automated gates run with `product-planner profile run <ids>` in each task that lists them and before the audit; new findings are fixed in that task. On an existing product, record the current findings with the tool's own baseline (for example `phpstan --generate-baseline`) so the rule is "no new findings".
- A task's verification needs a `gate G-…` check entry for each gate it lists.
- The final audit has a row for every non-legal gate and lists the legal items separately.

## Limits

The kit implements and tests technical controls: consent records, export and deletion across data stores, retention, encryption, access logging, platform conventions. It cannot establish legal compliance. Legal items (privacy notices, processor agreements, transfers, thresholds, registrations) are listed as "needs legal review" and are never marked passed. Catalog entries without a `lastVerified` date have not been checked by the kit maintainers.
