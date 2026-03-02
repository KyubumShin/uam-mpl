#!/usr/bin/env node
/**
 * MPL State Management Utility
 * Core state management for the UAM-MPL standalone plugin.
 * Ported from UAM/hooks/lib/uam-state.mjs with MPL-specific additions.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { randomBytes } from 'crypto';

const STATE_DIR = '.uam';
const STATE_FILE = 'state.json';

/**
 * Default top-level state schema.
 * cost.max_total_tokens is a monitoring threshold, not a hard limit.
 * Orchestrator can check this value for budget warnings.
 */
const DEFAULT_STATE = {
  pipeline_id: null,
  run_mode: 'mpl',
  current_phase: 'mpl-init',
  started_at: null,
  cost: {
    total_tokens: 0,
    max_total_tokens: 500000,
    estimated_usd: 0
  }
};

// Prototype pollution guard keys
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Read UAM state from .uam/state.json
 * @param {string} cwd - Working directory
 * @returns {object|null} State object or null if not found/invalid
 */
export function readState(cwd) {
  try {
    const statePath = join(cwd, STATE_DIR, STATE_FILE);
    if (!existsSync(statePath)) return null;
    const parsed = JSON.parse(readFileSync(statePath, 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (!parsed.current_phase) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write/merge UAM state to .uam/state.json (atomic via temp + rename)
 * @param {string} cwd - Working directory
 * @param {object} patch - Fields to merge into state
 * @returns {object} Merged state
 */
export function writeState(cwd, patch) {
  const stateDir = join(cwd, STATE_DIR);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  const current = readState(cwd) || { ...DEFAULT_STATE };
  const merged = deepMerge(current, patch);

  // Atomic write via temp file + rename
  const tmpPath = join(stateDir, `.state-${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(tmpPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  renameSync(tmpPath, join(stateDir, STATE_FILE));

  return merged;
}

/**
 * Check if UAM is currently active
 * @param {string} cwd - Working directory
 * @returns {boolean}
 */
export function isUamActive(cwd) {
  const statePath = join(cwd, STATE_DIR, STATE_FILE);
  if (!existsSync(statePath)) return false;

  const state = readState(cwd);
  if (!state) return true; // File exists but corrupt = fail-closed
  if (!state.current_phase) return false;
  return state.current_phase !== 'completed' && state.current_phase !== 'cancelled' && state.current_phase !== 'failed';
}

/**
 * Check if MPL pipeline is currently active
 * @param {string} cwd - Working directory
 * @returns {boolean}
 */
export function isMplActive(cwd) {
  const state = readState(cwd);
  if (!state) return false;
  return state.run_mode === 'mpl' &&
         typeof state.current_phase === 'string' &&
         state.current_phase.startsWith('mpl-') &&
         state.current_phase !== 'mpl-failed';
}

/**
 * Initialize MPL-specific state for a new Micro-Phase Loop run
 * @param {string} cwd - Working directory
 * @param {string} featureName - Name of the feature being built
 * @param {string} maturityMode - Maturity mode: 'explore' | 'standard' | 'strict'
 * @returns {object} Initial MPL state
 */
export function initMplState(cwd, featureName, maturityMode = 'standard') {
  const now = new Date().toISOString();
  const dateStr = now.slice(0, 10).replace(/-/g, '');
  const slug = featureName.toLowerCase()
    .replace(/[^a-z0-9가-힣ぁ-ゔァ-ヴ\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

  // Set pipeline-level state
  writeState(cwd, {
    ...DEFAULT_STATE,
    run_mode: 'mpl',
    current_phase: 'mpl-init',
    started_at: now,
    pipeline_id: `uam-mpl-${dateStr}-${slug}`
  });

  // Create .uam/mpl/ directory and write state.json
  const mplDir = join(cwd, STATE_DIR, 'mpl');
  if (!existsSync(mplDir)) {
    mkdirSync(mplDir, { recursive: true });
  }

  const maxRedecompose = 2;

  const mplState = {
    task: featureName,
    status: 'running',
    started_at: now,
    maturity_mode: maturityMode,
    phases: {
      total: 0,
      completed: 0,
      current: null,
      failed: 0,
      circuit_breaks: 0
    },
    phase_details: [],
    redecompose_count: 0,
    max_redecompose: maxRedecompose,
    totals: {
      total_retries: 0,
      total_discoveries: 0,
      total_pd_overrides: 0,
      elapsed_ms: 0
    }
  };

  const tmpPath = join(mplDir, `.state-${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(tmpPath, JSON.stringify(mplState, null, 2), { mode: 0o600 });
  renameSync(tmpPath, join(mplDir, 'state.json'));

  // Initialize phase-decisions.md with empty sections
  const pdPath = join(mplDir, 'phase-decisions.md');
  if (!existsSync(pdPath)) {
    const pdTemplate = `# Phase Decisions

## Active Decisions

(No active decisions yet)

## Summary Decisions

| ID | Description | Phase | Files |
|----|------------|-------|-------|

## Archived Decisions

| ID | Description | Phase | Files |
|----|------------|-------|-------|
`;
    writeFileSync(pdPath, pdTemplate);
  }

  return mplState;
}

/**
 * Read MPL phase state from .uam/mpl/state.json
 * @param {string} cwd - Working directory
 * @returns {object|null} MPL state object or null
 */
export function readMplPhaseState(cwd) {
  try {
    const mplStatePath = join(cwd, STATE_DIR, 'mpl', 'state.json');
    if (!existsSync(mplStatePath)) return null;
    const parsed = JSON.parse(readFileSync(mplStatePath, 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write (deep-merge patch into) MPL phase state atomically
 * @param {string} cwd - Working directory
 * @param {object} patch - Fields to merge into MPL state
 * @returns {object} Merged MPL state
 */
export function writeMplPhaseState(cwd, patch) {
  const mplDir = join(cwd, STATE_DIR, 'mpl');
  if (!existsSync(mplDir)) {
    mkdirSync(mplDir, { recursive: true });
  }
  const current = readMplPhaseState(cwd) || {};
  const merged = deepMerge(current, patch);
  const tmpPath = join(mplDir, `.state-${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(tmpPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  renameSync(tmpPath, join(mplDir, 'state.json'));
  return merged;
}

/**
 * Classify Phase Decisions into 3 tiers for context injection.
 * Design doc 09: Active (full) / Summary (1-line) / Archived (ID only)
 *
 * @param {string} cwd - Working directory
 * @param {object} currentPhase - Current phase definition with impact and interface_contract
 * @param {Array} allPDs - All Phase Decisions parsed from phase-decisions.md
 * @returns {{ tier1: Array, tier2: Array, tier3: Array }}
 */
export function classifyPD(cwd, currentPhase, allPDs) {
  if (!allPDs || allPDs.length === 0) {
    return { tier1: [], tier2: [], tier3: [] };
  }

  const tier1 = []; // Active: full detail
  const tier2 = []; // Summary: 1-line
  const tier3 = []; // Archived: IDs only

  // Get current phase's impact files
  const impactFiles = new Set();
  if (currentPhase?.impact) {
    for (const category of ['create', 'modify', 'affected_tests', 'affected_config']) {
      const items = currentPhase.impact[category] || [];
      for (const item of items) {
        const path = typeof item === 'string' ? item : item.path;
        if (path) impactFiles.add(path);
      }
    }
  }

  // Get required phases from interface_contract
  const requiredPhases = new Set();
  if (currentPhase?.interface_contract?.requires) {
    for (const req of currentPhase.interface_contract.requires) {
      if (req.from_phase) requiredPhases.add(req.from_phase);
    }
  }

  // Structural decision types that always get summary
  const STRUCTURAL_TYPES = new Set(['DB Schema', 'API Contract', 'Architecture']);

  for (const pd of allPDs) {
    // Check Tier 1: affected_files intersect with current phase impact
    const pdFiles = pd.affected_files || [];
    const hasFileOverlap = pdFiles.some(f => impactFiles.has(f));

    // Check Tier 1: from_phase is in current phase's requires
    const isRequired = pd.from_phase && requiredPhases.has(pd.from_phase);

    if (hasFileOverlap || isRequired) {
      tier1.push(pd);
    } else if (pd.type && STRUCTURAL_TYPES.has(pd.type)) {
      tier2.push(pd);
    } else {
      tier3.push(pd);
    }
  }

  return { tier1, tier2, tier3 };
}

/**
 * Load impact files within a token budget for Phase Runner context.
 * Design doc 13: max 500 lines per file, ~5000 tokens total.
 *
 * @param {string} cwd - Working directory
 * @param {object} phaseImpact - Phase impact object with create/modify/affected_tests/affected_config
 * @param {number} tokenBudget - Maximum token budget (default ~5000)
 * @returns {Array<{ path: string, content: string|null, note?: string, truncated?: boolean }>}
 */
export function loadImpactFiles(cwd, phaseImpact, tokenBudget = 5000) {
  if (!phaseImpact) return [];

  const results = [];
  let usedTokens = 0;
  const MAX_LINES_PER_FILE = 500;
  const TOKENS_PER_CHAR = 0.25; // ~4 chars per token (English baseline; CJK text may use ~0.5)

  const categories = ['create', 'modify', 'affected_tests', 'affected_config'];

  for (const category of categories) {
    const items = phaseImpact[category] || [];

    for (const item of items) {
      const filePath = typeof item === 'string' ? item : item.path;
      if (!filePath) continue;

      const fullPath = join(cwd, filePath);

      if (!existsSync(fullPath)) {
        results.push({ path: filePath, content: null, note: '신규 생성 대상', category });
        continue;
      }

      try {
        const content = readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const estimatedTokens = Math.ceil(content.length * TOKENS_PER_CHAR);

        if (usedTokens + estimatedTokens > tokenBudget) {
          // Over budget — apply strategy based on category
          if (category === 'modify' && item.location_hint) {
            // Strategy 1: location_hint ±50 lines only
            const hintMatch = item.location_hint.match(/L?(\d+)/);
            if (hintMatch) {
              const centerLine = parseInt(hintMatch[1], 10);
              const start = Math.max(0, centerLine - 50);
              const end = Math.min(lines.length, centerLine + 50);
              const excerpt = lines.slice(start, end).join('\n');
              const excerptTokens = Math.ceil(excerpt.length * TOKENS_PER_CHAR);
              usedTokens += excerptTokens;
              results.push({
                path: filePath,
                content: `[Lines ${start + 1}-${end}]\n${excerpt}`,
                truncated: true,
                category
              });
              continue;
            }
          }

          if (category === 'affected_tests') {
            // Strategy 2: test file names + describe/it block names only
            const testOutline = lines
              .filter(l => /^\s*(describe|it|test)\s*\(/.test(l))
              .map(l => l.trim())
              .join('\n');
            const outlineTokens = Math.ceil(testOutline.length * TOKENS_PER_CHAR);
            usedTokens += outlineTokens;
            results.push({
              path: filePath,
              content: `[Test outline only]\n${testOutline}`,
              truncated: true,
              category
            });
            continue;
          }

          if (category === 'affected_config') {
            // Strategy 3: first 50 lines only
            const configExcerpt = lines.slice(0, 50).join('\n');
            const excerptTokens = Math.ceil(configExcerpt.length * TOKENS_PER_CHAR);
            usedTokens += excerptTokens;
            results.push({
              path: filePath,
              content: `[First 50 lines]\n${configExcerpt}`,
              truncated: true,
              category
            });
            continue;
          }

          // Default: truncate to fit budget
          const remainingBudget = tokenBudget - usedTokens;
          const maxChars = Math.floor(remainingBudget / TOKENS_PER_CHAR);
          const truncated = content.slice(0, maxChars);
          usedTokens += remainingBudget;
          results.push({
            path: filePath,
            content: `[Truncated to ${maxChars} chars]\n${truncated}`,
            truncated: true,
            category
          });
          continue;
        }

        // Within budget
        if (lines.length > MAX_LINES_PER_FILE) {
          const truncatedContent = lines.slice(0, MAX_LINES_PER_FILE).join('\n');
          const truncTokens = Math.ceil(truncatedContent.length * TOKENS_PER_CHAR);
          usedTokens += truncTokens;
          results.push({
            path: filePath,
            content: `[First ${MAX_LINES_PER_FILE} of ${lines.length} lines]\n${truncatedContent}`,
            truncated: true,
            category
          });
        } else {
          usedTokens += estimatedTokens;
          results.push({ path: filePath, content, category });
        }
      } catch {
        results.push({ path: filePath, content: null, note: '읽기 실패', category });
      }
    }
  }

  return results;
}

/**
 * Parse phase-decisions.md into structured PD array.
 * Format: sections Active/Summary/Archived with ### PD-N headers.
 *
 * @param {string} cwd - Working directory
 * @returns {Array<{ id: string, title: string, from_phase: string, type?: string, affected_files: string[], summary: string, section: string }>}
 */
export function readPhaseDecisions(cwd) {
  const pdPath = join(cwd, STATE_DIR, 'mpl', 'phase-decisions.md');
  if (!existsSync(pdPath)) return [];

  try {
    const content = readFileSync(pdPath, 'utf-8');
    const pds = [];
    let currentSection = 'unknown';

    const lines = content.split('\n');
    let currentPD = null;

    for (const line of lines) {
      // Detect section headers
      if (/^## Active Decisions/i.test(line)) {
        currentSection = 'active';
        continue;
      }
      if (/^## Summary Decisions/i.test(line)) {
        currentSection = 'summary';
        continue;
      }
      if (/^## Archived Decisions/i.test(line)) {
        currentSection = 'archived';
        continue;
      }

      // Parse PD header: ### PD-N: Title
      const pdMatch = line.match(/^###\s+(PD-\d+(?:-override-?\d*)?)\s*:\s*(.+)/);
      if (pdMatch) {
        if (currentPD) pds.push(currentPD);
        currentPD = {
          id: pdMatch[1],
          title: pdMatch[2].trim(),
          from_phase: null,
          type: null,
          affected_files: [],
          summary: '',
          section: currentSection,
          raw_lines: []
        };
        continue;
      }

      // Parse summary table rows: | PD-N | description | phase | files |
      if (currentSection === 'summary' || currentSection === 'archived') {
        const tableMatch = line.match(/^\|\s*(PD-\d+)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|/);
        if (tableMatch) {
          pds.push({
            id: tableMatch[1],
            title: tableMatch[2].trim(),
            from_phase: `phase-${tableMatch[3]}`,
            type: null,
            affected_files: tableMatch[4].split(',').map(f => f.trim()).filter(Boolean),
            summary: tableMatch[2].trim(),
            section: currentSection,
            raw_lines: [line]
          });
          continue;
        }
      }

      // Accumulate lines for current PD
      if (currentPD) {
        currentPD.raw_lines.push(line);

        // Parse metadata lines
        const phaseMatch = line.match(/^-\s*Phase:\s*(.+)/i);
        if (phaseMatch) {
          const phases = phaseMatch[1].match(/(\d+)/);
          if (phases) currentPD.from_phase = `phase-${phases[0]}`;
        }

        const filesMatch = line.match(/^-\s*Files?:\s*(.+)/i);
        if (filesMatch) {
          currentPD.affected_files = filesMatch[1].split(',').map(f => f.trim()).filter(Boolean);
        }

        const typeMatch = line.match(/^-\s*Type:\s*(.+)/i);
        if (typeMatch) {
          currentPD.type = typeMatch[1].trim();
        }

        const currentMatch = line.match(/^-\s*Current:\s*(.+)/i);
        if (currentMatch) {
          currentPD.current_value = currentMatch[1].trim();
        }
      }
    }

    // Push last PD
    if (currentPD) pds.push(currentPD);

    // Build summary for PDs that don't have one
    for (const pd of pds) {
      if (!pd.summary) {
        pd.summary = pd.title;
      }
    }

    return pds;
  } catch {
    return [];
  }
}

/**
 * Append a discovery to .uam/discoveries.md
 * @param {string} cwd - Working directory
 * @param {{ id: string, phase: string, description: string, status: string, pp_conflict?: string }} discovery
 */
export function appendDiscovery(cwd, discovery) {
  const discPath = join(cwd, STATE_DIR, 'discoveries.md');
  const header = '# Discoveries\n\n';

  let content = '';
  if (existsSync(discPath)) {
    content = readFileSync(discPath, 'utf-8');
  } else {
    content = header;
    mkdirSync(join(cwd, STATE_DIR), { recursive: true });
  }

  const ppNote = discovery.pp_conflict ? ` [PP conflict: ${discovery.pp_conflict}]` : '';
  const entry = `- ${discovery.id} (Phase ${discovery.phase}): ${discovery.description} [status: ${discovery.status}]${ppNote}\n`;

  content += entry;
  writeFileSync(discPath, content);
}

/**
 * Save architecture anchor from decomposer output to .uam/mpl/architecture-anchor.md
 * @param {string} cwd - Working directory
 * @param {{ tech_stack: string[], directory_pattern: string, naming_convention: string, key_decisions: string[] }} anchor
 */
export function saveArchitectureAnchor(cwd, anchor) {
  const mplDir = join(cwd, STATE_DIR, 'mpl');
  mkdirSync(mplDir, { recursive: true });

  const lines = [
    '# Architecture Anchor',
    '',
    '## Tech Stack',
    ...(anchor.tech_stack || []).map(t => `- ${t}`),
    '',
    '## Directory Pattern',
    anchor.directory_pattern || '(not specified)',
    '',
    '## Naming Convention',
    anchor.naming_convention || '(not specified)',
    '',
    '## Key Decisions',
    ...(anchor.key_decisions || []).map(d => `- ${d}`),
    ''
  ];

  writeFileSync(join(mplDir, 'architecture-anchor.md'), lines.join('\n'));
}

/**
 * Deep merge two objects (shallow for arrays, with prototype pollution guard)
 */
export function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (DANGEROUS_KEYS.has(key)) continue;

    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
