<!-- md-tickets AGENTS.md version 9 -->
# Tickets

This folder is a ticket board managed with md-tickets. Every ticket is a Markdown file, and the
folder it lives in is its state. The app shows the board live, so any change you make on disk
appears immediately.

## Structure

```
<state>/<priority>_<title>.md
```

- **State folders**, in board order: `refinement` → `todo` → `progress` → `qa` → `done`.
  A folder may be missing until a ticket first goes there; create it then.
- **Priority** is the number before the first underscore. Lower numbers come first: `01` is
  the top of its column.
- **Title** is the rest of the file name with `_` for spaces, e.g.
  `todo/03_fix_login_redirect.md` is "fix login redirect", third in `todo`.
- The file content is the ticket description in Markdown. Images can be referenced relative to
  the ticket file, e.g. `![](../assets/screenshot.png)`. Images pasted in the app are saved to
  `assets/`, which is never a state folder.

## Workflow

- `refinement` holds tickets that aren't ready to implement yet. Refine them (see below); a human
  reviews them there and moves them to `todo`.
- `todo` holds tickets ready to implement.

To implement a ticket:

1. Pick the ticket with the lowest number in `todo` that has no open questions, unless told
   otherwise. Never pick one from `refinement`.
2. When you start working on it, move it to `progress`.
3. When the work is finished, move it to `qa` and add a short summary of what you changed and
   how to verify it at the end of the ticket.
4. Never move a ticket to `done` yourself; a human does that after review.
5. Never implement a ticket that has open questions (an `## Open questions` section with
   entries), and never move one out of `refinement`; a human answers them first.

If the prompt says the app moves and commits the ticket, don't do that yourself.

## Rejected tickets

A ticket that did not pass review is sent back to the top of `todo` with a
`## Rejected (<date> <time>)` section appended, one per rejection. Read these sections before
anything else: the latest one says what is still wrong, so handle it first. Keep the sections and
add your summary below them.

## Refining a ticket

A ticket in `refinement` is not ready to implement yet. Look it over and make it ready:

- Read the ticket and the relevant code, but don't change any code.
- Rewrite the ticket so it is ready to implement: clear goal, concrete behaviour, affected
  files/areas, edge cases, open questions, and how to verify it. Keep the original intent and
  wording where it's already clear.
- List anything that needs a human decision under `## Open questions`, one list item per
  question; the board marks tickets that have any. When you have a suggestion for a question,
  end it with `Suggestion: …` (the answer itself), so the user can accept it in one click. When
  there are no questions, leave the section out entirely: never write it with "None", "n/a" or
  similar.
- A ticket sent back for another refinement has `## Re-refine (<date> <time>)` sections, one per
  request. Handle the latest one first: it says what the refinement should change. Keep the
  sections in the ticket, like Rejected sections.
- Set `model` in its front matter to the Claude model that fits the work best (see "Model"
  below), replacing an earlier choice unless the latest Re-refine section asks to keep it.
- Keep the ticket in `refinement` the whole time; don't move it to another state. When done, add
  `refined: true` to its front matter (creating the front matter if needed, keeping the other
  keys), so the board shows it is ready for review.

## Reordering a column

When asked to reorder a column, decide in which order its tickets should be worked on:

- Read the tickets of the column (and the code where it helps), but don't change any code.
- Only change the order: renumber the files `01, 02, …` as described under "Moving and
  renumbering". Don't edit ticket contents, change titles or move tickets to another column.
- By default, tickets other tickets depend on come first, then bugs, then small quick wins, then
  the rest. Rejected tickets stay at the top of `todo`. A hint from the user overrides these
  defaults.
- End your last message with one line per ticket you moved, `Moved <title>: <reason>`, where
  `<title>` is the title part of the file name and `<reason>` is one short line.

## Agent instructions

A ticket can start with front matter that tells you what to do once the work is finished and the
ticket is in `qa`:

```
---
commit-after-done: true
run-after-done: [test, rebuild-and-launch]
---
```

- **`commit-after-done: true`** – commit your changes, including the ticket move and summary,
  with a message describing the change.
- **`run-after-done: [<script>, …]`** – run each of these `package.json` scripts with
  `npm run <script>`, in the order listed, and mention a failing one in your summary. Skip the
  scripts the prompt says the app runs, and those the prompt says aren't available (say so in your
  summary).
- The older **`rebuild-and-launch-after-done: true`** means `run-after-done: [rebuild-and-launch]`.

None of them applies to a refinement. Keys that are missing or not `true` mean: don't. Leave the
front matter in place when you edit the ticket.

## Model

`model: opus`, `model: sonnet` or `model: haiku` in the front matter says which Claude model
works on the ticket; the app starts Claude with it. Without the key, Claude uses its default
model. When refining, pick:

- **`haiku`** for small, clear changes: a text, a style, a simple fix.
- **`sonnet`** for normal features and bugs.
- **`opus`** for big or tricky work: many files, an unclear cause, design decisions.

## Steering

`.steering/refinement.md` and `.steering/execution.md` hold the user's own instructions. If
one exists and isn't empty, follow `refinement.md` when refining a ticket and `execution.md`
when implementing one. The rules in this file take precedence.

## Tags

A ticket can list tags in its front matter, next to the agent instructions:

```
---
tags: [ui, bug]
---
```

Keep the `tags` key when you edit the ticket. Tags are case-insensitive and contain no commas;
reuse the spellings listed under `tags` in `.md-tickets.json`. The app adds new tags there.

## Moving and renumbering

Priorities in a column are always `01, 02, 03, …` without gaps. Every change to a column
renumbers it:

- **Moving to another state:** the ticket goes to the bottom of the target column. Then renumber
  both the column it left and the column it joined.
- **Reordering within a column:** put the ticket at its new position, then renumber the column.
- **New ticket:** add it at the bottom of its column as `<next number>_<title>.md`. If
  `.templates/` has a fitting template (e.g. `feature.md`, `bug.md`), start from its content
  and replace `{{title}}` with the ticket title.

Numbers have at least two digits (`01`); use three once a column has 100 or more tickets.
Keep the title part of the file name unchanged when renumbering or moving.

Example: moving `todo/01_add_search.md` to `progress`, which already holds `01_fix_login.md`:

```
todo/01_add_search.md   →  progress/02_add_search.md
todo/02_update_deps.md  →  todo/01_update_deps.md
```

Rename files in two steps (to a temporary name first) when two of them would swap names.
