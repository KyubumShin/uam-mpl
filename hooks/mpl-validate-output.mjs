#!/usr/bin/env node
/**
 * MPL Output Validation Hook (PostToolUse)
 * Validates structured output from MPL agents (decomposer, phase-runner, worker).
 * Inserts validation status to guide orchestrator.
 */

import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import shared MPL state utility
const { isMplActive, readState, writeState } = await import(
  pathToFileURL(join(__dirname, 'lib', 'mpl-state.mjs')).href
);

// Import shared stdin reader
const { readStdin } = await import(
  pathToFileURL(join(__dirname, 'lib', 'stdin.mjs')).href
);

// Agents that require output validation
const VALIDATE_AGENTS = new Set([
  'uam-decomposer',
  'uam-phase-runner',
  'uam-worker',
]);

// Expected output patterns per agent
const EXPECTED_SECTIONS = {
  'uam-decomposer': [
    'architecture_anchor',
    'phases',
    'shared_resources',
  ],
  'uam-phase-runner': [
    'status',
    'state_summary',
    'verification',
  ],
  'uam-worker': [
    'todo_id',
    'status',
    'outputs',
    'acceptance_criteria',
    'learnings',
    'issues',
  ],
};

async function main() {
  const input = await readStdin();

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  const toolName = data.tool_name || data.toolName || '';

  // Only intercept Task tool completions
  if (!['Task', 'task'].includes(toolName)) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  // Check if MPL is active
  const cwd = data.cwd || data.directory || process.cwd();
  if (!isMplActive(cwd)) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  // Extract agent type from tool input
  const toolInput = data.tool_input || data.toolInput || {};
  const agentType = toolInput.subagent_type || toolInput.subagentType || '';

  // Check if this agent requires validation
  if (!VALIDATE_AGENTS.has(agentType)) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  // Get expected sections for this agent
  const sections = EXPECTED_SECTIONS[agentType] || [];

  // Validate tool_response content against expected sections
  const toolResponse = data.tool_response || data.toolResponse || '';
  const responseText = typeof toolResponse === 'string'
    ? toolResponse
    : JSON.stringify(toolResponse);

  const missingSections = [];
  const foundSections = [];
  for (const section of sections) {
    if (responseText.toLowerCase().includes(section.toLowerCase())) {
      foundSections.push(section);
    } else {
      missingSections.push(section);
    }
  }

  const validationPassed = missingSections.length === 0;
  const sectionList = sections.map(s => {
    const found = foundSections.includes(s);
    return `  - ${found ? '[PASS]' : '[MISSING]'} ${s}`;
  }).join('\n');

  // Estimate token usage from response length and update state
  try {
    const estimatedTokens = Math.ceil(responseText.length / 4);
    if (estimatedTokens > 0) {
      const currentState = readState(cwd);
      if (currentState) {
        const currentTokens = currentState.cost?.total_tokens || 0;
        writeState(cwd, { cost: { total_tokens: currentTokens + estimatedTokens } });
      }
    }
  } catch {
    // Token tracking is best-effort
  }

  // Additional validation for phase-runner: check state_summary required sections
  let extraValidation = '';
  if (agentType === 'uam-phase-runner' && validationPassed) {
    const requiredSummarySections = ['구현된 것', 'Phase Decisions', '검증 결과'];
    const missingSummary = requiredSummarySections.filter(
      s => !responseText.includes(s)
    );
    if (missingSummary.length > 0) {
      extraValidation = `\n\nState Summary missing required sections: ${missingSummary.join(', ')}
Request Phase Runner to supplement the state summary before proceeding.`;
    }
  }

  let message;
  if (validationPassed) {
    message = `[MPL VALIDATION PASSED] Agent "${agentType}" output contains all ${sections.length} required sections.${extraValidation}`;
  } else {
    message = `[VALIDATION FAILED] [MPL VALIDATION FAILED] Agent "${agentType}" output is missing ${missingSections.length}/${sections.length} required sections.

Validation results:
${sectionList}

Missing sections: ${missingSections.join(', ')}

ACTION REQUIRED: Re-run the agent with clarified instructions targeting the missing sections.
Do NOT proceed to the next phase until all sections are present.${extraValidation}`;
  }

  console.log(JSON.stringify({
    continue: true,  // Non-blocking: orchestrator decides retry vs proceed
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: message
    }
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
