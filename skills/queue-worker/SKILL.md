# Queue Worker

The protocol for any session that runs tasks from the shared job queue. By design, **every worker checks in to both the queue row and the feed (`Flags.csv`) as part of its run** — this is what lets the dispatcher know what's running, delivered, or blocked. This skill is **instance-agnostic**: no paths are hardcoded; locations come from a config file or CLI args at runtime.

## Resolving locations (first step)

Read `dispatcher-config.json` (or take `--config PATH` / `--queue/--control/--feed` from your launch prompt) to find: the queue CSV, the control file, the feed CSV, and `COMMON_FLAGS.md`. If none is given, ask for the common folder. All helper calls pass `--config <path>`.

## Helper script

`queue_ops.js` (bundled with the dispatcher skill; copy it into the common folder if absent). You use: `set`, `park`, `next`, `control get`, and you append feed rows directly (see "State flag"). Never hand-edit the queue CSV from agent code.

## Write ownership (hard rule)

- You own: `Update on the task` **for your own row only**.
- The dispatcher owns: `Flags` transitions and `Comments from Dispatcher`.
- Nobody writes: `User comments` or any user-owned field. Preserve byte-for-byte.
- Never touch another session's row.

## Run protocol

1. **On start** — read the control file (`control get`). If `KILL_SWITCHED` → do not start; tell the user. If `PAUSED` → hold unless the user says proceed.
2. **Claim** — set your row `RUNNING`: `set --id N --flag RUNNING --update "started"`.
3. **Work** — do the task in your `Destination folder /link` (a subfolder of the shared artifacts folder). Mark your subfolder `IN PROGRESS` in `COMMON_FLAGS.md` before writing; others don't touch it.
4. **Checkpoints** — at each checkpoint re-read the control file. `KILL_SWITCHED` → stop at the next safe checkpoint, preserve partial state, leave the row `RUNNING` with a precise resume point in `Update on the task`. Stop is cooperative — a running shell command finishes first.
5. **Need user input?** — `park --id N --question "<exact question + minimal context>"` → row becomes `BLOCKED_USER`, slot released. Do NOT retry until the user answers in `User comments` or explicitly authorizes retry.
6. **Done** — `set --id N --flag QA_PENDING --update "<result + artifact path>"` if your `QA` column requires QA, else `--flag COMPLETE`. Then tell the user "check-in done" so they can trigger the next dispatcher run.

## State flag (feed check-in) — required at end of run

Append exactly ONE row to the feed (`Flags.csv`). Header:
`Feed #,Submitted,Source Session,Mode,Task,Target Session,Skill,QA,Destination,Context,Feed Status,Queue Ref,Review Note`

Fill only columns 1–10; leave 11–13 blank (dispatcher-owned):
- `Feed #` = current max + 1 (start at 1 if no data rows)
- `Submitted` = current ISO timestamp
- `Source Session` = your session name
- `Mode` = ASYNC
- `Task` = `STATE FLAG: <legend status> — <one-line result>` using the `COMMON_FLAGS.md` legend: `OPEN` · `IN PROGRESS` · `DONE` · `BLOCKED` · `DO NOT TOUCH`
- `Target Session`, `Skill`, `QA`, `Destination` = blank
- `Context` = `resume point: <exact next step or n/a> | artifacts: <paths or none> | dependency: <what it's blocked on, or none> | follow-ups: <concrete next jobs or none>`
- `Feed Status`, `Queue Ref`, `Review Note` = blank

Write safety: re-read the feed immediately before writing; append your row only; preserve every existing byte. Never edit or delete other sessions' rows.

## Batch continuation

If your task carries a `Batch` tag, keep working through that batch: after checking in on one row, ask the user to trigger the dispatcher (or use `next --session <you>` to see your next same-batch row). The dispatcher prefers continuing your in-progress batch over starting a new one.

## Proposing follow-up jobs

For each concrete follow-up you can name, append ONE more feed row (not a state flag): fill columns 1–10 with `Task` = the job, optional `Target Session`/`Skill`/`QA`/`Destination`, and `Context` including a `batch=TAG` token if it belongs to a batch. Leave 11–13 blank. Use `Mode=SYNC` only if a verdict is needed before something else proceeds. No vague or speculative work.

## Safety boundaries

- No autonomous triggers, no daemons — bounded foreground commands only.
- No external notifications.
- Cooperative stop only; never force-interrupt yourself mid-command.
- Respect every `DO NOT TOUCH` / `IN PROGRESS` flag in `COMMON_FLAGS.md` — those are other sessions' lanes.
