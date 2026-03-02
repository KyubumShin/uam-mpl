# 08. Prototype Walkthrough: "Task 관리 REST API"

## 시나리오

```
사용자 요청: "Task 관리 REST API를 만들어줘. CRUD + 사용자 인증 + 권한 관리"
프로젝트: 빈 디렉토리 (package.json만 존재)
모드: /uam --mpl "Task 관리 REST API ..."
Maturity: standard
```

---

## Phase 0: PP Interview

### 인터뷰 (uam-pivot 스킬)

```
Round 1: "이 프로젝트에서 절대 변하면 안 되는 것이 있나요?"
사용자: "REST API만 사용, GraphQL 같은 건 안 됨"

Round 2: "다른 제약이 있나요?"
사용자: "외부 라이브러리는 최소한으로"

Round 3: "REST API만 사용하는 것과 외부 라이브러리 최소화가 충돌하면?"
사용자: "REST API가 우선"

Round 4: "외부 라이브러리 최소화를 어떻게 판단할까요?"
사용자: "잘 모르겠음"
→ 전략 2 적용: PROVISIONAL로 진행, 실제 사례에서 구체화
```

### 산출물: `.uam/pivot-points.md`

```markdown
# Pivot Points

## PP-1: REST API Only [CONFIRMED]
- 원칙: 모든 외부 인터페이스는 REST API로 제공
- 판정 기준: GraphQL, gRPC, WebSocket 엔드포인트 생성 시 위반
- 우선순위: 1
- 위반 예시: GraphQL schema 파일 생성
- 허용 예시: REST endpoint에서 SSE 알림 (보조 수단)

## PP-2: 외부 의존성 최소화 [PROVISIONAL]
- 원칙: 외부 패키지는 핵심 기능에만 사용
- 판정 기준: [미정 — Phase 실행 중 구체화 예정]
- 우선순위: 2

## Priority Order
PP-1 > PP-2
```

---

## codebase_analyze 실행

### 실행 (도구, 토큰 소비 거의 없음)

```bash
# Layer 1: 정적 분석
ast_grep_search → import 패턴 없음 (빈 프로젝트)
glob → package.json만 존재
```

### 산출물: `.uam/mpl/codebase-analysis.json`

```json
{
  "structure": {
    "directories": [],
    "entry_points": [],
    "file_stats": { "total_files": 1, "by_type": { "json": 1 } }
  },
  "dependencies": {
    "modules": [],
    "external_deps": [],
    "high_impact_modules": [],
    "circular_deps": [],
    "module_clusters": []
  },
  "interfaces": {
    "types": [],
    "functions": [],
    "endpoints": []
  },
  "tests": {
    "framework": null,
    "run_command": null,
    "test_files": [],
    "current_status": null
  },
  "config": {
    "env_vars": [],
    "config_files": [
      { "path": "package.json", "purpose": "프로젝트 설정" }
    ],
    "package_json": {
      "scripts": {},
      "key_deps": []
    }
  }
}
```

---

## phase_decompose 실행

### Decomposer Input

```
user_request: "Task 관리 REST API (CRUD + 인증 + 권한)"
pivot_points: PP-1 (REST Only), PP-2 (최소 의존성)
codebase: 빈 프로젝트
maturity_mode: standard
```

### Decomposer Output: `.uam/mpl/decomposition.yaml`

```yaml
architecture_anchor:
  tech_stack: [Node.js, TypeScript, Express, PostgreSQL, Jest]
  directory_pattern: "src/{routes,models,auth,middleware}/"
  naming_convention: "camelCase vars, PascalCase types, kebab-case files"
  key_decisions:
    - "Express: PP-2 고려, 가장 가벼운 풀스택 프레임워크"
    - "PostgreSQL: task-user 관계형 데이터에 적합"
    - "Jest: 테스트 프레임워크 사실상 표준"

phases:
  - id: phase-1
    name: "Foundation"
    scope: "프로젝트 초기화, TypeScript 설정, DB 연결, Express 서버, 테스트 인프라"
    rationale: "모든 후속 phase의 기반"

    impact:
      create:
        - path: src/app.ts
          description: "Express 서버 진입점"
        - path: src/db.ts
          description: "PostgreSQL 연결 풀"
        - path: tsconfig.json
          description: "TypeScript 컴파일 설정"
        - path: jest.config.ts
          description: "Jest 설정"
        - path: .env.example
          description: "환경변수 템플릿"
        - path: tests/health.test.ts
          description: "헬스체크 테스트"
      modify:
        - path: package.json
          location_hint: "전체"
          change_description: "dependencies + scripts 추가"
      affected_tests: []
      affected_config:
        - path: .env
          change: "DATABASE_URL, PORT 추가"

    interface_contract:
      requires: []
      produces:
        - type: "Server"
          name: "Express app"
          spec: "src/app.ts default export, GET /health → 200"
        - type: "DB Connection"
          name: "db pool"
          spec: "src/db.ts, pool.query(sql, params)"

    success_criteria:
      - "npx tsc --noEmit 성공"
      - "npm test 통과"
      - "서버 시작 후 GET /health → 200"
    inherited_criteria: []
    estimated_complexity: S
    estimated_todos: 4
    estimated_files: 7
    risk_notes:
      - "DB 연결 실패 가능 — 환경변수 설정 필요"

  - id: phase-2
    name: "Task CRUD"
    scope: "Task 모델, CRUD 엔드포인트, 입력 검증"
    rationale: "핵심 비즈니스 로직 먼저. 인증 전에 API가 동작해야 확인 가능"

    impact:
      create:
        - path: src/models/task.ts
          description: "Task 타입 + DB 쿼리"
        - path: src/routes/tasks.ts
          description: "CRUD 라우터"
        - path: migrations/001_create_tasks.sql
          description: "tasks 테이블"
        - path: tests/routes/tasks.test.ts
          description: "Task API 테스트"
      modify:
        - path: src/app.ts
          location_hint: "라우터 등록 부분 (app.use 근처)"
          change_description: "tasks 라우터 마운트"
        - path: package.json
          location_hint: "scripts"
          change_description: "migrate 스크립트 추가"
      affected_tests:
        - path: tests/health.test.ts
          reason: "서버 설정 변경 시 영향 가능"
      affected_config: []

    interface_contract:
      requires:
        - type: "Server"
          name: "Express app"
          from_phase: "phase-1"
        - type: "DB Connection"
          name: "db pool"
          from_phase: "phase-1"
      produces:
        - type: "DB Model"
          name: "Task"
          spec: "{ id, title, description, status, createdAt }"
        - type: "REST Endpoint"
          name: "CRUD /tasks"
          spec: "GET(list), GET/:id, POST, PUT/:id, DELETE/:id"

    success_criteria:
      - "npx tsc --noEmit 성공"
      - "POST /tasks → 201 + task 반환"
      - "GET /tasks → 200 + 배열 반환"
      - "GET /tasks/:id → 200 (존재) / 404 (미존재)"
      - "PUT /tasks/:id → 200"
      - "DELETE /tasks/:id → 204"
      - "잘못된 입력 → 400"
    inherited_criteria:
      - from_phase: phase-1
        test: "GET /health → 200"
    estimated_complexity: M
    estimated_todos: 5
    estimated_files: 5
    risk_notes: []

  - id: phase-3
    name: "Authentication"
    scope: "User 모델, 회원가입/로그인, JWT 미들웨어, 기존 라우트에 인증 적용"
    rationale: "CRUD 동작 확인 후 인증 레이어 추가"

    impact:
      create:
        - path: src/models/user.ts
          description: "User 타입 + DB 쿼리 + 패스워드 해싱"
        - path: src/auth/token.ts
          description: "JWT 생성/검증"
        - path: src/auth/middleware.ts
          description: "인증 미들웨어"
        - path: src/routes/auth.ts
          description: "회원가입/로그인 엔드포인트"
        - path: migrations/002_create_users.sql
          description: "users 테이블"
        - path: tests/routes/auth.test.ts
          description: "인증 API 테스트"
      modify:
        - path: src/app.ts
          location_hint: "라우터 등록 부분"
          change_description: "auth 라우터 추가 + tasks에 미들웨어 적용"
        - path: src/routes/tasks.ts
          location_hint: "라우터 전체"
          change_description: "authMiddleware 적용"
        - path: tests/routes/tasks.test.ts
          location_hint: "모든 요청"
          change_description: "Authorization 헤더 추가"
      affected_tests:
        - path: tests/routes/tasks.test.ts
          reason: "인증 필수로 변경되므로 기존 테스트 수정 필요"
      affected_config:
        - path: .env
          change: "JWT_SECRET 추가"

    interface_contract:
      requires:
        - type: "Server"
          name: "Express app"
          from_phase: "phase-1"
        - type: "DB Connection"
          name: "db pool"
          from_phase: "phase-1"
        - type: "REST Endpoint"
          name: "CRUD /tasks"
          from_phase: "phase-2"
      produces:
        - type: "Middleware"
          name: "authMiddleware"
          spec: "(req, res, next) → req.userId 설정"
        - type: "REST Endpoint"
          name: "POST /auth/register"
          spec: "{ email, password } → 201 { id, email }"
        - type: "REST Endpoint"
          name: "POST /auth/login"
          spec: "{ email, password } → 200 { token }"

    success_criteria:
      - "npx tsc --noEmit 성공"
      - "POST /auth/register → 201"
      - "POST /auth/login → 200 + JWT 반환"
      - "인증 없이 GET /tasks → 401"
      - "유효한 JWT로 GET /tasks → 200"
      - "npm test 전체 통과"
    inherited_criteria:
      - from_phase: phase-1
        test: "GET /health → 200"
      - from_phase: phase-2
        test: "인증된 상태에서 Task CRUD 동작"
    estimated_complexity: M
    estimated_todos: 5
    estimated_files: 8
    risk_notes:
      - "기존 tasks 테스트가 인증 추가로 깨질 수 있음 — affected_tests에 명시"

  - id: phase-4
    name: "Authorization & Polish"
    scope: "Task 소유권 검사, 에러 핸들링 미들웨어, 입력 검증 강화"
    rationale: "인증 후 권한 검사 추가. 마무리 단계"

    impact:
      create:
        - path: src/middleware/error-handler.ts
          description: "통합 에러 핸들러"
        - path: tests/authorization.test.ts
          description: "권한 검사 테스트"
      modify:
        - path: src/models/task.ts
          location_hint: "쿼리 함수들"
          change_description: "userId 기반 필터링 추가"
        - path: src/routes/tasks.ts
          location_hint: "각 핸들러"
          change_description: "소유권 검사 추가"
        - path: migrations/001_create_tasks.sql
          location_hint: "테이블 정의"
          change_description: "userId 컬럼 추가 (PD Override 필요)"
        - path: src/app.ts
          location_hint: "마지막 미들웨어"
          change_description: "에러 핸들러 등록"
      affected_tests:
        - path: tests/routes/tasks.test.ts
          reason: "소유권 검사로 인한 테스트 수정"
      affected_config: []

    interface_contract:
      requires:
        - type: "Middleware"
          name: "authMiddleware"
          from_phase: "phase-3"
        - type: "DB Model"
          name: "Task"
          from_phase: "phase-2"
      produces:
        - type: "Feature"
          name: "Task ownership"
          spec: "사용자는 자신의 task만 CRUD 가능"
        - type: "Middleware"
          name: "errorHandler"
          spec: "통합 에러 응답 (400, 401, 403, 404, 500)"

    success_criteria:
      - "npx tsc --noEmit 성공"
      - "사용자 A의 task에 사용자 B 접근 → 403"
      - "잘못된 입력 → 400 (구조화된 에러 메시지)"
      - "존재하지 않는 리소스 → 404"
      - "npm test 전체 통과"
    inherited_criteria:
      - from_phase: phase-1
        test: "GET /health → 200"
      - from_phase: phase-2
        test: "Task CRUD 정상 동작"
      - from_phase: phase-3
        test: "인증 정상 동작"
    estimated_complexity: S
    estimated_todos: 4
    estimated_files: 6
    risk_notes:
      - "tasks 테이블에 userId 추가 → PD-3 (tasks 스키마) Override 필요"

shared_resources:
  - file: src/app.ts
    touched_by: [phase-1, phase-2, phase-3, phase-4]
    strategy: sequential
    notes: "매 phase에서 라우터/미들웨어 추가. 순서 중요"
  - file: package.json
    touched_by: [phase-1, phase-2]
    strategy: merge
    notes: "독립적인 의존성 추가, 충돌 없음"
  - file: tests/routes/tasks.test.ts
    touched_by: [phase-2, phase-3, phase-4]
    strategy: sequential
    notes: "Phase 3에서 인증 헤더 추가, Phase 4에서 소유권 테스트 추가"

decomposition_rationale: >
  Foundation → CRUD → Auth → Authorization 순서로 레이어링.
  핵심 API를 먼저 구현하여 동작 확인 후 인증/권한을 추가.
  src/app.ts가 모든 phase에서 수정되므로 sequential strategy 적용.
```

---

## Phase 1 실행: Foundation

### Context Loading

```
PP: PP-1, PP-2
PD: [] (첫 phase)
Phase Definition: phase-1 (위 참조)
Impact Files: package.json 내용만
```

### Mini-Plan

```markdown
- [ ] TODO-1: 프로젝트 초기화 (tsconfig, jest.config, .env.example)
- [ ] TODO-2: Express 서버 + health endpoint (src/app.ts)
- [ ] TODO-3: DB 연결 풀 (src/db.ts)
- [ ] TODO-4: 헬스체크 테스트 (tests/health.test.ts)
```

### Worker 실행

```
TODO-1, TODO-2, TODO-3 → 병렬 실행 (의존성 없음)
TODO-4 → TODO-2 완료 후
```

### Discovery

```
Worker가 Discovery 보고:
  D-1: "nodemon 추가하면 개발 편의성 향상"
  PP 충돌: PP-2 (최소 의존성) — PROVISIONAL
  → standard 모드 → HITL: "dev dependency는 허용" → PP-2 판정 기준 구체화
  → PP-2 판정 기준 업데이트: "production 의존성만 최소화, dev 도구는 허용"
```

### Verify

```
✓ npx tsc --noEmit → exit 0
✓ npm test → 1/1 pass
✓ GET /health → 200 { ok: true }
```

### State Summary

```markdown
## Phase 1 State Summary

### 구현된 것
- src/app.ts: Express 서버, GET /health
- src/db.ts: PostgreSQL 연결 풀
- tsconfig.json, jest.config.ts: 빌드/테스트 설정
- .env.example: DATABASE_URL, PORT

### Phase Decisions
- PD-1: Express 4.18 + TypeScript 5.x
- PD-2: PostgreSQL with pg 라이브러리
- PP-2 구체화: "production 의존성만 최소화, dev 도구 허용"

### 검증: 3/3 PASS
```

---

## Phase 2 실행: Task CRUD

### Context Loading

```
PP: PP-1, PP-2 (PP-2 판정 기준 업데이트됨)
PD: [PD-1, PD-2]
Phase Definition: phase-2
Impact Files: src/app.ts 내용 (Phase 1에서 생성된)
```

### Mini-Plan

```markdown
- [ ] TODO-1: Task 타입 + DB 쿼리 (src/models/task.ts)
- [ ] TODO-2: tasks 테이블 migration (migrations/001_create_tasks.sql)
- [ ] TODO-3: CRUD 라우터 (src/routes/tasks.ts)
      dependency: TODO-1
- [ ] TODO-4: app.ts에 라우터 등록
      dependency: TODO-3
- [ ] TODO-5: Task API 테스트 (tests/routes/tasks.test.ts)
      dependency: TODO-4
```

### Worker 실행 → 성공

### Verify

```
✓ npx tsc --noEmit → exit 0
✓ POST /tasks → 201
✓ GET /tasks → 200 []
✓ GET /tasks/:id → 200 / 404
✓ PUT /tasks/:id → 200
✓ DELETE /tasks/:id → 204
✓ 잘못된 입력 → 400
✓ 회귀: GET /health → 200
```

### State Summary

```markdown
## Phase 2 State Summary

### Phase Decisions
- PD-3: Task 스키마 { id: uuid, title, description, status: enum, createdAt }
- PD-4: status enum: ['todo', 'in_progress', 'done']

### 검증: 8/8 PASS
```

---

## Phase 3 실행: Authentication

### Context Loading

```
PP: PP-1, PP-2
PD: [PD-1, PD-2, PD-3, PD-4]
Impact Files: src/app.ts, src/routes/tasks.ts, tests/routes/tasks.test.ts
```

### Worker 실행 중 Discovery

```
Worker D-1: "argon2 패키지 필요 (패스워드 해싱)"
  → PP-2 충돌? → PP-2 판정 기준: "production 의존성만 최소화"
  → argon2는 production 의존성 → PROVISIONAL PP → HITL
  → 사용자: "보안 라이브러리는 허용"
  → PP-2 판정 기준 재업데이트: "보안 + 인프라 외 유틸리티만 금지"

Worker D-2: "refresh token 구현하면 좋겠음"
  → PP 충돌 없음
  → standard 모드: phase 완료 시 일괄 검토
  → 결과: 보류 → Phase 4 백로그
```

### Verify

```
✓ npx tsc --noEmit → exit 0
✓ POST /auth/register → 201
✓ POST /auth/login → 200 + JWT
✓ 인증 없이 GET /tasks → 401
✓ 유효한 JWT로 GET /tasks → 200
✓ npm test → 전체 통과
✓ 회귀: GET /health → 200
✓ 회귀: 인증 상태 Task CRUD 동작
```

---

## Phase 4 실행: Authorization & Polish

### PD Override 발생

```
Phase 4 mini-plan 작성 중:
  "tasks 테이블에 userId 컬럼이 없음 — 소유권 검사 불가"
  → PD-3 (Task 스키마) Override 필요

PD Override 요청:
  target_pd: PD-3
  original: { id, title, description, status, createdAt }
  proposed: { id, title, description, status, userId, createdAt }
  reason: "소유권 기반 권한 검사를 위해 userId 필요"
  affected_files: [migrations/001_create_tasks.sql, src/models/task.ts]

→ standard 모드 → HITL 요청
→ 사용자: "승인"
→ PD-3-override 기록 생성
→ 추가 migration: migrations/003_add_userId_to_tasks.sql
```

### Verify

```
✓ npx tsc --noEmit → exit 0
✓ 사용자 A task에 사용자 B → 403
✓ 잘못된 입력 → 400 (구조화된 메시지)
✓ 없는 리소스 → 404
✓ npm test → 전체 통과
✓ 회귀: 전체 Phase 1~3 criteria 통과
```

---

## 최종 산출물

### 파일 구조

```
src/
  app.ts
  db.ts
  auth/
    token.ts
    middleware.ts
  models/
    task.ts
    user.ts
  routes/
    tasks.ts
    auth.ts
  middleware/
    error-handler.ts
migrations/
  001_create_tasks.sql
  002_create_users.sql
  003_add_userId_to_tasks.sql
tests/
  health.test.ts
  routes/
    tasks.test.ts
    auth.test.ts
  authorization.test.ts
```

### MPL 상태 파일

```
.uam/
  pivot-points.md              # PP-1 CONFIRMED, PP-2 CONFIRMED (구체화 완료)
  discoveries.md               # D-1(nodemon 허용), D-2(argon2 허용), D-3(refresh token 보류)
  mpl/
    codebase-analysis.json     # 초기 분석 캐시
    decomposition.yaml         # 4 phases
    phase-decisions.md         # PD-1~6 + PD-3-override
    architecture-anchor.md     # Express + TS + PG
    phases/
      phase-1/
        mini-plan.md
        state-summary.md
        verification.md
      phase-2/ ...
      phase-3/ ...
      phase-4/ ...
    state.json                 # { status: "complete", phases: 4/4 }
```

---

## 워크스루에서 관찰된 MPL 이점

### 1. PP가 점진적으로 구체화됨

```
Phase 0: PP-2 "최소 의존성" [PROVISIONAL, 판정 기준 미정]
Phase 1: "dev 도구는 허용" (nodemon Discovery)
Phase 3: "보안 라이브러리 허용" (argon2 Discovery)
Phase 3: PP-2 → CONFIRMED (충분히 구체화됨)
```

4번의 HITL로 모호한 PP가 정밀한 제약으로 진화.

### 2. PD Override가 자연스럽게 작동

```
Phase 2: PD-3 "tasks 스키마에 userId 없음"
Phase 4: "userId 필요" → Override 요청 → 승인 → migration 추가
```

이전 결정을 바꿔야 할 때 기록 + 승인으로 투명하게 처리.

### 3. 각 Phase가 독립적으로 검증됨

```
Phase 1: 3/3 PASS → 기반 안정
Phase 2: 8/8 PASS → CRUD 안정
Phase 3: 8/8 PASS + 회귀 PASS → 인증 추가해도 기존 동작 유지
Phase 4: 5/5 PASS + 전체 회귀 PASS → 모든 것이 동작
```

문제가 발생했다면 해당 phase 내에서 격리되어 발견됨.

### 4. Context가 작게 유지됨

```
Phase 1: PP(500) + definition(300) + impact_files(200) ≈ 1K tokens
Phase 2: PP(500) + PD(400) + definition(400) + impact_files(500) ≈ 1.8K tokens
Phase 3: PP(500) + PD(800) + definition(500) + impact_files(1500) ≈ 3.3K tokens
Phase 4: PP(500) + PD(1200) + definition(400) + impact_files(2000) ≈ 4.1K tokens
```

Phase 4에서도 ~4K tokens. 현행 방식의 context 누적 (~60K+)과 비교하면 극적 차이.
