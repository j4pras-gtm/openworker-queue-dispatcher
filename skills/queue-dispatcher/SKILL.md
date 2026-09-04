# Queue Dispatcher

Coordinate multiple worker sessions through a shared job queue and a check-in feed. The queue file is the durable source of truth — conversation history and memory aid recovery but never override it. This skill is **instance-agnostic**: it carries no paths; every location is resolved from a config file or CLI args at runtime, so it runs unchanged on any Coworker/OpenWorker instance.

## When to use

- User asks to "run the queue", "check the queue", "dispatch tasks", or "reconcile the queue".
- User asks to review the feed (`Flags.csv`) for state flags / job proposals.
- After an interruption: reconstruct state from the files alone.

## Resolving locations (do this first, every run)

All file locations come from a **config file** — never hardcode them. Default config path: `dispatcher-config.json` in the working folder (override with `--config PATH`). Shape:

```json
{
  "queue":       "<abs path to Job queue.csv>",
  "control":     "<abs path to dispatcher-control.json>",
  "feed":        "<abs path to Flags.csv>",
  "commonFlags": "<abs path to COMMON_FLAGS.md>",
  "activeLimit": 2
}
```

If no config exists, ask the user for the common folder and create one (this is the only setup step on a new instance). Every helper call passes `--config <path>` (or `--queue/--control/--feed` overrides).

## Helper script

`queue_ops.js` (bundled with this skill) performs all safe CSV operations — atomic writes (temp + rename), exact column handling, active-count math, batch-aware selection. Copy it into the common folder if not present. Never hand-edit the CSV from agent code. Commands: `status`, `dispatch`, `next --session NAME`, `set`, `park`, `reconcile`, `control get|set`, `feed review|accept|reject`.

## Queue columns

`Queue #`, `Task list`, `Session Name`, `Skill`, `Agent`, `QA`, `Destination folder /link`, `Batch`, `Flags`, `Update on the task`, `Comments from Dispatcher`, `User comments`, `Notified user via`

(`Batch` is optional; if absent, a `[TAG]` prefix on `Task list` is used as the batch tag.)

**Write ownership (hard rule):**
- Dispatcher owns: `Flags` (transitions), `Comments from Dispatcher`.
- Worker owns: `Update on the task` **for its own row only**.
- Nobody (agent) ever writes: `User comments`, `Task list`, `Session Name`, `Skill`, `Agent`, `QA`, `Destination folder /link`, `Notified user via`. Preserve byte-for-byte.

## Flags vocabulary

`PENDING` (blank = PENDING), `DISPATCHED`, `RUNNING`, `QA_PENDING`, `COMPLETE`, `BLOCKED_USER`, `FAILED`, `SKIP`, `PAUSED`, `PAUSED_KILL_SWITCH`, `NEEDS_RECONCILIATION`.
Active slots: only `DISPATCHED` + `RUNNING` count. Global limit: from config `activeLimit` (default 2).

## Dispatcher protocol

1. `status` — read control state first. If ≠ `ACTIVE`: report and stop (under `PAUSED` you may still `reconcile`).
2. `dispatch` — helper enforces the limit and is **batch-aware**: it continues an in-progress batch before starting a new one (lowest `Queue #` within each group). Sets `DISPATCHED` + timestamped note.
3. For each dispatched row, produce a **handoff payload** (markdown): task text, destination folder, required skill, QA requirement, batch tag, worker check-in instructions, kill-switch reminder. The user carries it into the named worker session. No inter-session messaging exists — never claim one was sent.
4. `reconcile` — flags orphaned `DISPATCHED`/`RUNNING` rows (no recent `[timestamp]` in `Update on the task`) as `NEEDS_RECONCILIATION`; resolution is a user decision recorded in `User comments`.
5. Report: active rows + in-progress batches, newly dispatched + payloads, parked rows with questions, reconciliation list.

## Feed review (state flags + job proposals)

The feed has two row types by `Task` prefix:
1. **State flags** — `Task` starts with `STATE FLAG: <legend status> — <result>`. A session's retrospective check-in, following the process in `COMMON_FLAGS.md` (legend `OPEN`/`IN PROGRESS`/`DONE`/`BLOCKED`/`DO NOT TOUCH`). These are CHECK-INS — report them, never dispatch them. Their `Context` carries `resume point / artifacts / dependency / follow-ups`; `follow-ups:` may name candidate jobs.
2. **Job proposals** — any other `Task`. Candidates for the queue.

Protocol (`feed review` then per-row decisions):
1. `feed review` lists open rows split by type.
2. State flags → summarize as check-ins (status, result, open dependencies, follow-ups). Do NOT create queue rows.
3. Job proposals → validate (empty `Task` ⇒ reject); dedupe against open queue rows ⇒ `DUPLICATE`; else `feed accept --feed-id N` creates a `PENDING` queue row in the next free `Queue #` (maps Task→Task list, Target Session→Session Name, Skill/QA/Destination across; Context → handoff payload; a `batch=TAG` token in Context becomes the `Batch` tag).
4. Review `SYNC` rows first (they're blocking someone), then `ASYNC` in `Feed #` order.
5. Report: state-flag summary, accepted (with Queue Ref), rejected/duplicate (reasons), stale PROPOSED rows (>7d) flagged for decision, and which source session waits on each SYNC verdict.

## QA routing

Rows reaching `QA_PENDING`: hand off to a QA session using the independent read-only QA skill (scorecard + defect ledger). Pass → `COMPLETE`; fail → `FAILED` with defect summary in `Update on the task`, awaiting explicit retry decision.

## Kill switch & pause

- Control file is the single global state; every session reads it on entry and at checkpoints.
- `PAUSED`: no new dispatch; active workers finish current step, checkpoint, hold.
- `KILL_SWITCHED`: no dispatch/retry/resume; active workers safe-stop at next checkpoint.
- Resume: user sets state back to `ACTIVE` AND explicitly authorizes which rows to resume.

## Shared artifacts folder

Multi-session work happens in a shared artifacts folder that all relevant sessions can access. The dispatcher assigns each task a `Destination folder /link` under it (one subfolder per task/source so parallel sessions don't collide). Sessions find each other's outputs there directly — no handoff file needed for data transfer. Lane discipline follows `COMMON_FLAGS.md`: mark your subfolder `IN PROGRESS` before writing; others don't touch it.

## Learning loop

Recurring operating problems → Gate 1 learning proposals via the normal controlled process. Promotion into skills happens only through the Gate 2 promotion skill on explicit user request with per-item approval. Never self-modify this skill.

## Safety boundaries

- No autonomous triggers, no folder watching, no daemons — every run is a bounded foreground command.
- No external notifications in v0.x.
- No edits to the live queue outside the write-ownership rules; feed edits follow feed ownership (own rows 1–10 / dispatcher 11–13, append-only).
- Dry runs always use a sandbox copy, never the live CSV.
