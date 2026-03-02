---
name: uam-mpl-cancel
description: Cancel active UAM-MPL pipeline with state preservation
---

# UAM-MPL Cancel

Clean cancellation of the active MPL pipeline. Preserves completed phase outputs.

## Protocol

1. Read `.uam/state.json` — verify MPL is active (`run_mode: "mpl"`, `current_phase` starts with `mpl-`)
2. Read `.uam/mpl/state.json` — capture current progress
3. Report progress to user:
   ```
   [UAM-MPL Cancel] 파이프라인 취소 중...
   진행 상태: {completed}/{total} phases 완료
   현재 페이즈: {current_phase}
   완료된 페이즈 결과는 .uam/mpl/phases/ 에 보존됩니다.
   ```
4. Update `.uam/mpl/state.json`:
   ```json
   { "status": "cancelled", "cancelled_at": "<timestamp>" }
   ```
5. Update `.uam/state.json`:
   ```json
   { "current_phase": "cancelled" }
   ```
6. Report: `[UAM-MPL] 파이프라인이 취소되었습니다. 재개: /uam-mpl:uam-mpl-resume`

## Edge Cases

- If MPL is not active: report `[UAM-MPL] 활성 파이프라인이 없습니다.`
- If state files are corrupt: delete `.uam/state.json` and report clean state
- Completed phase outputs in `.uam/mpl/phases/` are NEVER deleted

## Implementation

Use Read tool to check state files, then Bash to write updated state via inline Node.js:
```bash
node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('.uam/state.json', 'utf-8'));
state.current_phase = 'cancelled';
fs.writeFileSync('.uam/state.json', JSON.stringify(state, null, 2));
"
```

Or use the Write tool to update state files directly (`.uam/` paths are allowed).
