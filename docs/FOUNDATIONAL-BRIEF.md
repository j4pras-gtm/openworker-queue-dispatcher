# Foundational Brief: Queue Dispatcher

## Desired outcome

Coordinate multiple related and unrelated OpenWorker worker sessions through a queue order CSV in a shared common folder. The solution should begin small, improve through observed runs, and preserve explicit user control.

## Current shared artifact

The queue file has these columns:

`Queue #`, `Task list`, `Session Name`, `Skill`, `Agent`, `QA`, `Destination folder /link`, `Flags`, `Update on the task`, `Comments from Dispatcher`, `User comments`, `Notified user via`.

Some columns will not apply to every task or worker. Workers and the dispatcher must fill only fields relevant to their work and must preserve existing user comments and task history.

## Required behavior

- Scan the common folder for the queue CSV.
- Identify valid pending tasks.
- Enforce a global limit of no more than two active tasks at one time.
- Route each task to its intended session where a supported handoff mechanism exists.
- Require every worker to update its queue row after a run and check in before accepting another queue task.
- Park tasks requiring user clarification, credentials, decisions, approvals, or missing information for later review.
- Record exact user questions and minimal context without repeatedly retrying blocked tasks.
- Support independent QA when the task or QA column requires it.
- Support durable recovery after interruption or a cross-chat handoff.
- Observe recurring operating problems and send candidate lessons through the existing controlled learning process; never self-modify a Skill without the required approval process.

## Initial status vocabulary

Use controlled values in `Flags`, subject to refinement after validation:

- `PENDING`: ready for dispatcher evaluation
- `DISPATCHED`: assigned and awaiting worker start or acknowledgment
- `RUNNING`: actively being worked
- `QA_PENDING`: output is ready for independent QA
- `COMPLETE`: delivery and required QA are complete
- `BLOCKED_USER`: user input is required; does not consume a task slot
- `FAILED`: terminal failure awaiting review or an explicit retry decision
- `SKIP`: intentionally excluded from execution
- `PAUSED`: intentionally held without emergency stop
- `PAUSED_KILL_SWITCH`: safely stopped because of the global kill switch
- `NEEDS_RECONCILIATION`: state is uncertain after interruption

Treat blank `Flags` as `PENDING` only for initial compatibility.

## Concurrency

Count both `DISPATCHED` and `RUNNING` as active. If the active count is two or greater, assign no new task. `BLOCKED_USER`, `QA_PENDING`, `COMPLETE`, `FAILED`, `SKIP`, `PAUSED`, and `PAUSED_KILL_SWITCH` do not consume an active execution slot.

## User-input blockers

When user input is needed:

- Set `Flags` to `BLOCKED_USER`.
- Put the exact question and minimal context in `Update on the task`.
- Add a concise scheduling note in `Comments from Dispatcher`.
- Release any active execution slot.
- Do not redispatch until the user responds in `User comments` or explicitly authorizes a retry.

## Global controls

The design must include a shared global control state, preferably separate from individual task rows:

- `ACTIVE`: normal dispatching, subject to the two-task limit
- `PAUSED`: do not start new work; allow active tasks to finish or checkpoint safely
- `KILL_SWITCHED`: do not dispatch, retry, resume, or start work; active workers stop at their next safe checkpoint and preserve partial state

The implementation proposal must state where this control lives, how dispatcher and workers read it, how active workers are notified or check it, and how user-authorized resumption works.

## Safety boundaries

- Do not assume direct messaging to an existing OpenWorker session is supported.
- Do not assume a Skill can run unattended, watch a folder, or invoke another session without a verified runtime capability.
- Do not automatically create a Coworker or install a Skill simply because this repository describes one.
- Do not auto-notify WhatsApp, Telegram, email, Slack, or another external endpoint in v0.1.
- Do not overwrite user-provided queue fields.
- Do not treat a conversation summary as stronger evidence than the queue file.

## Design hypothesis to test

A likely composition is:

- A custom Queue Dispatcher Coworker for reusable role, tools, permissions, and specialist instructions.
- A persistent Dispatcher session as the operational control room.
- A Queue Dispatcher Skill for repeatable queue evaluation, concurrency checks, handoff construction, check-in reconciliation, and state transitions.
- The shared CSV as authoritative task state.

This is a hypothesis, not an implementation claim. The new session must validate it against the installed OpenWorker build.
