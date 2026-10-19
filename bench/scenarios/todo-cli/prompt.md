I want a small command-line to-do app in Node.js (no npm dependencies).

Create `todo.js` at the project root, run as `node todo.js <command>`. Store todos in `todos.json` in the current working directory (create it when needed).

Commands:
- `add "<text>"` adds a todo and prints `Added <id>: <text>`. IDs start at 1 and are never reused, even after removal.
- `list` prints one line per todo in ID order: `<id> [ ] <text>`, or `<id> [x] <text>` when done. With no todos it prints `No todos`.
- `list --pending` shows only todos that are not done.
- `done <id>` marks a todo as done and prints `Done <id>`.
- `remove <id>` deletes a todo and prints `Removed <id>`.

Errors: an unknown ID, missing text, or an unknown command prints a message to stderr and exits with code 1. Successful commands exit with code 0.

Please build it, test it, and tell me when it's done.
