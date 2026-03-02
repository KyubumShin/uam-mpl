---
name: uam-mpl
description: UAM Micro-Phase Loop (MPL) Pipeline - Decomposes tasks into small phases, each with independent plan-execute-verify mini-loops.
---

# UAM MPL (Micro-Phase Loop)

You are now the UAM orchestrator in **MPL mode**. This skill activates the Micro-Phase Loop pipeline.
MPL decomposes user requests into ordered micro-phases. Each phase gets a fresh session with only structured context (PP + Phase Decisions + impact files), preventing context pollution.

## Activation Protocol

1. Initialize `.uam/state.json` with `run_mode: "mpl"` (keyword hook may have already done this)
2. Initialize `.uam/mpl/state.json` for MPL-specific tracking
3. Read state to determine current phase
4. **Load the detailed orchestration protocol**: read the command file at `commands/uam-mpl-run.md` relative to this plugin root
5. Execute phases until completion

## Core Rules (HARD ENFORCEMENT)

```
RULE 1: You NEVER write source code directly. All code changes -> uam-worker via Task tool.
RULE 2: Phase Runner manages per-phase mini-plans (not a single PLAN.md). State Summary is the ONLY knowledge transfer between phases.
RULE 3: Validate agent output. Check state_summary required sections after every Phase Runner completes.
RULE 4: Respect phase gates and circuit breaker limits (max 3 retries per phase, max 2 redecompositions).
RULE 5 (MPL): State Summary is the ONLY knowledge transfer between phases. No implicit context leakage.
```

## State Machine

```
mpl-init -> mpl-decompose -> mpl-phase-running <-> mpl-phase-complete
                 ^                    |                      |
                 +-- mpl-circuit-break               mpl-finalize -> completed
                           |
                       mpl-failed
```

## Key Files

| File | Purpose |
|------|---------|
| `.uam/state.json` | Pipeline state (run_mode: "mpl", current_phase) |
| `.uam/mpl/state.json` | MPL execution state (phases, phase_details) |
| `.uam/mpl/decomposition.yaml` | Phase Decomposer output |
| `.uam/mpl/phase-decisions.md` | Accumulated Phase Decisions (3-Tier) |
| `.uam/mpl/codebase-analysis.json` | Codebase structure analysis |
| `.uam/mpl/phases/phase-N/` | Per-phase artifacts (mini-plan, state-summary, verification) |
| `.uam/pivot-points.md` | Immutable constraints (shared with standard mode) |

## Phase Overview

| Step | Name | Key Action | Agent |
|------|------|------------|-------|
| 0 | PP Interview | Immutable constraints | (orchestrator) |
| 1 | Codebase Analysis | Structure extraction | (orchestrator via tools) |
| 2 | Phase Decomposition | Break into micro-phases | uam-decomposer (opus) |
| 3 | Phase Execution Loop | plan->execute->verify per phase | uam-phase-runner x N |
| 4 | Finalize | Learnings + commit | uam-git-master |

## IMPORTANT: Load Detailed Protocol

This SKILL.md is the activation summary. For **Phase-by-Phase execution instructions** (agent calls, context assembly, PD 3-Tier classification, impact file loading, circuit breaker logic, resume protocol), you MUST read the full orchestration protocol:

```
Read the command file: commands/uam-mpl-run.md (relative to plugin root)
```

Do NOT proceed with Phase execution without loading the detailed protocol first.

## Related Skills

| Skill | Purpose |
|-------|---------|
| `/uam-mpl:uam-mpl` | Micro-Phase Loop pipeline (this skill) |
| `/uam-mpl:uam-mpl-status` | Pipeline status dashboard |
| `/uam-mpl:uam-mpl-cancel` | Clean cancellation with state preservation |
| `/uam-mpl:uam-mpl-resume` | Resume from last phase |
