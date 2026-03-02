#!/bin/bash
set -euo pipefail

# UAM-MPL Plugin Installer
# Uses Claude Code CLI (claude plugin) for proper registration.
#
# Usage:
#   ./install.sh              # interactive scope selection
#   ./install.sh --global     # install for all projects (user scope)
#   ./install.sh --project    # install for current project only
#   ./install.sh --update     # re-sync after source changes

UAM_MPL_ROOT="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_NAME="uam-mpl"
MARKETPLACE_NAME="uam-mpl-local"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${GREEN}UAM-MPL Plugin Installer${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Prerequisites ──────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  echo -e "${RED}Error: Node.js 16+ required${NC}"
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if (( NODE_VER < 16 )); then
  echo -e "${RED}Error: Node.js 16+ required (found v${NODE_VER})${NC}"
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo -e "${RED}Error: Claude Code CLI not found${NC}"
  echo "Install: https://docs.anthropic.com/en/docs/claude-code"
  exit 1
fi

# ── Validate plugin manifest ──────────────────────────────────

PLUGIN_JSON="$UAM_MPL_ROOT/.claude-plugin/plugin.json"
MARKETPLACE_JSON="$UAM_MPL_ROOT/.claude-plugin/marketplace.json"

if [[ ! -f "$PLUGIN_JSON" ]]; then
  echo -e "${RED}Error: .claude-plugin/plugin.json not found${NC}"
  exit 1
fi

if [[ ! -f "$MARKETPLACE_JSON" ]]; then
  echo -e "${RED}Error: .claude-plugin/marketplace.json not found${NC}"
  exit 1
fi

echo -e "${BLUE}Plugin: ${NC}$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PLUGIN_JSON','utf8')).name)")"
echo -e "${BLUE}Version: ${NC}$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PLUGIN_JSON','utf8')).version)")"
echo ""

# ── Parse flags ────────────────────────────────────────────────

SCOPE="${1:-}"
UPDATE_MODE=false

if [[ "$SCOPE" == "--update" ]]; then
  UPDATE_MODE=true
  SCOPE="global"
elif [[ "$SCOPE" == "--global" ]]; then
  SCOPE="user"
elif [[ "$SCOPE" == "--project" ]]; then
  SCOPE="project"
elif [[ -z "$SCOPE" ]]; then
  echo "설치 범위를 선택하세요:"
  echo "  1) global  — 모든 프로젝트에서 /uam-mpl:* 사용 가능 (권장)"
  echo "  2) project — 현재 프로젝트에서만 /project:uam-mpl-* 사용 가능"
  echo ""
  read -rp "선택 [1/2]: " choice
  case "$choice" in
    1|global) SCOPE="user" ;;
    2|project) SCOPE="project" ;;
    *) echo -e "${RED}잘못된 선택${NC}"; exit 1 ;;
  esac
fi

# ── Update mode: re-sync cache ─────────────────────────────────

if [[ "$UPDATE_MODE" == true ]]; then
  echo -e "${BLUE}[update] 캐시 동기화 중...${NC}"

  # Update marketplace source
  claude plugin marketplace update "$MARKETPLACE_NAME" 2>/dev/null || true

  # Reinstall to refresh cache
  claude plugin uninstall "$PLUGIN_NAME" 2>/dev/null || true
  claude plugin install "${PLUGIN_NAME}@${MARKETPLACE_NAME}" --scope user 2>/dev/null

  echo -e "${GREEN}✓ 캐시 동기화 완료${NC}"
  echo ""
  echo -e "${GREEN}Claude Code를 재시작하면 변경사항이 적용됩니다.${NC}"
  exit 0
fi

# ── Step 1: Register marketplace ───────────────────────────────

echo -e "${BLUE}[1/3] 마켓플레이스 등록${NC}"

# Remove existing marketplace if present (idempotent)
claude plugin marketplace remove "$MARKETPLACE_NAME" 2>/dev/null || true

# Add directory as marketplace
if claude plugin marketplace add "$UAM_MPL_ROOT" 2>&1; then
  echo -e "${GREEN}  ✓ 마켓플레이스 등록: $MARKETPLACE_NAME${NC}"
else
  echo -e "${RED}  ✗ 마켓플레이스 등록 실패${NC}"
  echo ""
  echo "수동 등록을 시도합니다..."

  # Fallback: manual registration
  PLUGINS_DIR="$HOME/.claude/plugins"
  KNOWN_MKT="$PLUGINS_DIR/known_marketplaces.json"
  MARKETPLACE_LINK="$PLUGINS_DIR/marketplaces/$MARKETPLACE_NAME"

  mkdir -p "$PLUGINS_DIR/marketplaces"

  # Symlink
  [[ -L "$MARKETPLACE_LINK" ]] && rm "$MARKETPLACE_LINK"
  ln -sf "$UAM_MPL_ROOT" "$MARKETPLACE_LINK"

  # known_marketplaces.json
  if [[ -f "$KNOWN_MKT" ]]; then
    node -e "
      const fs = require('fs');
      const d = JSON.parse(fs.readFileSync('$KNOWN_MKT','utf8'));
      d['$MARKETPLACE_NAME'] = {
        source: { source: 'directory', path: '$UAM_MPL_ROOT' },
        installLocation: '$UAM_MPL_ROOT',
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync('$KNOWN_MKT', JSON.stringify(d, null, 2));
    "
  else
    node -e "
      const fs = require('fs');
      const d = {};
      d['$MARKETPLACE_NAME'] = {
        source: { source: 'directory', path: '$UAM_MPL_ROOT' },
        installLocation: '$UAM_MPL_ROOT',
        lastUpdated: new Date().toISOString()
      };
      fs.mkdirSync('$(dirname "$KNOWN_MKT")', { recursive: true });
      fs.writeFileSync('$KNOWN_MKT', JSON.stringify(d, null, 2));
    "
  fi
  echo -e "${GREEN}  ✓ 마켓플레이스 수동 등록 완료${NC}"
fi

# ── Step 2: Install plugin ─────────────────────────────────────

echo -e "${BLUE}[2/3] 플러그인 설치${NC}"

# Remove existing installation (idempotent)
claude plugin uninstall "$PLUGIN_NAME" 2>/dev/null || true

if claude plugin install "${PLUGIN_NAME}@${MARKETPLACE_NAME}" --scope "$SCOPE" 2>&1; then
  echo -e "${GREEN}  ✓ 플러그인 설치 완료 (scope: $SCOPE)${NC}"
else
  echo -e "${RED}  ✗ CLI 설치 실패${NC}"
  echo ""
  echo "수동 설치를 시도합니다..."

  # Fallback: manual installation
  PLUGINS_DIR="$HOME/.claude/plugins"
  INSTALLED="$PLUGINS_DIR/installed_plugins.json"
  PLUGIN_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PLUGIN_JSON','utf8')).version)")
  CACHE_DIR="$PLUGINS_DIR/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$PLUGIN_VERSION"

  GIT_SHA=""
  if command -v git &>/dev/null; then
    GIT_SHA=$(cd "$UAM_MPL_ROOT" && git rev-parse HEAD 2>/dev/null || echo "")
  fi

  # Copy to cache
  mkdir -p "$CACHE_DIR"
  rsync -a --delete \
    --exclude='.git' --exclude='.omc' --exclude='node_modules' \
    "$UAM_MPL_ROOT/" "$CACHE_DIR/"
  echo -e "${GREEN}  ✓ 캐시 복사: $CACHE_DIR${NC}"

  # Register in installed_plugins.json
  INSTALL_SCOPE="user"
  [[ "$SCOPE" == "project" ]] && INSTALL_SCOPE="project"

  if [[ -f "$INSTALLED" ]]; then
    node -e "
      const fs = require('fs');
      const d = JSON.parse(fs.readFileSync('$INSTALLED','utf8'));
      d.plugins = d.plugins || {};
      d.plugins['$PLUGIN_NAME@$MARKETPLACE_NAME'] = [{
        scope: '$INSTALL_SCOPE',
        installPath: '$CACHE_DIR',
        version: '$PLUGIN_VERSION',
        installedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        gitCommitSha: '$GIT_SHA' || undefined
      }];
      fs.writeFileSync('$INSTALLED', JSON.stringify(d, null, 2));
    "
  else
    node -e "
      const fs = require('fs');
      const d = { version: 2, plugins: {} };
      d.plugins['$PLUGIN_NAME@$MARKETPLACE_NAME'] = [{
        scope: '$INSTALL_SCOPE',
        installPath: '$CACHE_DIR',
        version: '$PLUGIN_VERSION',
        installedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        gitCommitSha: '$GIT_SHA' || undefined
      }];
      fs.mkdirSync('$(dirname "$INSTALLED")', { recursive: true });
      fs.writeFileSync('$INSTALLED', JSON.stringify(d, null, 2));
    "
  fi
  echo -e "${GREEN}  ✓ 수동 플러그인 등록 완료${NC}"
fi

# ── Step 3: Verify ─────────────────────────────────────────────

echo -e "${BLUE}[3/3] 설치 검증${NC}"

errors=0

# Check marketplace registration
KNOWN_MKT="$HOME/.claude/plugins/known_marketplaces.json"
if [[ -f "$KNOWN_MKT" ]] && node -e "
  const d = JSON.parse(require('fs').readFileSync('$KNOWN_MKT','utf8'));
  process.exit(d['$MARKETPLACE_NAME'] ? 0 : 1);
" 2>/dev/null; then
  echo -e "${GREEN}  ✓ 마켓플레이스 등록 확인${NC}"
else
  echo -e "${RED}  ✗ 마켓플레이스 미등록${NC}"
  ((errors++))
fi

# Check installed_plugins.json
INSTALLED="$HOME/.claude/plugins/installed_plugins.json"
if [[ -f "$INSTALLED" ]] && node -e "
  const d = JSON.parse(require('fs').readFileSync('$INSTALLED','utf8'));
  process.exit(d.plugins && d.plugins['$PLUGIN_NAME@$MARKETPLACE_NAME'] ? 0 : 1);
" 2>/dev/null; then
  echo -e "${GREEN}  ✓ 플러그인 등록 확인${NC}"
else
  echo -e "${RED}  ✗ 플러그인 미등록${NC}"
  ((errors++))
fi

# Check critical files in cache
PLUGIN_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PLUGIN_JSON','utf8')).version)")
CACHE_DIR="$HOME/.claude/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$PLUGIN_VERSION"
for check_path in ".claude-plugin/plugin.json" "hooks/hooks.json" "skills/uam-mpl/SKILL.md" "agents/uam-worker.md"; do
  if [[ -f "$CACHE_DIR/$check_path" ]]; then
    echo -e "${GREEN}  ✓ $check_path${NC}"
  else
    echo -e "${RED}  ✗ $check_path 누락${NC}"
    ((errors++))
  fi
done

# Check hooks field in cached plugin.json
if node -e "
  const d = JSON.parse(require('fs').readFileSync('$CACHE_DIR/.claude-plugin/plugin.json','utf8'));
  process.exit(d.hooks ? 0 : 1);
" 2>/dev/null; then
  echo -e "${GREEN}  ✓ plugin.json hooks 필드 확인${NC}"
else
  echo -e "${RED}  ✗ plugin.json에 hooks 필드 누락${NC}"
  ((errors++))
fi

# ── Summary ─────────────────────────────────────────────────────

echo ""
if (( errors == 0 )); then
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}설치 완료! Claude Code를 재시작하면 활성화됩니다.${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  if [[ "$SCOPE" == "user" ]]; then
    echo "스킬 접두사: /uam-mpl:*"
    echo "예시: /uam-mpl:uam-mpl, /uam-mpl:uam-mpl-status"
  else
    echo "스킬 접두사: /project:uam-mpl-*"
  fi
  echo ""
  echo "소스 수정 후 갱신: ./install.sh --update"
  echo "제거:               ./uninstall.sh"
else
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}설치 중 $errors 개 오류 발생${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "문제 해결:"
  echo "  1. ./uninstall.sh 로 정리 후 다시 시도"
  echo "  2. claude plugin validate $UAM_MPL_ROOT 로 매니페스트 검증"
  exit 1
fi
