---
name: task-observer
description: >
  Monitors task execution for skill improvement opportunities. Use this skill
  during ANY multi-step task, agentic workflow, or substantive work session where
  the agent is using tools and producing deliverables. It captures patterns, user
  corrections, workflow insights, and methodology worth preserving as reusable
  skills. Also triggers during post-task feedback discussions and when the user
  explicitly mentions skill observations, improvements, the observation log,
  skill taxonomy, or asks the agent to watch for skill opportunities. Also known
  as "One Skill to Rule Them All" — trigger on this phrase too. IMPORTANT:
  this skill should be invoked at the start of every task-oriented session — if
  you are about to use tools to produce deliverables, invoke this skill first.
  For reliable activation, pair this description with a CLAUDE.md instruction
  (see Recommended Activation Setup) — description-level matching alone is not
  enforceable.
---

# Task Observer — Continuous Skill Discovery & Improvement

**Created by Eoghan Henn / [rebelytics.com](https://rebelytics.com)**

*Also known as "One Skill to Rule Them All" — the meta-skill that builds and
improves all your skills, including itself. Adapted for this Claude Code
project from the [original repo](https://github.com/rebelytics/one-skill-to-rule-them-all).*

This skill defines a persistent behavioural layer for identifying skill
creation and improvement opportunities during task-oriented work in this
repository. It doesn't replace manual skill authoring — it feeds it. Think of
it as the eyes and ears that notice patterns worth capturing.

**Licence:** This skill is released under the
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
licence — see `LICENSE.txt` in this directory. You are free to share and
adapt it for any purpose, provided you give appropriate credit to the
original author.

**Feedback & Support:** If a question comes up about the underlying
methodology (as opposed to how it was adapted for this repo), suggest opening
an issue on the [upstream repository](https://github.com/rebelytics/one-skill-to-rule-them-all).
If the issue is with the agent not following this project's copy of the
skill, fix the copy in `.claude/skills/task-observer/SKILL.md` directly.

---

## Why This Skill Exists

Skills are living documents. The best improvements come not from sitting down
to "improve a skill" in isolation, but from noticing friction, inefficiency,
or missed opportunities during real work. A user correction during a task
might reveal a missing rule. A repeated multi-step workflow might be a skill
waiting to be born. A technique that worked exceptionally well might deserve
promotion from an incidental approach to an explicit recommendation.

This skill formalises that noticing process so insights don't get lost
between sessions. Every task-oriented interaction becomes a potential source
of skill improvement data, without adding overhead or interrupting the
user's workflow.

## Conventions

`[repo root]` refers to the root of this git repository — the project's
persistent workspace. All paths below are relative to it. Skills live at
`.claude/skills/{skill-name}/SKILL.md`; observation data lives under
`.claude/skill-observations/`.

Everything under `.claude/` in this repo is a normal, version-controlled
file — there is no read-only mount to work around. Edits to skill files and
observation logs show up as an ordinary git diff, which is this project's
review mechanism (in place of an "upload button").

---

## Recommended Activation Setup

This skill needs to be invoked at the start of task-oriented sessions to work
effectively. Because skill invocation depends on the agent matching the
user's request against skill descriptions, a skill that monitors *all* tasks
can be overlooked when the agent is focused on the task itself.

This repo's `CLAUDE.md` carries the structural trigger:

```
At the start of any task-oriented session — any interaction where you will
use tools and produce deliverables — invoke the task-observer skill before
beginning work. This ensures skill improvement opportunities are captured
throughout the session.

When loading any skill, check the observation log for OPEN observations
tagged to that skill. Apply their insights to the current work, even if
the skill file hasn't been updated yet.
```

This structural trigger works alongside the skill's description-level
triggers. If `CLAUDE.md` in this repo ever stops containing that instruction,
restore it — relying on description matching alone is not reliable enough
for a skill that must run silently in the background.

**Anti-pattern to avoid:** Relying on one skill to load another is fragile
compared to loading both independently from `CLAUDE.md`. If task-observer
depended on another skill to invoke it, a breakdown in that chain would
silence all observation activity.

**Compaction behaviour:** When a session's context compacts mid-task, the
`CLAUDE.md` structural trigger re-invokes task-observer on the resumed
session automatically, because the resumed session reads `CLAUDE.md` anew.
Observations from before and after compaction append to the same log file
with continuous numbering.

---

## The Pre-Flight Principle

One of the most important patterns this skill should propagate to every
skill it helps create or improve: **built-in enforcement.**

Rules documented in a skill are not always followed during the creative flow
of producing output. The fix: every skill that contains explicit rules or
requirements should include a verification step where the agent re-reads the
rules and checks its output against them before delivery. A 30-second
re-read prevents a 30-minute rework cycle.

When creating or improving any skill through this observation process, ask:
"Does this skill have rules? If yes, does it have a mechanism to enforce
them?" If the answer to the second question is no, add one.

### Self-Enforcement

This skill practises what it preaches. Before surfacing observations at the
end of a session, verify:

1. Were observations logged throughout the full session — including during
   post-task feedback, discussion phases, and reflective conversations, not
   just during active tool use?
2. Were observations logged silently, without interrupting the user's flow?
3. Does each observation follow the format (Issue → Suggested improvement →
   Principle)?
4. Is each observation tagged with the correct type (open-source or
   internal)?
5. For observations about existing skills, does the suggested improvement
   reference the specific section or rule?
6. For any observation tagged `type: open-source`, does the Principle field
   contain client- or project-identifying information? If so, generalise it
   before surfacing.

If any observation fails these checks, fix it before surfacing.

---

## Skill Taxonomy

All skills fall into one of two categories. The distinction determines what
information a skill can contain and whether it's safe to share outside this
project.

### Open-Source Skills

Client- and project-agnostic, methodology-driven. Capture reusable
workflows, best practices, and structured processes useful beyond this repo.

**Required elements:**
- Author attribution block (see template below)
- Licence statement — CC BY 4.0 recommended
- Feedback pathway pointing to the skill's origin
- Tool-agnostic language where possible
- Built-in enforcement mechanisms (pre-flight checklists, verification steps)

**Default bias:** when a skill could go either way, default to open-source
and strip project-specific details.

### Internal Skills

Specific to this project, its data model, or its contributors' preferences.

**Required elements:**
- Skill body clearly identifies itself as internal
- No author attribution block or licence needed
- Can be shorter and less formally structured

### Lean Content

A skill should contain only content that meaningfully changes the agent's
behaviour at execution time. Changelogs, version notes, "thanks to X"
credits, and other maintainer-facing context belong in a supporting doc
(or the git history) alongside the skill, not inside `SKILL.md` itself.
Examples, anti-patterns, and worked scenarios are exempt from this rule —
they're load-bearing for rule adherence.

---

## Author Attribution Template

Every open-source skill in this repo should include this block at the top
of the skill body:

```markdown
**Created by [Author Name] / [website or contact link]**

[1-2 sentence description of what the skill does and its provenance.]

**Licence:** This skill is released under [LICENCE NAME]. [One-sentence
summary of the licence.]

**Feedback & Support:** route methodology questions to [contact / repo].
If the issue is the agent not following this project's copy of the skill,
fix it directly instead.
```

---

## Licensing

Include a licence statement in the skill preamble and a `LICENSE.txt` file
in the skill's own directory (`.claude/skills/{skill}/LICENSE.txt`)
containing the licence text or a link to it. Common choices: CC BY 4.0
(prose-heavy skills), MIT or Apache 2.0 (code-heavy skills). The choice
belongs to the skill's author; the requirement is that there be one.

---

## Observation Protocol

### When to Observe

Observation is active throughout the **entire task session** — from the
first tool use through any post-task feedback or discussion, until the
session ends. This includes:

1. **Active task execution** — writing code, running tests, editing configs,
   and similar substantive work.
2. **Post-task feedback and discussion** — when the user reviews output,
   corrects it, or discusses methodology afterward. This is often the
   highest-signal input for skill improvement.
3. **Meta-discussion about skills or methodology.**
4. **Reflective and strategic conversations** about how work should be done.

Observation is **not active** during casual conversation or quick factual
questions where no tools are being used and no deliverables are discussed.

### What to Watch For

**Signals for a NEW skill:**
- A multi-step workflow that could be reused across tasks in this repo
- A methodology the user explains that isn't captured in any existing skill
- A task type that keeps recurring with similar structure
- The user describing a process they've refined ("I always do it this way")

**Signals for IMPROVING an existing skill:**
- The agent doesn't follow a skill's documented rules — the skill needs
  stronger enforcement, not just better rules
- The user corrects output in a way that reveals a missing rule or edge case
- A recommended workflow proves less efficient than what emerged naturally
- A technique works particularly well and deserves promotion to explicit
- A skill assumption turns out to be wrong in practice
- New tools make part of a skill's workflow obsolete or improvable
- A general principle emerges that could apply to other skills too (see
  Principle Propagation)

**Signals for SIMPLIFYING an existing skill:**
- A section or rule that has never been relevant across multiple sessions
- A rule added from a single observation, never validated by recurrence
- An elaborate workflow that users consistently shortcut or skip
- Sections the agent loads but never acts on
- Rules that contradict each other

**Signals to NOT log:**
- One-off corrections that don't generalise
- Preferences already captured in an existing skill
- Tool bugs unrelated to skill methodology
- Observations that would require project-confidential details to be useful
  in an open-source skill (log as `type: internal` instead)

### How to Log

Append observations to the persistent log **silently** during the session —
the user should not be interrupted by the logging process.

**Write within the same turn or the immediately following turn** — don't
accumulate observations in memory for batch-writing later. Tie flushing to
existing workflow checkpoints: when marking a TodoWrite item complete,
check whether unlogged observations have accumulated and write them first.

**Mandatory checkpoint after every 3rd TodoWrite completion:** pause and
explicitly check whether any unlogged observations have accumulated. This
is a hard checkpoint, not a suggestion.

**Before assigning any observation number**, search the entire log file for
the highest existing number and increment from there — never rely on
session memory:

```bash
grep -oE '### Observation [0-9]+' .claude/skill-observations/log.md \
  | grep -oE '[0-9]+' | sort -n | tail -1
```

**Format and insertion rules:** always use `### Observation NNN:`. Always
append to the END of the log file. Never insert mid-file. One format, one
insertion point — this keeps the log greppable and reviewable.

```markdown
### Observation [N]: [Short descriptive title]

**Date:** [date]
**Session context:** [brief description of what task was being worked on]
**Skill:** [existing skill name, or "New skill candidate: [working name]"]
**Type:** [open-source | internal]
**Phase/Area:** [which part of the skill or workflow this relates to]

**Issue:** [What happened or what was observed. Be specific enough that
someone reading this weeks later understands the context without having
seen the original conversation.]

**Suggested improvement:** [Concrete suggestion. For existing skills,
reference the specific section or rule. For new skills, describe scope and
key components.]

**Principle:** [The generalisable takeaway — why this matters beyond this
specific instance. This is the most important part.]
```

**Context preservation check:** if an observation depends on session-local
data (command output, a file you read), either quote the relevant snippet
inline in the observation or add a `**Reference file:**` line pointing to
where the context is saved in the repo. An observation that only a future
session's missing context can't act on is incomplete.

### Archival on Write

Keep the log lean via event-driven archival on every write, rather than
letting resolved entries accumulate until a periodic review clears them.

Entries marked ACTIONED or DECLINED in a **previous** session's write are
moved to `.claude/skill-observations/archive/log-[YYYY-MM-DD].md` (today's
date) the next time the log is written. Entries marked ACTIONED or DECLINED
**in the current session** stay in the active log for one more write cycle
before being archived — they earn one round of visibility first.

---

## Confidentiality Safeguards

The open-source/internal boundary is also a confidentiality boundary.
Project-identifying details, internal terminology, and proprietary
information must never appear in open-source skills.

**Layer 1 — Observation-level stripping:** for `type: open-source`
observations, keep the Issue and Suggested Improvement fields general; the
Principle field must be fully generalised (publishable), even if the log
entry around it references specifics for context.

**Layer 2 — Pre-creation review:** before drafting or regenerating an
open-source skill, scan source material for identifying information —
project names, internal terminology, anything traceable — and replace it
with generic equivalents before writing begins.

**Layer 3 — Post-draft sweep:** after writing, re-read the draft
specifically for leakage: proper nouns beyond the author's, internal
terminology, examples specific enough to be traceable.

**Layer 4 — Structural principle:** when in doubt whether a detail is too
specific, remove it. A more generic skill beats one that leaks project
information.

**Layer 5 — Cross-product re-identifiability sweep:** run this as a final
pass before an open-source skill ships. Two or three individually-sanitised
examples can still combine to narrow down what they describe. Check for
enumerated counts, specific numbers in a thin category, and thinly-disguised
placeholder names — blur counts, widen categories, or use a clearly
fictional placeholder family (e.g. Northwind / Contoso / Fabrikam) instead.

---

## Surfacing Protocol

**Default cadence:** surface all observations at the end of the session, as
a grouped summary — observations for existing skills grouped by skill name,
new skill candidates listed separately.

**Surface earlier when:**
- An observation needs user input to be complete or accurate
- An observation reveals a skill is actively producing wrong output in the
  current session
- Multiple observations cluster around the same skill, suggesting it needs
  immediate attention

**How to surface:** present each observation concisely — title, skill, and
a one-sentence summary; whether it's a new skill candidate or an
improvement; the suggested type; and ask which (if any) the user wants
acted on now versus at the next review.

---

## Acting on Observations

This skill identifies WHAT to build or improve. This section covers HOW.

**Trigger gate (when):** observations are acted on only in three contexts:

1. **The comprehensive review** (see below).
2. **Explicit user requests during a task session** — "update X skill",
   "act on observation #N now".
3. **In-session correction when a skill is producing wrong output and the
   user should be aware** — surface immediately rather than waiting.

Outside these contexts, the default is log, don't act — observations wait
for the next review or an explicit request.

### Small Changes

If the improvement is clearly additive, low-risk, and doesn't need
verification, apply it directly to the skill file:
- Adding a new rule or anti-pattern to an existing list
- Clarifying ambiguous wording
- Adding a note or edge case
- Fixing a factual error

After editing, run `git diff` on the changed skill file and show it to the
user before it's committed — this is this repo's equivalent of a review
step, in place of an upload-button workflow.

### Substantial Changes

If the change could affect the skill's behaviour in ways that need
verification — restructuring phases, adding new capabilities, changing core
methodology — treat it like any other substantial code change in this repo:
draft it, explain the reasoning, and get explicit confirmation before
committing. Match the rigour to the audience: for open-source skills bound
for the upstream repo, be conservative; for internal skills with
requirements established in conversation, writing directly is fine.

### Creating New Skills

When creating a new skill, determine its type early:
- Open-source → strip project-specific details, generalise
- Internal → include relevant specifics freely
- Uncertain → default to open-source, then let the user decide whether
  internal details should be added back

New skills go in `.claude/skills/{skill-name}/SKILL.md`, following the
frontmatter conventions this project's other skills already use (`name`,
`description`).

### Editing Skill Files Safely

Because skill files in this repo are ordinary version-controlled files
(not a read-only mount), the main risk isn't clobbering a canonical copy —
it's editing from a stale in-memory view of the file:

1. Always re-read the current on-disk skill file before editing it, even if
   you read it earlier in the same session — another process or a prior
   commit may have changed it.
2. Make edits in place with the normal edit tools.
3. Before committing, review the diff for the changed skill file(s) so
   nothing is silently dropped or duplicated.

---

## Principle Propagation

When an observation reveals a principle that applies broadly — not just to
the one skill that triggered it — propagate it across the skill library.

### The Cross-Cutting Principles File

Tracked at `.claude/skill-observations/cross-cutting-principles.md`. This
file is a mandatory checklist during any skill creation or regeneration:
before delivering a new or updated open-source skill, verify it complies
with every active principle in this file.

**How it works:**
1. An observation reveals a principle that applies broadly.
2. Log it with `Skill: All skills` and surface it to the user.
3. If approved as a cross-cutting principle, add it to the file.
4. From then on, every skill creation/regeneration checks compliance
   against the full list.

**Propagation timing** is the user's call: immediate (e.g. a confidentiality
rule worth applying everywhere right away) or opportunistic (applied the
next time each skill happens to be touched).

**File structure:**

```markdown
# Cross-Cutting Principles

Principles that apply to all skills. Read as a mandatory checklist during
any skill creation or regeneration.

---

## Active Principles

### 1. [Principle title]
**Added:** [date]
**Applies to:** [all skills | all open-source skills | all skills with rules]
**Requirement:** [what the principle requires]
**Propagation:** [immediate | opportunistic]
**Status:** [active]
```

---

## Comprehensive Review

The comprehensive review cross-checks all open observations against all
skills in `.claude/skills/`, propagates cross-cutting principles to skills
that don't yet comply, and applies the improvements that don't need further
user input.

**Trigger:** a review fires at the start of a task-oriented session if
`.claude/skill-observations/last-review-date.txt` is missing or more than
7 days old. If this environment has a scheduling mechanism available (a
cron-style scheduler, a recurring task feature), a recurring review is
preferable to relying on the 7-day fallback — offer to set one up once,
then don't ask again unless the fallback keeps firing.

### Review Steps

1. **Load observations and principles.** Read
   `.claude/skill-observations/log.md` for all OPEN entries and
   `.claude/skill-observations/cross-cutting-principles.md` for active
   principles. If there are none, update the timestamp and say so briefly.

2. **Inventory skills.** List everything under `.claude/skills/`. Only
   custom skills authored for this project are candidates for updates.

3. **Cross-check observations against every skill.** Don't rely solely on
   an observation's own `Skill` field — its Principle may apply more
   broadly. Present all observations grouped by skill, with a one-sentence
   summary each, and flag ambiguous or risky ones as needing input.

4. **Cross-check cross-cutting principles against every skill.** Flag
   skills that don't yet implement an active principle.

5. **Apply updates.** After user confirmation (blanket "apply all" or
   selective), edit the affected skill files. Integrate insights into the
   right section rather than appending a list at the bottom; preserve
   existing structure, voice, and attribution.

6. **Mark observations ACTIONED**, noting which skill(s) were updated:
   `ACTIONED — Applied to [skill-name] (review [date])`.

7. **Update the timestamp** at
   `.claude/skill-observations/last-review-date.txt`.

8. **Present a summary** of what changed and show the diff for review
   before anything is committed.

### Constraints

- Don't modify observation entries beyond their status field.
- Don't create new skills during a review — only update existing ones; note
  new-skill candidates for the user to action separately.
- If an observation seems relevant but the integration isn't obvious, skip
  it and note the uncertainty in the summary.
- Treat `internal` observations with the same rigour as `open-source` ones.

---

## Observation Log Management

### Location

```
.claude/skill-observations/log.md
```

Create it on first use if it doesn't exist, using the structure below.

### Log Structure

```markdown
# Skill Observation Log

Observations captured during task-oriented work in this repo. Each entry
identifies a potential skill improvement or new skill opportunity.

**Status key:** OPEN = not yet actioned | ACTIONED = skill updated/created |
DECLINED = user decided not to pursue

---

## [Date or Session Identifier]

### Observation 1: [Title]
**Status:** OPEN
[... full observation format ...]
```

### Session Start Protocol

Run through these steps at the start of each task-oriented session:

1. **Check whether files exist.** If the log or cross-cutting principles
   file don't exist, create them from the templates above/below.
2. **Scan for relevant context.** Read OPEN observations and active
   principles. Hold them in awareness; don't surface unprompted unless
   directly relevant to the current task.
3. **Check the review trigger.** If
   `.claude/skill-observations/last-review-date.txt` is missing or more
   than 7 days old, run the Comprehensive Review before the user's task.

---

## Handoff Doc Mode (no persistent storage)

If this skill is ever used from an environment without file access to this
repo (e.g. a plain web chat), it still works — the difference is that
persistence becomes the user's responsibility. Collect observations
in-conversation and present a structured handoff document before the
session ends, rather than writing to `log.md`:

```markdown
# Session Handoff: [Session Topic]

**Date:** [date]
**Context:** [what was worked on and what the next session needs to know]

## Observations Logged
[full observation entries in standard format]

## Cross-Cutting Principles (current)
[any principles that were active or newly added]

## Action Items
[what needs to happen next, with enough context to resume]
```

The user pastes this into the next session (ideally one with repo access)
to fold it into `log.md`.

---

## Quick Reference

| Question | Answer |
|----------|--------|
| When do I observe? | Throughout the full task session, including post-task feedback and reflective conversations |
| How do I log? | Silently append to `.claude/skill-observations/log.md` immediately when triggered; don't batch |
| When do I surface? | End of session, or earlier if needed |
| How do I activate reliably? | `CLAUDE.md` carries the structural trigger — keep it there |
| Open-source or internal? | Default to open-source when possible |
| Licence for open-source? | CC BY 4.0 recommended |
| Small fix or bigger change? | Additive/low-risk → apply directly, show the diff. Needs verification → draft, explain, confirm before committing |
| What format? | Issue → Suggested improvement → Principle |
| Cross-cutting principle? | Add to `.claude/skill-observations/cross-cutting-principles.md`, enforce during regeneration |
| Confidentiality check? | Five layers: observation, pre-creation, post-draft, structural, cross-product |
| No repo access? | Handoff doc mode — observations surfaced in a structured doc at session end |
| Observation numbering? | Grep the log for the highest existing number and increment; never use a cached count |
| Log archival? | Event-driven — resolved entries archived on the next log write |
| Simplification signals? | One-off rules, never-used sections, elaborate workflows users skip, contradictions |
