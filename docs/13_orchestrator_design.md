# 13. Orchestrator 설계

## 개요

Orchestrator는 MPL의 **중추 컴포넌트**다.
Phase Decomposer와 Phase Runner를 연결하고, 전체 실행 흐름을 관리한다.

```
User Request
    ↓
[Orchestrator]
    ├── codebase_analyze 실행
    ├── PP Interview 진행
    ├── phase_decompose 호출
    │
    └── For each phase:
          ├── impact_files 로딩
          ├── phase_run 실행 (Task agent)
          ├── 검증 결과 수신
          ├── state_summary 수집
          ├── PD 업데이트
          └── 다음 phase 또는 circuit breaker
```

Orchestrator 자체는 코드를 작성하지 않는다. 조율만 한다.

---

## 상태 머신

### 상태 정의

```
INIT
  → codebase_analyze 실행
  → PP Interview (있으면)
  → phase_decompose 호출
  → PHASE_READY

PHASE_READY
  → impact_files 로딩
  → PHASE_RUNNING

PHASE_RUNNING
  → Phase Runner (Task agent) 실행 중
  → Phase Runner 내부에서 retry 처리 (max 3, D-1 Hybrid)
  → 완료 대기
  → PHASE_COMPLETE | CIRCUIT_BREAK

PHASE_COMPLETE
  → state_summary 수집
  → PD 업데이트
  → 다음 phase 있으면 → PHASE_READY
  → 모든 phase 완료 → FINALIZE

CIRCUIT_BREAK
  → redecompose_count < max_redecompose (기본: 2)
    → 완료된 phase 성과 보존
    → 남은 phases 재분해 (phase_decompose 재호출)
    → 새로운 phase 목록으로 → PHASE_READY
  → redecompose_count >= max_redecompose
    → FAILED

FINALIZE
  → 전체 검증
  → 결과 보고
  → DONE

DONE
  → 종료 (성공)

FAILED
  → 실패 보고 (완료된 phase 성과는 보존)
  → 종료 (실패)
```

**Retry 책임**: Phase Runner가 내부에서 3회 retry를 수행한다 (D-1).
Orchestrator는 Phase Runner의 최종 결과("complete" 또는 "circuit_break")만 수신한다.

**재분해 횟수 제한**: max_redecompose = 2 (기본값).
2회 재분해 후에도 실패하면 FAILED로 종료하여 무한 루프를 방지한다.

### 상태 전이도

```
INIT → PHASE_READY → PHASE_RUNNING → PHASE_COMPLETE → PHASE_READY → ...
                          ↓                                    ↓
                    CIRCUIT_BREAK                           FINALIZE
                     ↓          ↓                              ↓
               PHASE_READY    FAILED                         DONE
              (재분해 < 2)   (재분해 ≥ 2)
```

---

## Orchestrator 에이전트 정의

```yaml
name: uam-orchestrator
type: orchestrator
model: sonnet  # 조율 작업, opus 불필요
tools: [Read, Bash, Glob, Grep, Task, ast_grep_search, lsp_*]
```

Orchestrator는 **직접 코드를 작성하지 않는다**.
Phase Runner를 Task agent로 생성하여 실행을 위임한다.

---

## 실행 흐름 상세

### Step 1: 초기화 (INIT)

```
1. codebase_analyze 실행
   → tools/dep-graph 스크립트 또는 내장 분석
   → CodebaseAnalysis JSON 생성
   → .uam/mpl/codebase-analysis.json에 저장

2. PP 로드 또는 Interview
   → .uam/pivot-points.md 존재 → 로드
   → 없으면 → PP Interview 진행 (UAM uam-pivot 차용)

3. phase_decompose 호출
   → Task(
       subagent_type="uam-decomposer",
       model="opus",
       prompt={system_prompt + task_prompt}
     )
   → 결과: phases[], shared_resources, architecture_anchor
   → .uam/mpl/decomposition.yaml에 저장
```

### Step 2: Phase 실행 루프 (PHASE_READY → PHASE_RUNNING → PHASE_COMPLETE)

각 phase마다:

```
1. Context 조립
   context = {
     pivot_points:     read(".uam/pivot-points.md"),
     phase_decisions:  build_tiered_pd(current_phase),   // 3-Tier 분류
     phase_definition: phases[current_index],
     impact_files:     load_impact_files(phases[current_index].impact),
     maturity_mode:    config.maturity_mode
   }

2. Phase Runner 생성 (Fresh Session — D-1)
   result = Task(
     subagent_type="uam-phase-runner",
     model="sonnet",
     prompt=format_phase_runner_prompt(context)
   )

3. 결과 처리
   if result.status == "complete":
     → state_summary 저장: .uam/mpl/phases/phase-{N}/state-summary.md
     → PD 업데이트: .uam/mpl/phase-decisions.md
     → Discovery 처리 (아래 섹션 참조)
     → 다음 phase로
   elif result.status == "circuit_break":
     → 재분해 흐름으로 (Phase Runner 내부 3회 retry 모두 실패)
   # 참고: "failed" 상태는 없음. Phase Runner가 내부에서 retry를 처리하고,
   # Orchestrator는 "complete" 또는 "circuit_break"만 수신한다 (D-1).
```

### Step 3: Circuit Breaker 처리

```
1. 실패 정보 수집
   failure_info = {
     failed_phase: current_phase,
     failure_summary: result.failure_summary,
     attempted_fixes: result.attempted_fixes,
     completed_phases: [phase-1, ..., phase-(N-1)],
     existing_pd: all_phase_decisions
   }

2. 재분해 요청
   new_phases = Task(
     subagent_type="uam-decomposer",
     model="opus",
     prompt=format_redecompose_prompt(failure_info)
   )

3. 재분해 결과로 phase 목록 교체
   → 완료된 phase는 보존
   → 실패한 phase + 이후 phase를 새 목록으로 교체
   → PHASE_READY로 복귀
```

### Step 4: 최종화 (FINALIZE)

```
1. 전체 검증
   → 모든 phase의 success_criteria 최종 확인
   → npm test (전수 검사)
   → npm run build

2. 결과 보고
   → 전체 Phase Decisions 정리
   → 메트릭 수집 (토큰, 시간, retry 횟수)
   → .uam/mpl/metrics.json 저장

3. PP 진화 제안 (optional)
   → Override 빈도가 높은 PD 영역 → PP 보강 제안
   → PROVISIONAL PP 중 미확정 → 확정 제안
```

---

## Fresh Session 구현 (D-1 구체화)

### 원칙

```
Phase Runner는 Task agent로 생성된다.
→ Task agent는 독립적인 세션을 가진다
→ 종료 시 세션이 자동으로 사라진다
→ "fresh session"이 자연스럽게 구현된다
```

### 구현

```
Phase Runner 생성:
  Task(
    subagent_type="uam-phase-runner",
    model="sonnet",
    prompt="""
      {Phase Runner System Prompt}

      ---
      ## Pivot Points
      {pp_content}

      ## Phase Decisions
      ### Active (상세)
      {tier1_pd}

      ### Summary (1줄)
      {tier2_pd}

      ### Archived
      {tier3_list}

      ## Phase Definition
      {phase_definition_yaml}

      ## Impact Files
      {impact_files_content}

      ## Maturity Mode
      {maturity_mode}
    """
  )
```

### Retry 시 세션 유지

```
Phase Runner가 내부적으로 retry를 수행한다.
  → 실패 시 같은 Task agent 세션에서 재시도
  → 에러 컨텍스트가 보존됨
  → 3회 실패 시 circuit_break 상태로 Orchestrator에 반환

Orchestrator는 Phase Runner의 최종 결과만 수신한다.
  → "complete" 또는 "circuit_break"
  → 내부 retry는 Phase Runner가 자체 처리
```

---

## impact_files 로딩

### 기본 로딩

```
For each file in phase.impact.{create, modify, affected_tests, affected_config}:
  if file exists:
    content = Read(file)
    impact_files.push({ path: file, content: content })
  else:
    impact_files.push({ path: file, content: null, note: "신규 생성 대상" })
```

### 파일 크기 제한

```
개별 파일: 최대 500줄 (초과 시 관련 부분만 발췌)
전체 impact_files: 최대 ~5000 tokens

초과 시 전략:
  1. modify 파일: location_hint 주변 ±50줄만 발췌
  2. affected_tests: 테스트 파일명 + describe/it 목록만
  3. affected_config: 관련 섹션만 발췌
```

### 범위 외 접근 프로토콜 (누락-5 해결)

Phase Runner가 impact 범위 밖 파일에 접근해야 하는 경우:

```
Phase Runner 내부:
  1. Discovery 생성
     { type: "scope_extension", file: "src/utils/validator.ts", reason: "입력 검증에 필요" }

  2. Phase Runner가 직접 해당 파일을 Read로 읽음
     → Phase Runner는 도구(Read, Glob 등)를 가지고 있으므로 직접 접근 가능

  3. State Summary에 기록
     "범위 외 접근: src/utils/validator.ts (입력 검증 참조용)"

Orchestrator 측:
  → State Summary에서 범위 외 접근 빈도 추적
  → 빈번하면 Decomposer의 impact 예측 품질 개선 신호
  → 다음 재분해 시 해당 파일을 impact에 포함하도록 힌트

판단 기준:
  - 읽기만 필요 → Phase Runner가 직접 Read (범위 확장 불필요)
  - 수정이 필요 → Discovery로 보고 → 현재 phase에서 수정하되 기록
  - 대규모 수정 필요 → Discovery → 다음 phase 백로그
```

---

## success_criteria 실행 가능 스키마 (구현-1 해결)

### 문제

```
현재 success_criteria는 자연어:
  "POST /auth/register → 201"
  "인증 없이 GET /tasks → 401"

기계 검증하려면:
  - 서버 기동이 필요할 수 있음
  - DB 연결이 필요할 수 있음
  - 환경변수 설정이 필요할 수 있음
```

### 스키마 정의

```yaml
success_criteria:
  # Type 1: 명령어 실행 (빌드, 린트, 타입 체크)
  - type: "command"
    run: "npx tsc --noEmit"
    expect_exit: 0
    description: "TypeScript 컴파일 성공"

  # Type 2: 테스트 실행
  - type: "test"
    run: "npm test -- --grep 'auth'"
    expect_exit: 0
    description: "인증 관련 테스트 통과"

  # Type 3: 파일 존재 확인
  - type: "file_exists"
    paths:
      - "src/auth/middleware.ts"
      - "src/routes/auth.ts"
      - "migrations/002_create_users.sql"
    description: "인증 관련 파일 생성됨"

  # Type 4: 패턴 매칭 (파일 내용 확인)
  - type: "grep"
    file: "src/app.ts"
    pattern: "authMiddleware"
    description: "app.ts에 authMiddleware 등록됨"

  # Type 5: 자연어 기술 (기계 검증 불가 → Phase Runner가 테스트로 변환)
  - type: "description"
    text: "인증 없이 GET /tasks → 401"
    hint: "curl 또는 supertest로 검증 가능"
    description: "인증 미적용 시 401 응답"
```

### 검증 실행기

```
Orchestrator 또는 Phase Runner의 Verify 단계에서:

for each criterion in success_criteria:
  switch criterion.type:
    case "command":
      result = Bash(criterion.run)
      pass = (result.exit_code == criterion.expect_exit)

    case "test":
      result = Bash(criterion.run)
      pass = (result.exit_code == criterion.expect_exit)

    case "file_exists":
      pass = all(criterion.paths.map(p => file_exists(p)))

    case "grep":
      result = Grep(pattern=criterion.pattern, path=criterion.file)
      pass = (result.matches > 0)

    case "description":
      # Phase Runner가 테스트 코드를 작성하여 검증
      # 또는 Phase Runner의 판단에 위임
      pass = phase_runner_judgment(criterion.text)

  results.push({ criterion, pass, evidence })
```

### Decomposer의 criteria 생성 규칙

```
Decomposer가 success_criteria를 생성할 때:

1. 빌드/타입 체크 → type: "command" (항상 포함)
2. 기존 테스트가 있는 파일 수정 → type: "test"
3. 새 파일 생성 → type: "file_exists"
4. 기존 파일에 새 코드 추가 → type: "grep"
5. 동작 확인이 필요한 것 → type: "description" (Phase Runner가 테스트 작성)

원칙: type: "description"은 최소화한다.
가능한 한 command, test, file_exists, grep으로 대체한다.
```

---

## State Summary 품질 보장 (누락-4 해결)

### 필수 섹션 검증

Phase Runner가 생성한 State Summary를 Orchestrator가 검증:

```
required_sections = [
  "구현된 것",           # 무엇을 만들었는가
  "Phase Decisions",     # 이번 phase에서 내린 결정
  "검증 결과",           # criteria 통과 여부
]

recommended_sections = [
  "수정된 것",           # 기존 파일 변경 내역
  "Discovery 처리 결과", # Discovery가 있었다면
  "다음 phase를 위한 참고" # 후속 phase에 필요한 정보
]
```

### interface_contract.produces 이행 검사

```
for each produce in phase.interface_contract.produces:
  if not mentioned_in(state_summary, produce.name):
    warning: "produces에 명시된 '{produce.name}'이 State Summary에 없음"

처리:
  → Phase Runner에게 보충 요청 (같은 세션)
  → 또는 warning만 기록하고 다음 phase에서 자연스럽게 감지
```

### 품질 검증 흐름

```
Phase Runner 완료
    ↓
Orchestrator: State Summary 수신
    ↓
구조 검증:
  ├── 필수 섹션 존재? → 없으면 보충 요청
  ├── produces 이행? → 누락이면 warning
  └── PD 포함? → 없으면 경고 (결정 없는 phase는 드묾)
    ↓
검증 통과 → PD 업데이트 + 다음 phase
검증 실패 → Phase Runner에 보충 요청 (1회)
  → 보충 후에도 실패 → warning 기록 후 진행 (blocking하지 않음)
```

---

## PD 3-Tier 구성 (Orchestrator 책임)

Orchestrator가 매 phase 시작 전 PD를 3-Tier로 분류:

```
build_tiered_pd(current_phase):

  all_pd = read(".uam/mpl/phase-decisions.md")

  tier1_active = []   # 전체 포함
  tier2_summary = []  # 1줄 요약
  tier3_archived = [] # context 제외

  for each pd in all_pd:
    if pd.affected_files ∩ current_phase.impact.{create,modify} ≠ ∅:
      tier1_active.push(pd)
    elif pd.from_phase in current_phase.interface_contract.requires[].from_phase:
      tier1_active.push(pd)
    elif pd.type in ['DB Schema', 'API Contract', 'Architecture']:
      tier2_summary.push(pd.one_line_summary)
    else:
      tier3_archived.push(pd.id)

  return { tier1: tier1_active, tier2: tier2_summary, tier3: tier3_archived }
```

---

## Discovery 처리 (Orchestrator 역할)

Phase Runner가 반환한 discoveries를 Orchestrator가 처리:

```
for each discovery in result.discoveries:

  # 1. PP 충돌 검사
  if discovery.pp_conflict:
    pp = find_pp(discovery.pp_conflict)
    if pp.status == "CONFIRMED":
      → 자동 반려, 기록
    elif pp.status == "PROVISIONAL":
      → maturity_mode에 따라 HITL 또는 자동 승인

  # 2. PD Override 검사
  if discovery.pd_override:
    → maturity_mode에 따라 HITL 또는 자동 승인
    → 승인 시: PD-override 레코드 추가

  # 3. 일반 Discovery
  else:
    → 다음 phase의 참고 사항으로 전달
    → 다음 phase 계획에 영향 줄 수 있음

  # 4. 기록
  append_to(".uam/discoveries.md", discovery)
```

---

## 진행 상태 추적

### .uam/mpl/state.json

```json
{
  "task": "Task 관리 REST API 구현",
  "status": "running",
  "started_at": "2026-03-02T10:00:00Z",
  "maturity_mode": "standard",

  "phases": {
    "total": 4,
    "completed": 2,
    "current": "phase-3",
    "failed": 0,
    "circuit_breaks": 0
  },

  "phase_details": [
    {
      "id": "phase-1",
      "name": "Project Foundation",
      "status": "completed",
      "retries": 0,
      "criteria_passed": "4/4",
      "pd_count": 2,
      "discoveries": 0,
      "duration_ms": 180000
    },
    {
      "id": "phase-2",
      "name": "Task CRUD API",
      "status": "completed",
      "retries": 1,
      "criteria_passed": "5/5",
      "pd_count": 2,
      "discoveries": 1,
      "duration_ms": 300000
    },
    {
      "id": "phase-3",
      "name": "Authentication",
      "status": "running",
      "retries": 0,
      "criteria_passed": null,
      "pd_count": null,
      "discoveries": null,
      "duration_ms": null
    },
    {
      "id": "phase-4",
      "name": "Authorization & Polish",
      "status": "pending",
      "retries": null,
      "criteria_passed": null,
      "pd_count": null,
      "discoveries": null,
      "duration_ms": null
    }
  ],

  "totals": {
    "total_tokens": null,
    "total_retries": 1,
    "total_discoveries": 1,
    "total_pd_overrides": 0,
    "elapsed_ms": 480000
  }
}
```

### 사용자 보고

각 phase 완료 시 Orchestrator가 간단히 보고:

```
Phase 2/4 완료: "Task CRUD API"
  ✓ 5/5 criteria 통과
  ✓ 회귀 테스트 통과
  → PD-3, PD-4 생성
  → Discovery 1건 (다음 phase 백로그)
  → 다음: Phase 3 "Authentication"
```

---

## 파일 시스템 구조

```
.uam/
  ├── pivot-points.md              # PP 문서 (standard/mpl 공유)
  ├── discoveries.md               # Discovery 전체 기록 (공유)
  │
  └── mpl/
        ├── codebase-analysis.json # codebase_analyze 출력
        ├── decomposition.yaml     # phase_decompose 출력
        ├── phase-decisions.md     # PD 마스터 파일
        ├── architecture-anchor.md # 아키텍처 앵커
        ├── state.json             # 진행 상태 + 실행 상태
        ├── metrics.json           # 실행 메트릭 (완료 후)
        │
        └── phases/
              ├── phase-1/
              │   ├── mini-plan.md       # Phase 1 TODO
              │   ├── state-summary.md   # Phase 1 완료 후 요약
              │   └── verification.md    # Phase 1 검증 결과
              ├── phase-2/
              │   └── ...
              └── phase-3/
                  └── ...
```

---

## 회귀 테스트 최적화 (구현-3 해결)

### 문제

```
Phase N에서 1~(N-1) 모든 criteria 재실행 → O(N²) 비용 증가
Phase 10이면 10+9+8+...+1 = 55회 검증
```

### 해결: 영향 기반 선택적 검사

```
Phase N의 회귀 검증:

1. 이번 phase에서 수정한 파일 목록 수집
   modified_files = result.changes.map(c => c.path)

2. 영향받는 이전 phase 식별
   affected_phases = []
   for each prev_phase in completed_phases:
     if prev_phase.impact.{create,modify} ∩ modified_files ≠ ∅:
       affected_phases.push(prev_phase)

3. 선택적 검증
   for each affected_phase in affected_phases:
     run inherited_criteria from affected_phase

4. 전수 검사는 마지막 phase에서만
   if current_phase == last_phase:
     run ALL inherited_criteria from ALL phases
     run "npm test" (전체 테스트)
```

### 비용 비교

```
전수 검사:
  Phase 4: 4+3+2+1 = 10회
  Phase 10: 55회

선택적 검사:
  Phase 4: 평균 2~3회 (직접 영향 받는 phase만)
  Phase 10: 평균 3~5회

마지막 phase만 전수: +1회 npm test
```

---

## Orchestrator Pseudo-code

```python
class Orchestrator:

  MAX_REDECOMPOSE = 2  # 무한 루프 방지

  def run(self, user_request, maturity_mode):
    # INIT
    codebase = self.run_codebase_analyze()
    pp = self.load_or_interview_pp()
    phases = self.decompose(user_request, pp, codebase, maturity_mode)
    self.save_decomposition(phases)

    completed = []
    all_pd = []
    redecompose_count = 0

    # PHASE LOOP
    i = 0
    while i < len(phases):
      phase = phases[i]
      self.update_state(phase, "running")

      # Context 조립
      tiered_pd = self.build_tiered_pd(all_pd, phase)
      impact_files = self.load_impact_files(phase)
      context = self.build_context(pp, tiered_pd, phase, impact_files, maturity_mode)

      # Phase Runner 실행 (Fresh Session)
      result = Task(
        subagent_type="uam-phase-runner",
        model="sonnet",
        prompt=self.format_prompt(context)
      )

      # 결과 처리
      if result.status == "complete":
        self.validate_state_summary(result.state_summary, phase)
        self.save_summary(phase, result.state_summary)
        self.update_pd(all_pd, result.new_decisions)
        self.process_discoveries(result.discoveries, maturity_mode)
        completed.append(phase)
        self.update_state(phase, "completed")
        self.report_to_user(phase, result)
        i += 1

      elif result.status == "circuit_break":
        redecompose_count += 1

        if redecompose_count > self.MAX_REDECOMPOSE:
          # 재분해 한도 초과 → FAILED
          self.update_state(phase, "failed")
          self.report_failure(phase, result, completed)
          return  # 종료 (완료된 phase 성과는 보존됨)

        # 재분해
        remaining = phases[i:]
        new_phases = self.redecompose(remaining, result.failure_info, completed, all_pd)
        phases = list(completed) + new_phases
        i = len(completed)  # 새 phase 목록의 시작점으로
        self.update_state(phase, "circuit_break")

    # FINALIZE
    self.run_final_verification(completed)
    self.collect_metrics()
    self.report_completion()
```

---

## 요약

```
Orchestrator의 핵심 책임:
  1. Phase 실행 순서 관리 (상태 머신)
  2. Fresh Session 생성 (Task agent per phase)
  3. Context 조립 (PP + 3-Tier PD + impact_files)
  4. State Summary 수집 및 품질 검증
  5. PD 누적 관리
  6. Discovery / PD Override 처리
  7. Circuit Breaker → 재분해 트리거
  8. 회귀 테스트 최적화 (영향 기반 선택적 검사)
  9. 진행 상태 추적 및 사용자 보고
  10. success_criteria 실행 가능 스키마 검증

설계 원칙:
  - Orchestrator는 코드를 작성하지 않는다 (조율만)
  - Phase Runner는 독립 Task agent (Fresh Session 자연 구현)
  - State Summary가 phase 간 유일한 지식 전달 통로
  - 실패 시에만 세션 유지 (D-1 Hybrid)
  - Maturity mode로 자율성 수준 조절 (D-2)
```
