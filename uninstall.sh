#!/bin/bash
set -euo pipefail

# UAM-MPL Plugin Uninstaller
# Uses Claude Code CLI (claude plugin) for proper cleanup.
#
# Usage:
#   ./uninstall.sh          # remove plugin and marketplace
#   ./uninstall.sh --clean  # also remove .uam/ state directory

PLUGIN_NAME="uam-mpl"
MARKETPLACE_NAME="uam-mpl-local"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}UAM-MPL Plugin Uninstaller${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"

removed=0

# ── Step 1: Uninstall plugin via CLI ───────────────────────────

echo -e "${BLUE}[1/3] 플러그인 제거${NC}"

if claude plugin uninstall "$PLUGIN_NAME" 2>/dev/null; then
  echo -e "${GREEN}  ✓ 플러그인 제거 (CLI)${NC}"
  removed=1
else
  # Fallback: manual cleanup
  INSTALLED="$HOME/.claude/plugins/installed_plugins.json"
  if [[ -f "$INSTALLED" ]]; then
    node -e "
      const fs = require('fs');
      const d = JSON.parse(fs.readFileSync('$INSTALLED','utf8'));
      if (d.plugins && d.plugins['$PLUGIN_NAME@$MARKETPLACE_NAME']) {
        delete d.plugins['$PLUGIN_NAME@$MARKETPLACE_NAME'];
        fs.writeFileSync('$INSTALLED', JSON.stringify(d, null, 2));
        console.log('removed');
      }
    " 2>/dev/null && echo -e "${GREEN}  ✓ installed_plugins.json에서 제거${NC}" && removed=1
  fi
fi

# ── Step 2: Remove marketplace via CLI ─────────────────────────

echo -e "${BLUE}[2/3] 마켓플레이스 제거${NC}"

if claude plugin marketplace remove "$MARKETPLACE_NAME" 2>/dev/null; then
  echo -e "${GREEN}  ✓ 마켓플레이스 제거 (CLI)${NC}"
  removed=1
else
  # Fallback: manual cleanup
  KNOWN_MKT="$HOME/.claude/plugins/known_marketplaces.json"
  if [[ -f "$KNOWN_MKT" ]]; then
    node -e "
      const fs = require('fs');
      const d = JSON.parse(fs.readFileSync('$KNOWN_MKT','utf8'));
      if (d['$MARKETPLACE_NAME']) {
        delete d['$MARKETPLACE_NAME'];
        fs.writeFileSync('$KNOWN_MKT', JSON.stringify(d, null, 2));
        console.log('removed');
      }
    " 2>/dev/null && echo -e "${GREEN}  ✓ known_marketplaces.json에서 제거${NC}" && removed=1
  fi
fi

# ── Step 3: Clean residual files ───────────────────────────────

echo -e "${BLUE}[3/3] 잔여 파일 정리${NC}"

# Cache directory
CACHE_PARENT="$HOME/.claude/plugins/cache/$MARKETPLACE_NAME"
if [[ -d "$CACHE_PARENT" ]]; then
  rm -rf "$CACHE_PARENT"
  echo -e "${GREEN}  ✓ 캐시 제거: $CACHE_PARENT${NC}"
  removed=1
fi

# Marketplace symlink
MARKETPLACE_LINK="$HOME/.claude/plugins/marketplaces/$MARKETPLACE_NAME"
if [[ -L "$MARKETPLACE_LINK" ]]; then
  rm "$MARKETPLACE_LINK"
  echo -e "${GREEN}  ✓ 마켓플레이스 심링크 제거${NC}"
  removed=1
fi

# Project symlink
PROJECT_LINK=".claude/plugins/$PLUGIN_NAME"
if [[ -L "$PROJECT_LINK" ]]; then
  rm "$PROJECT_LINK"
  echo -e "${GREEN}  ✓ 프로젝트 심링크 제거${NC}"
  removed=1
fi

# Optional: clean .uam state
if [[ "${1:-}" == "--clean" ]]; then
  if [[ -d ".uam" ]]; then
    rm -rf .uam
    echo -e "${GREEN}  ✓ .uam/ 상태 디렉토리 제거${NC}"
  fi
fi

# ── Summary ─────────────────────────────────────────────────────

echo ""
if (( removed == 0 )); then
  echo "설치된 UAM-MPL 플러그인을 찾을 수 없습니다."
else
  echo -e "${GREEN}제거 완료. Claude Code를 재시작하세요.${NC}"
  echo "상태 파일도 제거하려면: ./uninstall.sh --clean"
fi
