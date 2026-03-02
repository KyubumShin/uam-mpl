# 10. Evaluation Framework: MPL vs 현행 시스템 비교

## 목적

MPL이 실제로 현행 시스템(UAM standard, OMC ralph, hoyeon)보다 나은지 측정한다.
주관적 판단이 아닌 **정량적 메트릭** 기반 비교.

---

## 평가 차원 (5개)

### 1. 작업 성공률 (Task Success Rate)

> "최종 산출물이 요구사항을 충족하는가?"

```
측정:
  - success_criteria 충족률: 통과한 criteria / 전체 criteria
  - 회귀 발생률: 이전에 통과했던 테스트가 깨진 비율
  - 완주율: 작업이 끝까지 완료된 비율 (circuit breaker/포기 없이)

비교 포인트:
  MPL:      매 phase 검증 → 문제 조기 발견 → 성공률 ↑?
  Standard: 전체 완료 후 검증 → 문제 후반 발견 → 성공률 ↓?
```

**메트릭**:

| 메트릭 | 계산 | 의미 |
|--------|------|------|
| `criteria_pass_rate` | passed / total criteria | 요구사항 충족도 |
| `regression_rate` | broken_inherited / total_inherited | 기존 기능 보존율 |
| `completion_rate` | completed_tasks / total_tasks | 완주율 |
| `circuit_breaker_count` | 재분해 발생 횟수 | 구조적 실패 빈도 |

### 2. 토큰 효율 (Token Efficiency)

> "같은 결과를 얻는 데 토큰을 얼마나 사용하는가?"

```
측정:
  - 총 토큰 사용량
  - Phase/단계별 토큰 분포
  - Context 크기 추이 (시간에 따른 변화)
  - 탐색 vs 추론 비율 (탐색에 소비된 토큰 비율)

비교 포인트:
  MPL:      Fresh session + 구조화된 input → 후반 phase에서도 낮은 context
  Standard: 연속 session → 후반에 context 누적
```

**메트릭**:

| 메트릭 | 계산 | 의미 |
|--------|------|------|
| `total_tokens` | 전체 입출력 토큰 합 | 절대 비용 |
| `tokens_per_todo` | total_tokens / completed_todos | TODO당 효율 |
| `context_growth_rate` | phase_N_context / phase_1_context | Context 증가율 |
| `exploration_ratio` | 탐색 토큰 / 전체 토큰 | 탐색 overhead |
| `overhead_ratio` | (planning + verify) / execution | 비실행 overhead |

### 3. 오류 격리 (Error Isolation)

> "문제가 발생했을 때 영향 범위가 얼마나 작은가?"

```
측정:
  - 오류 발견 시점: 전체 진행률의 몇 %에서 발견?
  - 오류 영향 범위: 오류로 인해 재작업해야 하는 파일 수
  - 오류 수정 비용: 오류 발견 → 수정 완료까지의 토큰
  - Cascade 발생 여부: 한 오류가 다른 영역으로 전파되었는가

비교 포인트:
  MPL:      Phase 단위 격리 → 오류 영향 = 해당 phase의 3~7 TODO
  Standard: 전체가 하나의 단위 → 오류 영향 = 전체 PLAN의 모든 TODO
```

**메트릭**:

| 메트릭 | 계산 | 의미 |
|--------|------|------|
| `error_detection_point` | error_phase / total_phases | 조기 발견 정도 (낮을수록 좋음) |
| `error_blast_radius` | affected_files / total_files | 영향 범위 (낮을수록 좋음) |
| `error_fix_cost` | fix_tokens / total_tokens | 수정 비용 비율 |
| `cascade_count` | 다른 phase에 영향 준 오류 수 | Cascade 빈도 |

### 4. 적응성 (Adaptability)

> "실행 중 발견된 정보에 얼마나 잘 대응하는가?"

```
측정:
  - Discovery 처리 횟수
  - PD Override 횟수
  - PP 구체화 횟수 (PROVISIONAL → CONFIRMED)
  - 초기 계획 vs 최종 결과의 차이도

비교 포인트:
  MPL:      매 phase에서 Discovery → 다음 phase 계획에 반영
  Standard: Phase 2(실행) 후반에야 Discovery → 이미 많은 코드 작성
```

**메트릭**:

| 메트릭 | 계산 | 의미 |
|--------|------|------|
| `discovery_count` | 총 Discovery 수 | 새로운 정보 발견 빈도 |
| `discovery_adoption_rate` | 반영된 Discovery / 전체 | 발견 활용률 |
| `pd_override_count` | PD 수정 횟수 | 결정 변경 빈도 |
| `pp_refinement_count` | PP 판정 기준 업데이트 횟수 | PP 진화 정도 |
| `plan_drift` | 최종 구현과 초기 계획의 diff | 적응 정도 |

### 5. 사용자 경험 (User Experience)

> "사용자가 실제로 느끼는 제어감과 만족도"

```
측정:
  - HITL 횟수: 사용자가 개입해야 했던 횟수
  - HITL 품질: 사용자에게 제시된 정보가 판단에 충분했는가
  - 진행 가시성: 사용자가 현재 진행 상태를 파악할 수 있는가
  - 중간 결과 품질: 각 phase 완료 시점의 산출물이 유용한가

비교 포인트:
  MPL:      매 phase 완료 시 검증된 중간 결과물 존재
  Standard: 전체 완료 전까지 중간 결과물 없음
```

**메트릭**:

| 메트릭 | 계산 | 의미 |
|--------|------|------|
| `hitl_count` | 사용자 개입 횟수 | 자율성 (낮을수록 자율적) |
| `hitl_quality` | 유용했던 HITL / 전체 HITL | HITL 효율 |
| `intermediate_value` | phase별 산출물의 독립 실행 가능 여부 | 중간 결과 품질 |
| `time_to_first_result` | 첫 동작하는 결과까지의 시간 | 빠른 피드백 |

---

## 벤치마크 태스크 세트

### Tier 1: 소규모 (Phase 1~2개 예상)

| Task | 예상 TODO | 특성 |
|------|----------|------|
| T1-1: "Express 서버에 새 엔드포인트 추가" | 3~4 | 기존 코드에 추가 |
| T1-2: "함수 리팩토링 (이름/구조 변경)" | 2~3 | 기존 코드 수정 |
| T1-3: "버그 수정 + 테스트 추가" | 3~4 | 디버깅 + 검증 |

**기대**: MPL과 Standard의 차이 작음. MPL의 overhead가 눈에 띌 수 있음.

### Tier 2: 중규모 (Phase 3~5개 예상)

| Task | 예상 TODO | 특성 |
|------|----------|------|
| T2-1: "REST API CRUD + 인증" | 15~20 | 풀스택, 여러 레이어 |
| T2-2: "기존 API에 페이지네이션/필터링/정렬 추가" | 10~15 | 기존 코드 대규모 수정 |
| T2-3: "CLI 도구 구현 (파싱/실행/출력)" | 12~16 | 새 프로젝트 |

**기대**: MPL의 이점이 나타나기 시작. Context 절감, 오류 격리가 측정 가능.

### Tier 3: 대규모 (Phase 5~10개 예상)

| Task | 예상 TODO | 특성 |
|------|----------|------|
| T3-1: "풀스택 앱 (API + DB + Auth + Admin + 테스트)" | 25~35 | 최대 복잡도 |
| T3-2: "대규모 리팩토링 (모듈 분리 + API 변경 + 마이그레이션)" | 20~30 | 기존 코드 구조 변경 |
| T3-3: "멀티 서비스 통합 (외부 API + 캐싱 + 큐)" | 20~28 | 외부 의존성 다수 |

**기대**: MPL의 이점이 명확. Standard에서는 후반 context 누적/계획 노후화 발생.

---

## 실험 프로토콜

### 각 태스크마다

```
1. 동일 태스크를 두 모드로 실행:
   a) UAM standard (현행)
   b) UAM --mpl (MPL)

2. 동일 조건:
   - 같은 코드베이스 시작점
   - 같은 PP (해당 시)
   - 같은 maturity mode (standard)
   - 사용자 HITL 응답은 사전 정의 (재현성)

3. 수집 데이터:
   - 전체 실행 로그 (토큰, 시간, tool calls)
   - 각 검증 시점의 criteria 결과
   - Discovery / PD Override 발생 기록
   - 최종 산출물의 criteria 충족률
   - 에러 발생 시점과 수정 비용
```

### HITL 응답 사전 정의

재현성을 위해 HITL 응답을 스크립트화:

```yaml
hitl_responses:
  pp_conflict:
    "보안 라이브러리": "수용"
    "유틸리티 라이브러리": "반려"
    "dev 도구": "수용"
  pd_override:
    "스키마 변경": "승인"
    "API 계약 변경": "승인"
  phase_approval:
    default: "다음 phase 진행"
```

---

## 비교 리포트 템플릿

```markdown
# Benchmark Report: {Task Name}

## 요약
| 메트릭 | Standard | MPL | 차이 |
|--------|----------|-----|------|
| 성공률 | 85% | 95% | +10% |
| 총 토큰 | 120K | 95K | -21% |
| 오류 발견 시점 | 80% | 30% | 훨씬 조기 |
| HITL 횟수 | 2 | 4 | +2 (but 더 유용) |
| 완료 시간 | 45분 | 40분 | -11% |

## 상세 비교

### 토큰 사용 추이
Standard: [10K, 15K, 25K, 35K, 35K] (누적 증가)
MPL:      [10K, 15K, 20K, 25K, 25K] (안정적)

### 오류 이벤트
Standard: Phase 2 후반(진행률 70%)에서 스키마 문제 발견 → 30K 토큰 재작업
MPL:      Phase 2 완료 검증(진행률 30%)에서 발견 → Phase 3에서 5K 토큰으로 해결

### Discovery 활용
Standard: Discovery 2건, 0건 반영 (이미 실행 완료)
MPL:      Discovery 3건, 2건 반영 (다음 phase 계획에 반영)

## 결론
{이 태스크에서의 MPL 장단점 요약}
```

---

## 자동 수집 파이프라인

### 실행 중 자동 기록

```json
// .uam/mpl/metrics.json (Phase Runner가 자동 기록)
{
  "task": "T2-1",
  "mode": "mpl",
  "started_at": "2026-03-02T10:00:00Z",
  "phases": [
    {
      "id": "phase-1",
      "tokens_in": 2500,
      "tokens_out": 3200,
      "context_size": 1000,
      "todos": 4,
      "todos_completed": 4,
      "criteria_total": 3,
      "criteria_passed": 3,
      "inherited_total": 0,
      "inherited_passed": 0,
      "discoveries": 1,
      "discoveries_adopted": 1,
      "pd_overrides": 0,
      "retries": 0,
      "duration_ms": 180000,
      "hitl_count": 1
    },
    {
      "id": "phase-2",
      // ...
    }
  ],
  "totals": {
    "total_tokens": 95000,
    "total_todos": 18,
    "completion_rate": 1.0,
    "criteria_pass_rate": 0.95,
    "regression_rate": 0.0,
    "circuit_breaker_count": 0,
    "total_discoveries": 4,
    "total_overrides": 1,
    "total_hitl": 4,
    "total_duration_ms": 2400000
  }
}
```

### Standard 모드도 동일 형식

```json
// .uam/metrics.json (Standard 모드)
{
  "task": "T2-1",
  "mode": "standard",
  "phases": [
    { "id": "plan", "tokens": 20000, "duration_ms": 120000 },
    { "id": "execute", "tokens": 65000, "duration_ms": 1800000 },
    { "id": "quality_gate", "tokens": 15000, "duration_ms": 300000 },
    { "id": "fix_loop", "tokens": 20000, "duration_ms": 600000 }
  ],
  "totals": {
    "total_tokens": 120000,
    // ...
  }
}
```

---

## 손익분기점 분석

### 가설

```
MPL overhead = phase_decompose + (mini_plan + verify + summarize) × N
MPL 절감 = context_reduction + early_error_detection + adaptive_planning

손익분기: overhead < 절감

예상 분기점:
  Phase 1~2개: overhead > 절감 (Standard가 나음)
  Phase 3~4개: overhead ≈ 절감 (비슷)
  Phase 5개+:  overhead < 절감 (MPL이 나음)
```

### 측정 방법

```
overhead_cost =
  codebase_analyze_tokens     # ~0 (정적 분석)
  + decompose_tokens          # ~5K
  + (mini_plan_tokens × N)    # ~3K × N
  + (verify_tokens × N)       # ~2K × N
  + (summarize_tokens × N)    # ~1K × N
  = 5K + 6K × N

savings =
  context_reduction           # (standard_context_phase_N - mpl_context_phase_N) × N
  + error_fix_savings         # early detection으로 절감된 재작업 토큰
  + exploration_savings       # impact_files 사전 주입으로 절감된 탐색 토큰

breakeven when:
  5K + 6K × N < savings
```

---

## 성공 기준

MPL이 "성공"이라고 판단하는 조건:

```
필수:
  - Tier 2 태스크에서 criteria_pass_rate ≥ Standard
  - Tier 3 태스크에서 total_tokens ≤ Standard × 0.9 (10% 이상 절감)
  - regression_rate ≤ Standard (회귀 발생이 더 많으면 안 됨)

기대:
  - Tier 3에서 error_detection_point 50% 이상 개선
  - discovery_adoption_rate ≥ 50% (발견의 절반 이상 활용)
  - context_growth_rate ≤ 2.0 (Phase 1 대비 최대 2배)

보너스:
  - Tier 1에서 overhead가 10% 이내 (소규모에서 큰 손해 없음)
  - PP refinement가 3회 이상 발생 (PP 자연 진화 검증)
```
