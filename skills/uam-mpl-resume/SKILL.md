---
name: uam-mpl-resume
description: Resume UAM-MPL pipeline from last incomplete phase
---

# UAM-MPL Resume

Resume a previously interrupted or cancelled MPL pipeline from the last incomplete phase.

## Protocol

1. Read `.uam/state.json` — verify run_mode is "mpl"
2. Read `.uam/mpl/state.json` — find resume point
3. Determine resume strategy:

### Case A: Pipeline was cancelled
```
if state.current_phase == "cancelled":
  - Read mpl/state.json for last progress
  - Find first phase with status != "completed"
  - Update state.json: current_phase = "mpl-phase-running"
  - Update mpl/state.json: status = "running", phases.current = next_phase
  - Report: "[UAM-MPL] Resuming: {completed}/{total} done. Next: {nextPhase.name}"
```

### Case B: Pipeline was interrupted (session crash)
```
if state.current_phase starts with "mpl-":
  - Read mpl/state.json
  - If current phase was "mpl-phase-running":
    - Check .uam/mpl/phases/phase-N/ for state-summary.md
    - If exists: phase completed, advance to next
    - If not: resume current phase
  - Report: "[UAM-MPL] Resuming from {current_phase}"
```

### Case C: All phases completed but not finalized
```
if all phases completed but status != "completed":
  - Set current_phase = "mpl-finalize"
  - Report: "[UAM-MPL] All phases completed. Resuming finalization."
```

### Case D: No pipeline state found
```
Report: "[UAM-MPL] 재개할 파이프라인이 없습니다. /uam-mpl:uam-mpl 로 새 파이프라인을 시작하세요."
```

## Context Recovery

On resume, load:
- `.uam/mpl/phase-decisions.md` — accumulated PDs
- `.uam/mpl/phases/phase-{last}/state-summary.md` — last completed phase's summary
- `.uam/mpl/decomposition.yaml` — phase definitions
- `.uam/pivot-points.md` — Pivot Points

Then invoke the MPL skill:
```
Skill: uam-mpl
```

The skill will detect the in-progress state and continue from the appropriate phase.

## Implementation

Read state files, determine resume point, update state, then invoke the main uam-mpl skill.
