# Installing the Queue Dispatcher Coworker

This repo is an **installable OpenWorker persona** (a "Coworker"). It is not just a brief —
the root `manifest.md` plus the bundled `skills/` folder are the complete, portable package.

## What it is

- **`manifest.md`** (repo root) — the persona definition: YAML frontmatter (identity + capability
  declaration) followed by the markdown body that becomes the system prompt. This is the file the
  installer parses. **Only this `.md` may sit at the repo root** — every root `.md` is treated as a
  manifest, so all other docs live under `docs/`.
- **`skills/queue-dispatcher/`** — the control-room protocol skill (+ its `queue_ops.js` helper).
- **`skills/queue-worker/`** — the worker run-loop skill (+ the same helper). A `skills/` dir next to
  the manifest travels with the persona on install, so both skills are portable to any instance.
- **`docs/`** — the original discovery brief (checklist, proposal template, example queue). Reference
  material only; not loaded by the runtime.

## Install from GitHub

1. In OpenWorker → **Settings → Coworker**, choose *install from GitHub* and paste:
   `https://github.com/j4pras-gtm/openworker-queue-dispatcher`
2. The app shallow-clones the repo, validates `manifest.md`, and shows a **consent screen** listing
   the declared capabilities:
   - Tools: `files`, `search`, `shell`, `todo`
   - Connectors: none · Messaging: off · Team: solo
   - Scheduling: on · Requires folder: yes
   - Skills: `queue-dispatcher`, `queue-worker`
3. **Approve**, then **enable** the persona (installs land disabled pending consent).
4. Start a session on it, point it at your common folder (e.g. the `use\` folder), and it runs the
   dispatcher loop. On first run it reads/creates `dispatcher-config.json` there — the only setup step.

## First-run setup (per instance)

The persona is instance-agnostic: every path resolves from `dispatcher-config.json` in the working
folder. If it's missing, the persona asks for the common folder and creates one:

```json
{
  "queue":       "<abs path to Job queue.csv>",
  "control":     "<abs path to dispatcher-control.json>",
  "feed":        "<abs path to Flags.csv>",
  "commonFlags": "<abs path to COMMON_FLAGS.md>",
  "activeLimit": 2
}
```

## Updating

Re-install over the same repo URL to pick up changes. An update keeps your enabled state **unless**
the declared capabilities grew — adding a tool, connector, or team role re-triggers consent.

## Repo layout

```
manifest.md                      ← persona (parsed by the installer)
skills/
  queue-dispatcher/SKILL.md      ← control-room protocol
  queue-dispatcher/queue_ops.js  ← CSV helper (atomic writes, batch-aware dispatch)
  queue-worker/SKILL.md          ← worker run-loop + check-in protocol
  queue-worker/queue_ops.js
docs/                            ← original discovery brief (reference only)
examples/Job-queue.example.csv   ← sample queue shape
```
