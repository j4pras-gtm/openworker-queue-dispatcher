# OpenWorker Queue Dispatcher

A foundational discovery brief for designing a Queue Dispatcher that coordinates multiple OpenWorker sessions through a shared queue file.

## Purpose

This repository is not yet an installed Coworker or production Skill. It is the starting context for a new OpenWorker session to inspect the actual local OpenWorker capabilities, create a Dispatcher session if appropriate, and propose a Queue Dispatcher Skill for user approval.

## Start here

1. Read [FOUNDATIONAL-BRIEF.md](FOUNDATIONAL-BRIEF.md).
2. Complete [DISCOVERY-CHECKLIST.md](DISCOVERY-CHECKLIST.md) against the installed OpenWorker environment.
3. Use [PROPOSAL-TEMPLATE.md](PROPOSAL-TEMPLATE.md) to prepare a v0.1 proposal.
4. Do not install, enable, save, modify, dispatch, notify, or otherwise make external changes until the user approves the proposal.

## Core principle

Treat the shared queue CSV as the durable source of truth. Conversation history, memory, and checkpoints can aid recovery but must not override the file.

## Related capabilities already available

- Gate 2 learning promotion: promotes approved lessons from `library.jsonl` into Skills after review and per-item user approval.
- Durable session continuity: supports checkpoints, cross-chat handoffs, build-state recovery, and controlled feedback loops.
- Independent read-only QA: verifies completed artifacts, produces a defect ledger, and proposes Gate 1 lessons where appropriate.

## Status

Foundational discovery draft. Validate all OpenWorker-specific runtime behavior before implementation.
