# 07. Phase Runner 상세 설계

## 개요

Phase Runner는 단일 phase를 실행하는 mini-loop이다.
각 phase마다 독립적으로 계획→실행→검증→요약을 수행한다.

---

## 세션 모델 (D-1: Hybrid)

```
Phase N 시작
  → Fresh session (PP + PD + impact_files만 주입)
  → Mini-plan 생성
  → Worker 실행
  → Verify
      ├── 성공 → Summarize → Phase N+1 (fresh session)
      └── 실패 → Same session retry (max 3)
                   ├── 성공 → Summarize → Phase N+1 (fresh session)
                   └── 3회 실패 → Circuit breaker
```

---

## Phase Runner 에이전트 정의

```yaml
name: uam-phase-runner
type: executor
model: sonnet  # 실행 레벨, opus는 불필요
tools: [Read, Write, Edit, Bash, Glob, Grep, Task, ast_grep_search, lsp_*]
```

Phase Runner는 도구를 사용한다 (Decomposer와 달리).
단, **impact_files로 지정된 범위 내에서** 작업한다.

---

## 실행 흐름 상세

### Step 1: Context Loading

Phase Runner가 시작할 때 받는 input:

```yaml
# 불변 레이어
pivot_points: |
  PP-1: REST API Only [CONFIRMED]
  PP-2: 최소 의존성 [PROVISIONAL]
  Priority: PP-1 > PP-2

# 누적 레이어 (이전 phase들의 결정)
phase_decisions:
  - id: PD-1
    title: "Express + TypeScript"
    phase: phase-1
    detail: "src/app.ts에서 Express 서버 구성"
  - id: PD-2
    title: "tasks 테이블 스키마"
    phase: phase-2
    detail: "{ id, title, description, status, userId, createdAt }"

# 이번 phase 정의 (Decomposer 출력)
phase_definition:
  id: phase-3
  name: "Authentication"
  scope: "User 모델, 회원가입/로그인, JWT 미들웨어"
  impact:
    create:
      - path: src/auth/token.ts
        description: "JWT 생성/검증"
      - path: src/routes/auth.ts
        description: "로그인/회원가입 엔드포인트"
      - path: src/models/user.ts
        description: "User 모델"
      - path: migrations/002_create_users.sql
        description: "users 테이블"
    modify:
      - path: src/app.ts
        location_hint: "라우터 등록 부분"
        change_description: "auth 라우터 추가"
      - path: src/routes/tasks.ts
        location_hint: "라우터 전체"
        change_description: "인증 미들웨어 적용"
    affected_tests:
      - path: tests/routes/tasks.test.ts
        reason: "인증 헤더 추가 필요"
    affected_config:
      - path: .env
        change: "JWT_SECRET 추가"
  interface_contract:
    requires:
      - type: "Server"
        name: "Express app"
        from_phase: "phase-1"
      - type: "REST Endpoint"
        name: "CRUD /tasks"
        from_phase: "phase-2"
    produces:
      - type: "Middleware"
        name: "authMiddleware"
        spec: "(req, res, next) => void — JWT 검증"
      - type: "REST Endpoint"
        name: "POST /auth/login"
        spec: "{ email, password } → { token }"
      - type: "REST Endpoint"
        name: "POST /auth/register"
        spec: "{ email, password } → { id, email }"
  success_criteria:
    - "npm run build 성공"
    - "POST /auth/register → 201"
    - "POST /auth/login → 200 + JWT 반환"
    - "인증 없이 GET /tasks → 401"
  inherited_criteria:
    - from_phase: phase-1
      test: "GET /health → 200"
    - from_phase: phase-2
      test: "인증된 GET /tasks → 200"

# 사전에 읽어둔 영향 파일 내용
impact_files:
  - path: src/app.ts
    content: |
      import express from 'express';
      import { taskRouter } from './routes/tasks';
      const app = express();
      app.use(express.json());
      app.use('/tasks', taskRouter);
      app.get('/health', (req, res) => res.json({ ok: true }));
      export default app;
  - path: src/routes/tasks.ts
    content: |
      import { Router } from 'express';
      // ... CRUD handlers
  - path: tests/routes/tasks.test.ts
    content: |
      // ... existing tests without auth
```

### Step 2: Mini-Plan 생성

Phase Runner가 input을 기반으로 이 phase만의 TODO를 생성:

```markdown
## Phase 3 Mini-Plan: Authentication

### PP 충돌 검사
- PP-1 (REST API Only): 충돌 없음 — REST 엔드포인트만 추가
- PP-2 (최소 의존성): jsonwebtoken + argon2 필요 → PROVISIONAL이므로 기록

### TODO

- [ ] TODO-1: User 모델 + migration 생성
      target: src/models/user.ts, migrations/002_create_users.sql

- [ ] TODO-2: JWT 토큰 유틸리티 구현
      target: src/auth/token.ts
      dependency: none

- [ ] TODO-3: 회원가입/로그인 API 구현
      target: src/routes/auth.ts
      dependency: TODO-1, TODO-2

- [ ] TODO-4: 인증 미들웨어 구현 + 기존 라우트 적용
      target: src/auth/middleware.ts, src/routes/tasks.ts, src/app.ts
      dependency: TODO-2

- [ ] TODO-5: 기존 테스트에 인증 헤더 추가
      target: tests/routes/tasks.test.ts
      dependency: TODO-4
```

### Step 3: Worker 실행

각 TODO를 Worker 에이전트에게 위임:

```
TODO 실행 순서 (의존성 기반):
  병렬 가능: TODO-1, TODO-2 (서로 의존 없음)
  순차: TODO-3 (1,2 완료 후)
  순차: TODO-4 (2 완료 후)
  순차: TODO-5 (4 완료 후)

Worker 위임 형식:
  Task(
    subagent_type="uam-worker",
    model="sonnet",
    prompt="""
      ## Context
      {PP 요약}
      {PD 요약}

      ## TODO
      {TODO 상세}

      ## Files to work with
      {해당 TODO의 target 파일 내용}

      ## Constraints
      - 이 TODO의 범위만 작업하세요
      - interface_contract.produces의 스펙을 준수하세요
      - Discovery가 있으면 output에 포함하세요

      ## Output Format
      {
        "status": "done" | "blocked",
        "changes": [{ "path": "...", "summary": "..." }],
        "discoveries": [{ "description": "...", "pp_conflict": null | "PP-N" }],
        "notes": "..."
      }
    """
  )
```

### Step 4: Discovery 처리

Worker가 Discovery를 보고하면:

```
Discovery 수신
    │
    ├── PP 충돌 검사
    │     ├── CONFIRMED PP 충돌
    │     │     → 자동 반려, discoveries.md에 기록
    │     │
    │     ├── PROVISIONAL PP 충돌
    │     │     → maturity_mode 확인:
    │     │         explore:  자동 승인 + 기록
    │     │         standard: HITL 판단 요청
    │     │         strict:   HITL 판단 요청
    │     │
    │     └── PP 충돌 없음
    │           → maturity_mode 확인:
    │               explore:  즉시 mini-plan에 반영
    │               standard: phase 완료 시 일괄 검토
    │               strict:   다음 phase 백로그
    │
    └── PD 충돌 검사 (D-4 적용)
          ├── 기존 PD와 충돌
          │     → PD Override 요청 생성
          │     → maturity_mode에 따라 HITL 또는 자동 처리
          │     → Override 승인 시: PD-override 기록
          │
          └── 충돌 없음 → 정상 진행
```

### Step 5: Verify

Phase의 success_criteria + inherited_criteria 검증:

```
검증 순서:
  1. 빌드 검증
     $ npm run build
     → exit code 0 확인

  2. Phase 고유 criteria 검증
     각 success_criteria를 실제 명령/요청으로 변환하여 실행:
       "POST /auth/register → 201" → curl 또는 테스트
       "인증 없이 GET /tasks → 401" → curl 또는 테스트

  3. 회귀 검증 (inherited_criteria)
     이전 phase의 테스트가 여전히 통과하는지:
       "GET /health → 200" (phase-1)
       "인증된 GET /tasks → 200" (phase-2)

  4. PP 위반 검사
     구현 결과가 PP를 위반하지 않는지 최종 확인

검증 결과:
  {
    "all_pass": true | false,
    "criteria_results": [
      { "criterion": "npm run build 성공", "pass": true, "evidence": "exit 0" },
      { "criterion": "POST /auth/register → 201", "pass": true, "evidence": "HTTP 201" },
      ...
    ],
    "regression_results": [
      { "from_phase": "phase-1", "test": "GET /health → 200", "pass": true },
      ...
    ]
  }
```

### Step 6: Fix (실패 시, Same Session)

D-1 결정에 따라 같은 세션에서 retry:

```
Retry 1:
  - 실패 원인 분석 (어떤 criteria가 fail?)
  - 해당 TODO만 재실행 또는 수정
  - 재검증

Retry 2:
  - 여전히 실패 → mini-plan 재작성 (접근 방식 변경)
  - 재실행 + 재검증

Retry 3:
  - 여전히 실패 → circuit breaker
  - Phase Decomposer에게 남은 phases 재분해 요청
  - 현재 phase를 더 작게 분할하거나 우회 전략
```

### Step 7: Summarize

Phase 완료 시 state summary 생성:

```markdown
## Phase 3 State Summary

### 구현된 것
- src/models/user.ts: User 모델 (id, email, passwordHash, createdAt)
- src/auth/token.ts: JWT 생성(sign) / 검증(verify) 유틸리티
- src/auth/middleware.ts: authMiddleware — Bearer token 검증
- src/routes/auth.ts: POST /auth/register, POST /auth/login
- migrations/002_create_users.sql: users 테이블

### 수정된 것
- src/app.ts: auth 라우터 등록, authMiddleware를 tasks 라우트 앞에 적용
- src/routes/tasks.ts: 모든 핸들러에 req.userId 사용
- tests/routes/tasks.test.ts: 인증 헤더(Bearer token) 추가

### Phase Decisions (이번 phase)
- PD-3: JWT RS256 with 1h expiry
  이유: 보안 + 합리적 만료 시간
  파일: src/auth/token.ts
- PD-4: argon2 for password hashing
  이유: OWASP 권장, bcrypt보다 메모리 하드니스
  파일: src/models/user.ts
  PP 참고: PP-2(최소 의존성) — HITL에서 보안 라이브러리 허용됨

### Discovery 처리 결과
- D-1: "refresh token 필요" → 보류 (Phase 4 백로그)
- D-2: "rate limiting 필요" → 보류 (Phase 4 백로그)

### 검증 결과
- npm run build: PASS
- POST /auth/register → 201: PASS
- POST /auth/login → 200 + JWT: PASS
- 인증 없이 GET /tasks → 401: PASS
- 회귀: GET /health → 200: PASS
- 회귀: 인증된 GET /tasks → 200: PASS

### 다음 phase를 위한 참고
- JWT_SECRET 환경변수 필요 (.env에 추가됨)
- authMiddleware는 src/auth/middleware.ts에서 import
- req.userId로 인증된 사용자 ID 접근 가능
- 보류된 Discovery: refresh token, rate limiting
```

---

## HITL 처리 (D-2: Maturity 연동)

### explore 모드

```
Phase 완료 → 자동으로 다음 phase 진행
Discovery → 자동 승인
PD Override → 자동 승인 + 기록
사용자 개입: 없음 (circuit breaker 시에만)
```

### standard 모드

```
Phase 완료 → 자동으로 다음 phase 진행
Discovery (PP 충돌 시) → HITL:
  AskUserQuestion:
    "Discovery D-{N}이 PP-{M}과 충돌합니다."
    Options:
      1. "반려" → Discovery 무시
      2. "수용" → PP 해제/수정
      3. "보류" → 다음 phase 백로그

PD Override → HITL:
  AskUserQuestion:
    "Phase {N}에서 PD-{K}를 수정해야 합니다."
    Options:
      1. "승인" → Override 적용
      2. "거부" → 현재 PD 유지, 다른 방법 탐색
```

### strict 모드

```
Phase 완료 → HITL:
  AskUserQuestion:
    "Phase {N} 완료. 결과를 확인하시겠습니까?"
    Options:
      1. "다음 phase 진행"
      2. "이 phase 재실행"
      3. "중단"

Discovery → 모두 HITL
PD Override → HITL + 영향 분석 제시
```

---

## PD Override 처리 (D-4)

```
Phase 3 실행 중, PD-3(tasks 테이블 스키마)에 userId 컬럼 추가 필요 발견

Phase Runner:
  1. PD Override 요청 생성
     {
       target_pd: "PD-3",
       original: "{ id, title, description, status, createdAt }",
       proposed: "{ id, title, description, status, userId, createdAt }",
       reason: "인증 구현으로 task 소유권 추적 필요",
       affected_files: ["migrations/001_create_tasks.sql", "src/models/task.ts"]
     }

  2. Maturity에 따른 처리
     standard → HITL 요청

  3. 승인 시
     → PD-3-override 레코드 생성
     → migration 추가 (002_add_userId_to_tasks.sql)
     → Task 모델 업데이트
     → 기존 테스트 업데이트

  4. State Summary에 기록
     "PD-3 override: userId 컬럼 추가 (Phase 3에서 수정)"
```

---

## Circuit Breaker

3회 retry 후에도 실패 시:

```
Phase Runner → Orchestrator에게 보고:
  {
    "phase": "phase-3",
    "status": "circuit_break",
    "failure_summary": "JWT 미들웨어가 Express 5.x와 호환되지 않음",
    "attempted_fixes": [
      "Retry 1: async wrapper 추가 → 실패",
      "Retry 2: express-jwt 라이브러리 시도 → PP-2 충돌",
      "Retry 3: custom middleware 재작성 → 타입 에러"
    ],
    "recommendation": "Express 4.x로 다운그레이드 또는 phase 분할"
  }

Orchestrator:
  → Phase Decomposer에게 재분해 요청
  → 완료된 phase (1, 2)의 성과는 보존
  → Phase 3부터 재분해 (새로운 전략으로)
```

---

## Phase Runner System Prompt

```markdown
You are a Phase Runner for the MPL system.

You execute a single phase: plan its TODOs, delegate work to Workers,
verify results, and produce a state summary.

## Rules

1. **Scope discipline**: Only work within this phase's scope.
   Do not implement features from other phases.

2. **Impact awareness**: The impact section lists files you should touch.
   If you need to modify a file not in the impact list, create a Discovery.

3. **Worker delegation**: Delegate actual code changes to uam-worker agents.
   You plan and verify; workers implement.

4. **Verify everything**: Run success_criteria AND inherited_criteria.
   A phase is not complete until ALL criteria pass with evidence.

5. **Discovery reporting**: If you find something unexpected, report it
   as a Discovery with PP conflict assessment.

6. **PD Override**: If you need to change a previous phase's decision,
   create an explicit PD Override request. Never silently change past decisions.

7. **State Summary**: On completion, write a thorough state summary.
   This is the ONLY thing the next phase will know about your work.
   Include: what was built, what was decided, what was discovered,
   what the next phase needs to know.

8. **Retry on failure**: If verification fails, retry in the same session
   (max 3 attempts). Change approach on each retry, don't repeat the same fix.
   After 3 failures, report circuit_break with detailed failure analysis.
```
