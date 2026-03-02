# UAM-MPL (Micro-Phase Loop) Plugin

UAM-MPL은 사용자 요청을 작은 마이크로 페이즈로 분해하고, 각 페이즈를 독립적인 plan-execute-verify 미니 루프로 실행하는 Claude Code 플러그인입니다.

## 특징

- **마이크로 페이즈 분해**: 복잡한 작업을 3~8개의 작은 페이즈로 자동 분해
- **Fresh Session**: 각 페이즈는 독립 세션으로 실행되어 컨텍스트 오염 방지
- **3-Tier PD 관리**: Phase Decisions를 Active/Summary/Archived로 분류하여 토큰 예산 내 관리
- **Circuit Breaker**: 페이즈 실패 시 최대 3회 재시도 + 2회 재분해로 무한 루프 방지
- **Orchestrator-Worker 분리**: 오케스트레이터는 소스 코드를 직접 작성하지 않음 (PreToolUse 훅으로 강제)
- **완전 독립**: 다른 플러그인에 의존하지 않는 자족적 Claude Code 플러그인

## 설치

### 요구사항

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 설치 필요
- Node.js 16+

### Claude Code CLI로 설치 (권장)

```bash
# Global 설치 — 모든 프로젝트에서 /uam-mpl:* 사용 가능
./install.sh --global

# Project 설치 — 현재 프로젝트에서만 /project:uam-mpl-* 사용 가능
./install.sh --project

# 대화형 설치 (범위 선택)
./install.sh
```

install.sh는 내부적으로 Claude Code 공식 플러그인 CLI를 사용합니다:

1. `claude plugin marketplace add` — 로컬 디렉토리를 마켓플레이스로 등록
2. `claude plugin install` — 플러그인 설치 및 캐시
3. 자동 검증 — 7개 항목 체크 (마켓플레이스, 레지스트리, plugin.json, hooks.json, skills, agents)

### 소스 수정 후 캐시 갱신

플러그인 소스를 수정한 후에는 캐시를 갱신해야 합니다:

```bash
./install.sh --update
```

### 제거

```bash
./uninstall.sh          # 플러그인 제거
./uninstall.sh --clean  # 플러그인 + .uam/ 상태 파일 제거
```

## 사용법

### 키워드 자동 감지

사용자 입력에 `mpl` 키워드가 포함되면 자동으로 MPL 파이프라인이 활성화됩니다.

```
mpl build a REST API for task management
```

### 스킬 직접 호출

```
/uam-mpl:uam-mpl          # MPL 파이프라인 시작
/uam-mpl:uam-mpl-status   # 진행 상태 확인
/uam-mpl:uam-mpl-cancel   # 파이프라인 취소
/uam-mpl:uam-mpl-resume   # 중단된 페이즈부터 재개
```

## 아키텍처

### 파이프라인 흐름

```
mpl-init --> mpl-decompose --> mpl-phase-running <--> mpl-phase-complete
                  ^                    |                       |
                  +--- mpl-circuit-break               mpl-finalize --> completed
                             |
                         mpl-failed
```

| 단계 | 이름 | 핵심 액션 | 에이전트 |
|------|------|----------|---------|
| 0 | PP Interview | 불변 제약사항 정의 | 오케스트레이터 |
| 1 | Codebase Analysis | 구조 분석 | 오케스트레이터 |
| 2 | Phase Decomposition | 마이크로 페이즈 분해 | uam-decomposer (opus) |
| 3 | Phase Execution Loop | 페이즈별 plan->execute->verify | uam-phase-runner x N |
| 4 | Finalize | 학습 추출 + 커밋 | uam-git-master |

### 3-Tier 상태 관리

| 파일 | 범위 | 용도 |
|------|------|------|
| `.uam/state.json` | 파이프라인 | 최상위 상태 머신 (run_mode, current_phase) |
| `.uam/mpl/state.json` | MPL | 페이즈 추적 (total, completed, current) |
| `.uam/mpl/phases/phase-N/state-summary.md` | 페이즈 | 지식 전달 SSOT (다음 페이즈에 전달되는 유일한 정보) |

### 지식 전달 규칙

각 페이즈의 `state-summary.md`만 다음 페이즈의 컨텍스트에 로드됩니다. 암묵적 컨텍스트 누출이 없어 토큰 오버런을 방지하고 재현성을 보장합니다.

### 상태 파일 전체 목록

| 파일 | 용도 |
|------|------|
| `.uam/state.json` | 파이프라인 상태 (run_mode: "mpl") |
| `.uam/mpl/state.json` | MPL 실행 상태 |
| `.uam/mpl/decomposition.yaml` | 페이즈 분해 결과 |
| `.uam/mpl/phase-decisions.md` | 누적 Phase Decisions (3-Tier) |
| `.uam/mpl/phases/phase-N/` | 페이즈별 아티팩트 |
| `.uam/pivot-points.md` | 불변 제약사항 |

## 에이전트

| 에이전트 | 역할 | 모델 |
|---------|------|------|
| uam-decomposer | 페이즈 분해 (순수 추론, 도구 없음) | opus |
| uam-phase-runner | 페이즈 실행 (미니플랜 + 워커 위임 + 검증) | sonnet |
| uam-worker | TODO 구현 (코드 작성, JSON 출력) | sonnet |
| uam-explore | 코드베이스 탐색 (읽기 전용) | haiku |
| uam-git-master | 원자적 커밋 + 스타일 감지 | sonnet |
| uam-designer | UI/UX 설계 분석 | sonnet |
| uam-frontend | 프론트엔드 구현 | sonnet |
| uam-debugger | 루트 코즈 분석 + 버그 분류 | sonnet |

## 훅 시스템

| 훅 | 이벤트 | 역할 |
|----|--------|------|
| mpl-keyword-detector | UserPromptSubmit | `mpl` 키워드 감지, 상태 초기화 |
| mpl-write-guard | PreToolUse (Edit/Write) | 오케스트레이터의 소스 코드 직접 작성 차단 |
| mpl-validate-output | PostToolUse (Task) | 워커 에이전트 출력 구조 검증 |
| mpl-phase-controller | Stop | 상태 머신 전환, 서킷 브레이커 |

## 플러그인 구조

```
uam-mpl/
  .claude-plugin/
    plugin.json           # 플러그인 메타데이터 (name, version, skills, hooks)
    marketplace.json      # 마켓플레이스 등록 정보
  agents/                 # 8개 전문 에이전트 정의
  commands/
    uam-mpl-run.md        # 전체 오케스트레이션 프로토콜
  hooks/
    hooks.json            # 훅 설정 (PreToolUse, PostToolUse, Stop, UserPromptSubmit)
    mpl-*.mjs             # 훅 구현
    lib/                  # 공유 유틸리티 (상태 관리, stdin 파서)
  skills/
    uam-mpl/SKILL.md      # 메인 파이프라인 스킬
    uam-mpl-status/       # 상태 대시보드
    uam-mpl-cancel/       # 파이프라인 취소
    uam-mpl-resume/       # 파이프라인 재개
  docs/                   # 설계 문서
  install.sh              # 설치 스크립트 (Claude Code CLI 기반)
  uninstall.sh            # 제거 스크립트
```

## 설계 문서

자세한 설계 사양은 `docs/` 디렉토리를 참조하세요.

| 문서 | 내용 |
|------|------|
| 00_decisions.md | 핵심 설계 결정 |
| 01_problem_statement.md | 문제 정의 |
| 02_architecture.md | 전체 아키텍처 |
| 03_pp_anchor.md | Pivot Points 앵커 설계 |
| 04_decomposer_design.md | Phase Decomposer 설계 |
| 05_dependency_graph_impl.md | 의존성 그래프 구현 |
| 06_decomposer_prompt.md | Decomposer 프롬프트 설계 |
| 07_phase_runner.md | Phase Runner 상세 |
| 08_walkthrough.md | 전체 흐름 워크스루 |
| 09_pd_accumulation.md | Phase Decisions 누적 설계 |
| 10_evaluation_framework.md | 평가 프레임워크 |
| 11_uam_integration.md | UAM 통합 가이드 |
| 12_review_findings.md | 리뷰 결과 |
| 13_orchestrator_design.md | 오케스트레이터 설계 |
| 14_brownfield_walkthrough.md | 브라운필드 워크스루 |

## License

MIT
