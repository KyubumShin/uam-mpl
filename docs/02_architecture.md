# 02. Micro-Phase Loop Architecture

## 전체 구조

```
User Request
    ↓
[Phase 0: PP Interview]
    ↓
[Phase Decomposer]
    ↓
[Phase 1] → [Phase 2] → ... → [Phase N] → Complete
    각 phase는 독립적인 mini-loop
```

---

## Phase 0: Pivot Points Interview

UAM의 `uam-pivot` 스킬을 차용. 프로젝트 전체의 불변 제약을 사전에 정의한다.
상세 설계는 [03_pp_anchor.md](03_pp_anchor.md) 참조.

---

## Phase Decomposer

### 역할

사용자 요청을 순서화된 작은 phase 목록으로 분해한다.
Architect급 에이전트가 담당.

### Input

```
- user_request: 사용자의 원래 요청
- pivot_points: PP 문서 (.uam/pivot-points.md)
- codebase_summary: 현재 코드베이스 상태 요약
```

### Output

```yaml
architecture_anchor:
  tech_stack: [Node.js, TypeScript, PostgreSQL]
  directory_structure: src/{auth,api,models,utils}/
  naming_convention: camelCase (variables), PascalCase (types)
  key_interfaces: []  # phase 진행하며 채워짐

phases:
  - id: phase-1
    name: "Foundation & DB Schema"
    scope: "프로젝트 초기화, DB 스키마, 기본 서버 설정"
    success_criteria:
      - "npm run build 성공"
      - "DB migration 실행 가능"
      - "서버 시작 후 health check 응답"
    estimated_complexity: S  # S/M/L
    estimated_files: 3~5
    estimated_todos: 3
    dependencies: []

  - id: phase-2
    name: "Core API Endpoints"
    scope: "CRUD API 엔드포인트 구현"
    success_criteria:
      - "모든 엔드포인트 200 응답"
      - "입력 검증 동작"
      - "Phase 1 회귀 테스트 통과"
    estimated_complexity: M
    estimated_files: 4~6
    estimated_todos: 5
    dependencies: [phase-1]

  - id: phase-3
    name: "Authentication & Authorization"
    scope: "JWT 인증, 미들웨어, 권한 검사"
    success_criteria:
      - "인증 없는 요청 401 응답"
      - "권한 없는 요청 403 응답"
      - "Phase 1~2 회귀 테스트 통과"
    estimated_complexity: M
    estimated_files: 3~5
    estimated_todos: 4
    dependencies: [phase-1, phase-2]
```

### Phase 분해 전략

| 전략 | 설명 | 적합한 경우 |
|------|------|------------|
| **Dependency 기반** | 의존성 그래프 순서 | 일반적 기능 구현 |
| **Risk 기반** | 불확실성 높은 것 먼저 | 기술 검증이 필요한 경우 |
| **Layer 기반** | DB → API → UI 순 | 풀스택 구현 |
| **Feature 기반** | 기능 단위 독립 분할 | 서로 독립적인 기능들 |

기본 전략: **Dependency + Risk 하이브리드**
- 의존성 순서를 기본으로
- 불확실성이 높은 것을 앞으로 배치 (fail fast)

---

## Phase Runner

각 phase를 독립적으로 실행하는 mini-loop.

### 실행 흐름

```
Phase N Runner
    │
    ├── 1. Context Loading
    │     ├── pivot-points.md (불변, Layer 1)
    │     ├── phase-decisions.md (누적, Layer 2)
    │     ├── phase_N_definition (이번 phase 정의)
    │     └── codebase_current_state (실제 파일 상태)
    │
    ├── 2. Mini-Plan
    │     ├── 이 phase만의 TODO 3~7개 생성
    │     ├── PP 충돌 사전 검사
    │     └── 이전 PD 참조하여 일관성 확인
    │
    ├── 3. Execute
    │     ├── Worker에게 TODO 위임 (병렬 가능)
    │     ├── Worker Discovery 수집
    │     └── Discovery vs PP 충돌 검사
    │
    ├── 4. Verify
    │     ├── Phase success criteria 검증
    │     ├── 이전 phase 회귀 테스트
    │     └── PP 위반 여부 재확인
    │
    ├── 5. Fix (조건부)
    │     ├── 검증 실패 시 bounded retry (max 3)
    │     └── 구조적 실패 → Phase Decomposer에 재분해 요청
    │
    └── 6. Summarize
          ├── Phase Decisions에 새 결정 추가
          ├── State Summary 생성
          └── Discovery 처리 결과 기록
```

### Context Loading 상세

Phase Runner가 시작할 때 로드하는 정보:

```
Context = {
  // Layer 1: 불변 (모든 phase 동일)
  pivot_points: ".uam/pivot-points.md",  // 공유 (standard/mpl 모두 사용)

  // Layer 2: 누적 (이전 phase들의 결정)
  phase_decisions: ".uam/mpl/phase-decisions.md",

  // Layer 3: 이번 phase 전용
  phase_definition: phases[N],  // Decomposer의 출력

  // Layer 4: 실제 상태
  codebase_state: {
    file_tree: "현재 디렉토리 구조",
    recent_changes: "마지막 phase에서 변경된 파일",
    test_status: "현재 테스트 통과 상태"
  }
}
```

**핵심**: 이전 phase의 전체 실행 히스토리가 아닌, **구조화된 요약만** 전달한다.
이것이 SG-Loop의 "session reset" 이점을 얻으면서도 지식을 보존하는 방법이다.

---

## Phase 크기 (Granularity)

### 적정 범위

```
너무 작으면: overhead > 이득 (계획+검증 비용이 실행 비용 초과)
너무 크면:   현행 Big Plan과 동일한 문제 재발
```

| 크기 | TODO 수 | 파일 변경 | 예상 실행 시간 | 적합한 경우 |
|------|---------|----------|-------------|------------|
| Small (S) | 1~3 | 1~3 | 5~10분 | 탐색/프로토타입 |
| Medium (M) | 3~5 | 2~5 | 10~20분 | 일반 개발 |
| Large (L) | 5~7 | 4~8 | 20~30분 | 안정적 구현 |

### Maturity Mode에 따른 크기 조절

| Maturity | 기본 Phase 크기 | 이유 |
|----------|---------------|------|
| `explore` | Small | 빠른 피드백, 잦은 방향 전환 |
| `standard` | Medium | 균형 |
| `strict` | Large | 안정성 우선, 변경 최소화 |

---

## 실패 처리

### Phase 내 실패

```
검증 실패 → bounded retry (max 3)
  ├── Simple failure (1~2 테스트 실패): 즉시 수정
  ├── Repeated failure (같은 오류 3회): mini-plan 재작성
  └── Structural failure (50%+ 실패): Phase Decomposer에 재분해 요청
```

### Phase 간 충돌

```
Phase N의 결과가 Phase N+1의 전제를 깨는 경우:
  → Phase N+1의 mini-plan에서 감지 (PP/PD 충돌 검사)
  → Phase N+1의 계획을 현실에 맞게 조정
  → Phase N은 수정하지 않음 (이미 검증 완료)
```

### 전체 재분해 (Circuit Breaker)

```
조건: Phase 내 3회 retry 실패 + 구조적 문제 판단
  → Phase Decomposer에게 남은 phases 재분해 요청
  → 기존 완료된 phase의 성과는 보존
  → 새로운 phase 목록으로 계속 진행
  → 재분해는 최대 2회 (max_redecompose=2). 초과 시 FAILED 종료.
```

---

## 예상 비용 프로파일

### 현행 UAM vs MPL 비교

```
UAM (10-iteration benchmark):
  Phase 1 계획:  ~20K tokens
  Phase 2 실행:  ~60K tokens (컨텍스트 누적)
  Phase 3 검증:  ~15K tokens
  Phase 4 수정:  ~20K tokens
  Total:         ~115K tokens

MPL (3 phases, 각 3-iteration):
  Decomposition:       ~10K tokens
  Phase 1 (3 loops):   ~25K tokens (fresh context)
  Phase 2 (3 loops):   ~30K tokens (fresh + state_1)
  Phase 3 (3 loops):   ~30K tokens (fresh + state_1+2)
  Total:               ~95K tokens
```

### 비용 특성

- **컨텍스트 누적 없음**: 후반 phase에서도 토큰 효율 유지
- **Decomposition 추가 비용**: ~10K tokens (1회)
- **State Summary 생성 비용**: ~2K tokens × phase 수
- **Mini-plan 비용**: ~3K tokens × phase 수
- **회귀 테스트 비용**: phase 수에 비례하여 증가

**손익분기점**: Phase 수가 5 이상이면 컨텍스트 누적 절감이 overhead를 초과할 것으로 예상.
