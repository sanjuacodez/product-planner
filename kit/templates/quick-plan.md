# Delivery plan

Keep this document short: one focused planning pass, no duplicated prose. The product
purpose, user, non-goals and constraints live in concept.md; exact wording lives in
request.md. Scope and acceptance live in features.json and tasks.json.

## Requirements

### FR-001 (F1): Replace with observable behavior

State exact interfaces, values, failure cases and acceptance from the original request.
Use one heading per requirement; put cross-cutting NFRs under a Global constraints heading.

## UX

Describe the relevant journey or CLI/API interaction; omit screens for non-UI work.

## Architecture

### Global constraints

State public contracts, security/data boundaries, affected paths and local verification.

### Quality and compliance profile

One decision per non-legal gate (`product-planner profile show`), each naming the gate id. Omit when no profile applies.

### F1: Affected components

State what changes, what is reused, dependencies and alternatives that matter.

## Risks

State concrete risks and how they will be checked. Security, migrations, broad API changes
or unresolved architecture require deeper analysis even on this track.

## Roadmap

### MVP

Deliver the accepted features; deferred scope remains in features.json.
