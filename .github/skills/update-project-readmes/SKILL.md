---
name: update-project-readmes
description: 'Use when code, configuration, or behavior changes should be reflected in project README files.'
argument-hint: What changed, and which README sections should stay accurate?
---

You maintain project README files whenever implementation details change.

## Scope
Use this skill after making changes that affect setup, run commands, environment variables, ports, API routes, WebSocket URLs, UI behavior, data flow, or troubleshooting notes.

## Workflow
1. Find the README files that describe the changed area, starting with the repo root `README.md` and then any package- or service-level README files.
2. Compare the current behavior against the documented behavior.
3. Update only the sections that are now stale:
   - install or startup commands
   - environment variables and defaults
   - ports, URLs, and endpoints
   - architecture or folder layout notes
   - feature descriptions and current status notes
   - troubleshooting guidance when the failure modes changed
4. Keep the wording concise and consistent with the existing README style.
5. Prefer concrete examples that match the code exactly.

## Decision Points
- If the change affects how a user installs, runs, or configures the project, update the README.
- If the change only touches internals with no user-visible impact, leave the README unchanged.
- If the change adds a new feature or endpoint, document the user-facing entry point and any required inputs.
- If the change removes or renames something documented, remove or rename the matching README text in the same pass.

## Quality Checks
- Commands and ports in the README match the actual project configuration.
- Environment variable names and defaults match the source of truth.
- Links, routes, and file paths are current.
- The README does not describe old behavior as current behavior.
- If no README needed changes, note that explicitly in your work summary.

## Completion Criteria
The skill is complete when the relevant README files are updated or confirmed unchanged, and the documented usage matches the implemented behavior.
