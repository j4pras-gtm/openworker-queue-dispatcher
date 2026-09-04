# Queue Dispatcher v0.1 Proposal Template

Use this template after completing discovery. Do not implement changes until the user approves the proposal.

## 1. Verified environment

- OpenWorker version/build and relevant verified capabilities
- Common folder and queue CSV location
- Available worker sessions/Coworkers
- Installed relevant Skills and their invocation model
- Direct-session handoff capability or chosen fallback

## 2. Recommended composition

State the recommendation and evidence for each:

- Queue Dispatcher Coworker: create, configure, or defer
- Queue Control Room session: create, configure, or defer
- Queue Dispatcher Skill: create, configure, or defer
- Shared queue CSV: exact responsibilities and write policy
- Optional helper automation: include only if verified and necessary

## 3. v0.1 workflow

Describe the minimum end-to-end workflow:

- Queue intake and eligibility
- Two-active-task concurrency enforcement
- Assignment/handoff to a worker
- Worker completion and check-in
- User-input blocker handling
- QA routing and outcome handling
- Restart/recovery and stale-task reconciliation

## 4. Kill switch and pause

Specify:

- Control-file or control-state location
- Exact control values
- Dispatcher behavior
- Worker checkpoint behavior
- Cooperative-stop limitations
- Resume path that requires user confirmation

## 5. Required artifacts

List exact files, settings, skills, instructions, or configuration changes proposed. For each, include purpose, location, owner, and whether it changes external state.

## 6. Existing skill integration

Explain how and when to use:

- Durable session continuity and feedback-loop skill
- Independent read-only QA skill
- Gate 2 learning promotion skill

Specify what remains manual and what requires user approval.

## 7. Risks and deferred scope

List all unverified assumptions, likely failure modes, and items excluded from v0.1, including direct inter-session messaging, automatic local file watching, autonomous triggers, and external notification channels.

## 8. Acceptance test

Propose a small, safe dry run proving:

- One task can be assigned and checked in
- A second task can be assigned
- A third task is not assigned while two are active
- A user-blocked task is parked without retry
- Kill switch blocks dispatch and causes safe checkpointing
- Recovery can reconstruct the state from the queue file

## 9. Approval request

End with a plain request for approval that identifies every proposed write, installation, configuration change, or dispatch action.
