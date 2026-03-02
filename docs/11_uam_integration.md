# 11. UAM 통합 전략: 별도 모드로 운영

## 결정: MPL은 UAM과 별도 모드

MPL을 UAM v2로 대체하는 것이 아니라, UAM의 **새로운 실행 모드**로 추가한다.

```
UAM
├── standard (현행 5-Phase pipeline)
│   └── Phase 1에서 전체 계획 → Phase 2에서 전체 실행
│
└── mpl (Micro-Phase Loop) ← 신규
    └── Phase Decomposer → 작은 phase × N loop
```

---

## 이유: 왜 대체가 아닌 병행인가

### 1. 모든 작업에 MPL이 필요하진 않다

```
간단한 작업 (bugfix, 소규모 기능):
  → 현행 UAM standard가 더 효율적
  → Phase 분해 overhead가 이득을 초과

복잡한 작업 (풀스택 구현, 대규모 리팩토링):
  → MPL이 효과적
  → 계획 노후화, 컨텍스트 누적 문제가 실제로 발생
```

### 2. UAM의 기존 인프라를 재사용

MPL이 새로 만들어야 하는 것은 적다:

| 컴포넌트 | UAM에 이미 있는 것 | MPL에서 재사용 |
|----------|-------------------|---------------|
| PP Interview | `uam-pivot` 스킬 | 그대로 사용 |
| Worker 위임 | `uam-worker` 에이전트 | 그대로 사용 |
| Discovery 처리 | Discovery 충돌 검사 로직 | 그대로 사용 |
| Quality Gate | Phase 3 (Docker + multi-model) | Phase Runner의 verify에서 호출 |
| Maturity Mode | explore/standard/strict | 그대로 사용 |
| PLAN.md | checkbox SSOT | Phase별 mini-PLAN.md로 축소 |
| Orchestrator-Worker 분리 | PreToolUse hook | 그대로 사용 |
| Atomic Commit | `uam-git-master` | 그대로 사용 |
| Knowledge Extraction | Phase 5 compound | Phase 완료마다 PD로 축소 적용 |

### 3. 점진적 검증 가능

```
Step 1: MPL을 별도 모드로 구현, standard와 나란히
Step 2: 동일 task로 standard vs mpl 비교 실험
Step 3: 결과에 따라 기본 모드 결정 또는 자동 선택 로직 추가
```

---

## 모드 선택 기준

### 수동 선택

```
/uam "할 일"                  → standard (기본)
/uam --mpl "할 일"            → MPL 모드
/uam-small "할 일"            → small (기존 경량 모드)
```

### 자동 선택 (향후)

```
자동 판단 기준:
  codebase_analyze 결과에서:
    - 예상 변경 파일 수 > 10  → mpl 권장
    - high_impact 파일 포함   → mpl 권장
    - 예상 TODO 수 > 8       → mpl 권장
    - 순환 의존 존재          → mpl 권장

  그 외:
    - 예상 변경 파일 수 < 5   → standard
    - 단일 모듈 내 작업       → standard 또는 small
```

---

## 파일 구조

### 현행 UAM 구조

```
.uam/
├── pivot-points.md
├── discoveries.md
├── PLAN.md              ← 전체 계획 (단일)
├── research/
│   └── report.md
└── state.json
```

### MPL 모드 추가 시

```
.uam/
├── pivot-points.md          # 공유 (standard/mpl 모두 사용)
├── discoveries.md           # 공유
│
├── PLAN.md                  # standard 모드용 (기존)
│
├── mpl/                     # MPL 모드 전용
│   ├── codebase-analysis.json    # codebase_analyze 출력 (캐시)
│   ├── decomposition.yaml        # Phase Decomposer 출력
│   ├── phase-decisions.md        # PD 누적 문서
│   ├── architecture-anchor.md    # 아키텍처 앵커
│   │
│   ├── phases/                   # Phase별 산출물
│   │   ├── phase-1/
│   │   │   ├── mini-plan.md      # 이 phase의 TODO
│   │   │   ├── state-summary.md  # 완료 후 요약
│   │   │   └── verification.md   # 검증 결과
│   │   ├── phase-2/
│   │   │   └── ...
│   │   └── phase-3/
│   │       └── ...
│   │
│   └── state.json               # MPL 실행 상태
│
├── research/
│   └── report.md            # 공유
└── state.json               # UAM 전체 상태
```

---

## 실행 흐름 비교

### Standard 모드 (현행)

```
/uam "REST API 구현"
  → Phase 0: PP Interview
  → Phase 1: Quick Plan → PLAN.md (전체)
  → Phase 2: MVP Sprint → 전체 TODO 실행
  → Phase 3: Quality Gate
  → Phase 4: Fix Loop
  → Phase 5: Finalize
```

### MPL 모드

```
/uam --mpl "REST API 구현"
  → Phase 0: PP Interview (동일)
  → codebase_analyze → .uam/mpl/codebase-analysis.json
  → phase_decompose → .uam/mpl/decomposition.yaml
  → Phase 1 Runner: [mini-plan → execute → verify → summarize]
  → Phase 2 Runner: [mini-plan → execute → verify → summarize]
  → Phase 3 Runner: [mini-plan → execute → verify → summarize]
  → Finalize: Knowledge extraction (동일)
```

### 공유되는 것

```
공유 컴포넌트:
  - PP Interview (uam-pivot)
  - Worker 에이전트 (uam-worker)
  - Discovery 처리 로직
  - Quality Gate (선택적으로 각 phase verify에서 호출)
  - Atomic Commit (uam-git-master)
  - Finalize (knowledge extraction)

MPL 전용 컴포넌트:
  - codebase_analyze (Input Provider)
  - phase_decompose (Decomposer)
  - phase_run (Phase Runner)
  - Phase Decisions (PD) 관리
  - State Summary 생성
```

---

## UAM 스킬 확장

### 기존 스킬 수정

```yaml
# skills/uam/SKILL.md 수정
# --mpl 플래그 추가

실행 모드 판별:
  if args contain "--mpl":
    execution_mode = "mpl"
  elif args contain "--small":
    execution_mode = "small"
  else:
    execution_mode = "standard"
```

### 신규 스킬/커맨드

```
skills/
  uam-mpl/SKILL.md          # /uam-mpl "task" (MPL 직접 호출)

commands/
  uam-mpl-run.md             # MPL 실행 상세 프로토콜

agents/
  uam-decomposer.md          # Phase Decomposer 에이전트 정의
  uam-phase-runner.md        # Phase Runner 에이전트 정의
```

---

## 상태 관리

### state.json 확장

```json
{
  "mode": "mpl",
  "status": "running",
  "current_phase": "phase-2",
  "total_phases": 4,
  "completed_phases": ["phase-1"],
  "pp_status": "confirmed",
  "maturity_mode": "standard",

  "mpl_specific": {
    "decomposition_timestamp": "2026-03-02T10:00:00Z",
    "codebase_analysis_hash": "abc123",
    "phase_decisions_count": 3,
    "re_decomposition_count": 0
  }
}
```

### Resume 지원

```
MPL은 자연스럽게 resume을 지원:
  - 각 phase가 독립적이므로, 중단 시 마지막 완료 phase 다음부터 재개
  - state.json의 current_phase + completed_phases로 위치 파악
  - PD가 이전 phase의 결과를 보존하므로 컨텍스트 손실 없음

현행 UAM standard는 resume이 어려움:
  - Phase 2 중간에 중단되면 PLAN.md의 어떤 TODO까지 됐는지 추적 필요
  - 컨텍스트가 세션에 묶여있어 새 세션에서 복원 어려움
```

---

## 마이그레이션 경로

```
v1 (현재): UAM standard + small
v2 (MPL 추가): UAM standard + small + mpl
v3 (자동 선택): codebase_analyze 기반 모드 자동 결정
v4 (통합): standard의 내부 구현도 MPL 패턴으로 전환 (optional)
```

v4는 "standard 모드가 phase 1개짜리 MPL"로 볼 수 있다는 점에서 자연스러운 통합.
하지만 실제로 그렇게 할지는 v2~v3 실험 결과에 따라 결정.
