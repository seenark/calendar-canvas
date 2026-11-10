# Issue tracker: Beads

Issues live in Beads (`bd` CLI), database at `.beads/`. Run from the repo root. Use `--json` where supported.

## When a skill says "publish to the issue tracker"

`bd create "<title>" -d "<body>" --json`. Add labels with `bd label add <id> <label>`. Express blocking with `bd link`.

## When a skill says "fetch the relevant ticket"

`bd show <id> --json`. List with `bd list --json`; search with `bd search <query>`.

## Conventions

- Triage roles are Beads labels (see `triage-labels.md`). Labels are free-form; no pre-creation needed.
- Comments: `bd comment <id> "<text>"`.
- Close: `bd close <id>`.
- Specs/parents: create a parent bead; implementation tickets are child beads (`bd children <id>` lists them).
- Claim before work: `bd update <id> --claim`.
