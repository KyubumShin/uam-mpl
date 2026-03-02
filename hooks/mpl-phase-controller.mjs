#!/usr/bin/env node
/**
 * MPL Phase Controller Hook (Stop)
 * Manages phase transitions and loop continuation for the MPL pipeline.
 *
 * State Machine:
 * mpl-init → mpl-decompose → mpl-phase-running ↔ mpl-phase-complete
 *                 ^                    |                      |
 *                 +── mpl-circuit-break               mpl-finalize → completed
 *                           |
 *                       mpl-failed
 *
 * Always returns continue: true to keep the pipeline loop running until completion.
 */

import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import shared MPL state utility
const { readState, writeState, isMplActive, readMplPhaseState, writeMplPhaseState } = await import(
  pathToFileURL(join(__dirname, 'lib', 'mpl-state.mjs')).href
);

// Import shared stdin reader
const { readStdin } = await import(
  pathToFileURL(join(__dirname, 'lib', 'stdin.mjs')).href
);

async function main() {
  const input = await readStdin();

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  const cwd = data.cwd || data.directory || process.cwd();

  // Check if MPL is active
  if (!isMplActive(cwd)) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  const state = readState(cwd);
  if (!state) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  const phase = state.current_phase;

  switch (phase) {
    case 'mpl-init': {
      // MPL initialization: codebase analysis + PP interview
      const ppExists = existsSync(join(cwd, '.uam', 'pivot-points.md'));
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext: `[UAM-MPL] Phase 0: Initialization in progress. PP: ${ppExists ? 'loaded' : 'pending interview'}. Complete codebase analysis and PP interview, then proceed to decomposition.`
        }
      }));
      break;
    }

    case 'mpl-decompose': {
      // Phase Decomposer running
      const mplState = readMplPhaseState(cwd);
      const totalPhases = mplState?.phases?.total || 0;
      if (totalPhases > 0) {
        // Decomposition complete → transition to phase-running
        writeState(cwd, { current_phase: 'mpl-phase-running' });
        writeMplPhaseState(cwd, { phases: { current: 'phase-1' } });
        console.log(JSON.stringify({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext: `[UAM-MPL] Decomposition complete: ${totalPhases} phases generated. Transitioning to Phase Execution.`
          }
        }));
      } else {
        console.log(JSON.stringify({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext: '[UAM-MPL] Phase Decomposition in progress. Run Phase Decomposer to break the task into micro-phases.'
          }
        }));
      }
      break;
    }

    case 'mpl-phase-running': {
      // A phase runner is executing
      const mplState = readMplPhaseState(cwd);
      const current = mplState?.phases?.current || 'unknown';
      const total = mplState?.phases?.total || 0;
      const completed = mplState?.phases?.completed || 0;
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext: `[UAM-MPL] Phase Runner executing: ${current} (${completed}/${total} phases completed). Continue executing current phase's mini-loop.`
        }
      }));
      break;
    }

    case 'mpl-phase-complete': {
      // A phase just completed, check if more remain
      const mplState = readMplPhaseState(cwd);
      const total = mplState?.phases?.total || 0;
      const completed = mplState?.phases?.completed || 0;

      if (completed >= total) {
        // All phases done → finalize
        writeState(cwd, { current_phase: 'mpl-finalize' });
        writeMplPhaseState(cwd, { status: 'finalizing' });
        console.log(JSON.stringify({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext: `[UAM-MPL] All ${total} phases completed! Transitioning to Finalize.`
          }
        }));
      } else {
        // More phases → continue
        const nextPhaseIdx = completed + 1;
        const nextPhaseId = `phase-${nextPhaseIdx}`;
        writeState(cwd, { current_phase: 'mpl-phase-running' });
        writeMplPhaseState(cwd, { phases: { current: nextPhaseId } });
        const nextDetail = mplState?.phase_details?.find(p => p.id === nextPhaseId);
        const nextName = nextDetail?.name || nextPhaseId;
        console.log(JSON.stringify({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext: `[UAM-MPL] Phase ${completed}/${total} completed. Next: ${nextName}. Transitioning to Phase Runner.`
          }
        }));
      }
      break;
    }

    case 'mpl-circuit-break': {
      // Phase failed after retries
      const mplState = readMplPhaseState(cwd);
      const redecomposeCount = mplState?.redecompose_count || 0;
      const maxRedecompose = mplState?.max_redecompose || 2;

      if (redecomposeCount >= maxRedecompose) {
        // Exceeded redecompose limit → failed
        writeState(cwd, { current_phase: 'mpl-failed' });
        writeMplPhaseState(cwd, { status: 'failed' });
        console.log(JSON.stringify({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext: `[UAM-MPL] Circuit breaker: redecomposition limit reached (${redecomposeCount}/${maxRedecompose}). Transitioning to FAILED state. Completed phases are preserved.`
          }
        }));
      } else {
        // Can redecompose
        writeState(cwd, { current_phase: 'mpl-decompose' });
        writeMplPhaseState(cwd, { redecompose_count: redecomposeCount + 1 });
        console.log(JSON.stringify({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext: `[UAM-MPL] Circuit breaker triggered. Redecomposition ${redecomposeCount + 1}/${maxRedecompose}. Returning to Decomposer for remaining phases.`
          }
        }));
      }
      break;
    }

    case 'mpl-finalize': {
      // All phases done, finalizing
      const mplState = readMplPhaseState(cwd);
      const finalized = mplState?.status === 'completed';
      if (finalized) {
        writeState(cwd, { current_phase: 'completed' });
        console.log(JSON.stringify({
          continue: false,
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext: '[UAM-MPL] Finalization complete. MPL pipeline finished successfully.'
          }
        }));
      } else {
        const total = mplState?.phases?.total || 0;
        const completed = mplState?.phases?.completed || 0;
        console.log(JSON.stringify({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext: `[UAM-MPL] Finalize in progress (${completed}/${total} phases). Run final verification, extract learnings, then mark complete.`
          }
        }));
      }
      break;
    }

    case 'mpl-failed': {
      // Terminal failure
      writeState(cwd, { current_phase: 'completed' });
      console.log(JSON.stringify({
        continue: false,
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext: '[UAM-MPL] Pipeline failed. Completed phase outputs are preserved in .uam/mpl/phases/. Review failure and restart if needed.'
        }
      }));
      break;
    }

    default: {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    }
  }
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
