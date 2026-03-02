# 01. Problem Statement: "Big Plan, Big Execute"의 한계

## 현행 시스템의 공통 실행 패턴

OMC, hoyeon, UAM 모두 동일한 구조를 공유한다:

```
User Request → 전체 계획 수립 → 전체 실행 → 최종 검증
```

### OMC Ralph Loop
```
User Input → CLAUDE.md 주입 → Ralph 모드 활성화
  → Conductor가 executor/architect/verifier에 위임
  → Stop hook: "Not done? Continue"
  → Architect VERIFIED_COMPLETE까지 반복
```
- 단일 연속 세션, 컨텍스트 compaction으로 관리
- 전체 작업을 한 세션에서 처리

### hoyeon /execute
```
/specify → 전체 PLAN.md 생성 (checkbox SSOT)
  → 모든 TODO 순차/병렬 실행
  → 완료 후 code-reviewer → SHIP/NEEDS_FIXES
```
- 전체 PLAN.md를 한번에 생성하고 전체를 실행

### UAM 5-Phase
```
Phase 1: Quick Plan → 전체 PLAN.md 생성
Phase 2: MVP Sprint → 전체 TODO 실행
Phase 3: Quality Gate → 전체 검증
Phase 4: Fix Loop → 전체 수정
Phase 5: Finalize
```
- 5-Phase로 나뉘지만, Phase 1에서 **전체** 계획, Phase 2에서 **전체** 실행

---

## 구조적 한계

### 1. 계획 노후화 (Plan Staleness)

Step 15를 실행하는 시점에, Step 1 이전에 만든 계획은 이미 현실과 괴리가 있다.
구현 과정에서 발견되는 정보(라이브러리 제약, API 동작, 성능 특성)가 초기 계획에 반영되지 않는다.

```
실제 경험:
  계획: "PostgreSQL JSON 컬럼으로 메타데이터 저장"
  Step 5에서 발견: JSON 쿼리 성능이 요구사항 미달
  → 그러나 Step 6~15는 이미 JSON 기반으로 계획됨
  → 전체 계획 수정 또는 비효율적 실행
```

### 2. 컨텍스트 누적 (Context Pollution)

실행이 진행될수록 context window에 불필요한 정보가 축적된다.

```
10-iteration 벤치마크 토큰 사용량:
  OMC Ralph:  ~150K (누적, 예측 어려움)
  SG-Loop:    ~80K  (리셋, 일정)
  UAM:        ~110K (하이브리드)
```

OMC가 가장 높은 이유: 컨텍스트가 계속 쌓이면서 모델이 처리해야 할 정보량이 증가.

### 3. 오류 전파 (Error Propagation)

초기 단계의 잘못된 가정이 이후 모든 단계에 영향을 미친다.

```
Step 3: "이 API는 동기식으로 충분하다" (잘못된 가정)
Step 4: 동기식 핸들러 구현
Step 5: 동기식 테스트 작성
...
Step 12: 성능 테스트에서 블로킹 발견
→ Step 4~11 전체 재작업 필요
```

### 4. 적응 불능 (No Adaptation)

실제 구현 결과에 따라 계획이 변하지 않는다.

- UAM의 Discovery 메커니즘이 이를 부분적으로 해결하지만, Phase 2 후반에 발견되면 이미 많은 코드가 작성된 상태
- 충돌 해소 비용이 발견 시점에 비례하여 증가

### 5. 검증 지연 (Late Verification)

전체 완료 후에야 통합 검증이 이루어진다.

```
현행 타임라인:
  [계획 10분] → [실행 60분] → [검증 10분] → 문제 발견 → [수정 30분]

이상적 타임라인:
  [계획 3분→실행 15분→검증 3분] × 4 phases
  → 문제가 작은 범위에서 빨리 발견됨
```

---

## SG-Loop과의 차이

SG-Loop도 "loop 단위 실행"이지만 근본적으로 다르다:

| 차원 | SG-Loop | MPL (제안) |
|------|---------|-----------|
| Loop 성격 | Retry (같은 작업 반복) | Progression (다음 단계로 진행) |
| 실패 처리 | 처음부터 다시 | 해당 phase 내에서 수정 |
| 성공 축적 | 없음 (매번 리셋) | 이전 phase 성과 위에 쌓음 |
| 계획 범위 | 전체 (plan.json 고정) | Phase별 (mini-plan 적응) |
| 컨텍스트 | 리셋 (failure_summary만 전달) | 리셋 + state_summary 전달 |

```
SG-Loop: "실패하면 처음부터 다시" (retry loop)
MPL:     "성공한 부분 위에 다음을 쌓는다" (progression loop)
```

---

## 결론: MPL의 동기

현행 시스템들의 한계는 모두 **"전체를 한번에 계획하고 실행한다"**는 구조에서 비롯된다.

MPL은 이 구조를 **"작은 단위로 분해하여 각각을 독립적으로 계획→실행→검증"**하는 방식으로 전환함으로써:

1. 계획이 항상 현재 상태를 반영
2. 컨텍스트가 phase별로 리셋
3. 오류가 작은 범위에 격리
4. 매 phase의 결과가 다음 계획에 반영
5. 검증이 매 phase마다 수행
