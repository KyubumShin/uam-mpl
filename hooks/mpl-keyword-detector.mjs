#!/usr/bin/env node
/**
 * MPL Keyword Detector Hook (UserPromptSubmit)
 * Detects "mpl" keyword in user input and initializes MPL pipeline state.
 *
 * When "mpl" is detected:
 * 1. Initialize .uam/state.json with run_mode: "mpl"
 * 2. Initialize .uam/mpl/state.json for MPL tracking
 * 3. Return [MAGIC KEYWORD: UAM-MPL] message to trigger MPL skill
 */

import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import shared MPL state utility
const { initMplState, isUamActive, isMplActive } = await import(
  pathToFileURL(join(__dirname, 'lib', 'mpl-state.mjs')).href
);

// Import shared stdin reader
const { readStdin } = await import(
  pathToFileURL(join(__dirname, 'lib', 'stdin.mjs')).href
);

/**
 * Extract prompt text from hook input JSON
 */
function extractPrompt(input) {
  try {
    const data = JSON.parse(input);
    if (data.prompt) return data.prompt;
    if (data.message?.content) return data.message.content;
    if (Array.isArray(data.parts)) {
      return data.parts
        .filter(p => p.type === 'text')
        .map(p => p.text)
        .join(' ');
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Sanitize text for keyword detection (strip code blocks, URLs, paths)
 */
function sanitize(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/https?:\/\/[^\s)>\]]+/g, '')
    .replace(/(?<=^|[\s"'`(])(?:\/)?(?:[\w.-]+\/)+[\w.-]+/gm, '');
}

/**
 * Extract feature name from user prompt
 */
function extractFeatureName(prompt) {
  const cleaned = prompt.replace(/\bmpl\b/gi, '').trim();
  if (!cleaned) return 'unnamed';

  const words = cleaned
    .split(/\s+/)
    .filter(w => w.length > 2 && !/^(the|and|for|with|this|that|from|into)$/i.test(w))
    .slice(0, 4);

  return words.join('-').toLowerCase()
    .replace(/[^a-z0-9가-힣ぁ-ゔァ-ヴ\u4e00-\u9fff-]/g, '')
    .replace(/^[-]+|[-]+$/g, '') || 'task';
}

async function main() {
  try {
    const input = await readStdin();
    if (!input.trim()) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    let data = {};
    try { data = JSON.parse(input); } catch {}
    const cwd = data.cwd || data.directory || process.cwd();

    const prompt = extractPrompt(input);
    if (!prompt) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    const cleanPrompt = sanitize(prompt).toLowerCase();

    // Detect "mpl" keyword (word boundary to avoid false positives)
    if (!/\bmpl\b/i.test(cleanPrompt)) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Check for active pipeline
    if (isUamActive(cwd) || isMplActive(cwd)) {
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: '[UAM-MPL] Pipeline already active. Use current session or cancel first with /uam-mpl:uam-mpl-cancel.'
        }
      }));
      return;
    }

    // Initialize MPL state
    const featureName = extractFeatureName(prompt);
    initMplState(cwd, featureName, 'standard');

    const message = `[MAGIC KEYWORD: UAM-MPL]

UAM Micro-Phase Loop (MPL) Pipeline activated. State initialized at .uam/state.json (run_mode: "mpl").

You MUST invoke the skill using the Skill tool:

Skill: uam-mpl

User request:
${prompt}

IMPORTANT: Load the UAM-MPL orchestration protocol via the commands/uam-mpl-run.md file, then begin Phase 0: PP Interview.`;

    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: message
      }
    }));

  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

main();

export { extractPrompt, sanitize, extractFeatureName };
