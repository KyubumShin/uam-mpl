---
name: uam-mpl-status
description: Display UAM-MPL pipeline status dashboard
---

# UAM-MPL Status Dashboard

Display current MPL pipeline progress and phase details.

## Protocol

1. Read `.uam/state.json` — get run_mode, current_phase, pipeline_id
2. Read `.uam/mpl/state.json` — get phase details and totals
3. Display dashboard:

```
╔═══════════════════════════════════════════╗
║          UAM-MPL Status Dashboard         ║
╠═══════════════════════════════════════════╣
║ Pipeline: {pipeline_id}                   ║
║ Status:   {status}                        ║
║ Phase:    {current_phase}                 ║
║ Mode:     {maturity_mode}                 ║
╠═══════════════════════════════════════════╣
║ Progress: {completed}/{total} phases      ║
║ ████████░░░░ {percentage}%                ║
╠═══════════════════════════════════════════╣
║ Phase Details:                            ║
║  ✓ phase-1: {name} (PD: {n}, criteria: {x/y})
║  ✓ phase-2: {name} (PD: {n}, criteria: {x/y})
║  ▶ phase-3: {name} (running)             ║
║  ○ phase-4: {name} (pending)             ║
╠═══════════════════════════════════════════╣
║ Totals:                                   ║
║  Retries: {n}  Discoveries: {n}           ║
║  PD Overrides: {n}  Redecompositions: {n} ║
╚═══════════════════════════════════════════╝
```

4. If no active pipeline: report `[UAM-MPL] 활성 파이프라인이 없습니다.`

## Status Icons

| Status | Icon |
|--------|------|
| completed | ✓ |
| running | ▶ |
| pending | ○ |
| circuit_break | ✗ |
| failed | ✗ |

## Implementation

Read state files using Read tool, then format and display the dashboard.
No external tools needed — pure state reading and formatting.
