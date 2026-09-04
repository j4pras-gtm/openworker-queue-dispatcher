# Discovery Checklist

Complete this before proposing or implementing a Queue Dispatcher. Record only verified findings and label unknowns clearly.

## Coworker capability

- Confirm what a custom Coworker package contains and how it is installed from a folder or GitHub source.
- Inspect a trusted built-in or official example Coworker.
- Determine whether Coworkers can provide persistent instructions, tools, skills, permissions, and workspace defaults.
- Determine whether a Coworker can define triggers, background activity, file watching, or scheduled work.
- Determine whether the Coworker system can create, select, message, or resume another session.

## Skill capability

- Confirm the supported Skill format and storage location.
- Confirm whether a Skill is instructions only, can call tools, can invoke scripts, or can retain state.
- Confirm how a session invokes a Skill.
- Determine whether a Skill can directly write the shared CSV through available file tools.
- Determine whether a Skill can communicate with other active sessions or only return a handoff payload.

## Session capability

- Confirm how sessions are created, named, resumed, and associated with a Coworker.
- Confirm whether a session can be kept running or invoked by a supported trigger.
- Confirm if inter-session messaging, task creation, or session APIs exist.
- Identify a safe manual fallback: dispatcher-mediated check-in and queue-file handoff.

## File and concurrency safety

- Verify the common folder path and actual queue CSV filename.
- Verify all worker sessions can read it and which identities can write it.
- Test whether concurrent updates can overwrite rows or corrupt the file.
- Propose a safe write strategy: atomic replacement, lock file, single-writer dispatcher, or another verified mechanism.
- Decide how stale `DISPATCHED` or `RUNNING` rows are reconciled after a crash.

## Existing skills

- Identify exact invocation/usage instructions for the installed Gate 2 learning promotion skill.
- Identify exact invocation/usage instructions for the durable continuity and controlled feedback-loop skill.
- Identify exact invocation/usage instructions for the independent read-only QA skill.
- Confirm what evidence and approval are required before a lesson is promoted into a Skill.

## Kill switch

- Determine the safest common-folder mechanism for a global control state.
- Confirm the lowest-cost way workers can check the state before starting work and at checkpoints.
- Determine whether active work can be interrupted directly or must use cooperative safe-stop behavior.
- Verify that pause and kill states prevent new dispatches.
- Define a user-approved resume flow.

## Report format

For every key question, report one of:

- Verified: include the evidence/source and practical implication.
- Unsupported: state the constraint and the fallback.
- Unknown: state how it could be tested safely.
