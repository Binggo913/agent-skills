# Contributing

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md) | [Repository](README.md)

## Scope and layout

Keep each skill focused on a recognizable task. A skill root contains
`SKILL.md`; add scripts, references, examples, or human onboarding only when
they have a concrete use. Do not create empty directories or boilerplate pages
to satisfy a template. This repository does not require a shared runtime.

When adding a skill, add one concise row to both root catalogs. State its actual
requirements and support boundaries in the skill, not in the root README.

## Documentation ownership

| Document | Owns | Does not own |
|---|---|---|
| Root `README*` | Library overview, catalog, registration/update concepts, navigation | One skill's flags, platforms, troubleshooting, or workflows |
| Skill `README*`, if useful | Human orientation and a short practical starting point | A second full command manual or a mandatory agent read |
| `SKILL.md` | Selection, essential permissions/constraints, mode routing | Installation essays, exhaustive schemas, copied implementation detail |
| `references/` | The detailed procedure/schema for its particular mode | Repeating the entire skill entrypoint or unrelated modes |
| Scripts / `--help` | Executable behavior and CLI syntax | Host-agent installation assumptions |

Give each substantial detail one home and link to it elsewhere. Keep root
English/Chinese catalogs and navigation aligned. If human-facing bilingual pages
exist, keep their capabilities, constraints, and examples consistent; supporting
agent references need not be translated just to multiply files. Keep linked
existing paths stable unless there is a clear reason to move them.

## Changes and examples

- Describe what is implemented separately from theoretical/adaptable and untested
  paths. Do not promote a local/mock check into native or user acceptance.
- Preserve invocation policy unless a change is requested. Metadata support is
  agent-dependent; do not promise universal automatic discovery or zero overhead.
- Keep examples generic and safe to adapt. Quote shell path placeholders; never
  commit real credentials, personal host lists, exports, or machine-specific data.
- Installing/invoking a skill does not authorize secrets export, application
  interruption, remote changes, or destructive actions. Put concrete permission
  boundaries in the skill that performs them.
- Reflect CLI changes in that skill's relevant reference/help; do not grow a new
  repository-wide workflow for a local change.

## Validation: only what the change needs

For documentation-only edits, check changed links/paths, example syntax against
the existing CLI, and bilingual meaning. Do not launch applications, touch user
credentials/data, or run feature suites merely to validate prose.

For behavior changes, retain the smallest meaningful regression checks for the
affected behavior or concrete risk. Avoid duplicate tests and exhaustive
unrelated edge cases. Do not turn optional diagnostics/previews into mandatory
per-use rituals. Report what
was actually checked and what remains unverified; add native checks only when
needed for the affected platform boundary.
