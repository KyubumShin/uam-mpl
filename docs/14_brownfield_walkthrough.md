# 14. Brownfield 워크스루: 기존 프로젝트에 MPL 적용

## 목적

08_walkthrough.md는 빈 프로젝트(Greenfield) 시나리오를 검증했다.
이 문서는 **기존 코드가 이미 있는 프로젝트(Brownfield)**에 MPL을 적용하는 시나리오를 검증한다.

### Greenfield vs Brownfield 차이

```
Greenfield:
  - PD 없음, PP만 정의
  - codebase_analyze 출력이 작음
  - 모든 파일이 새로 생성됨
  - 기존 테스트 없음

Brownfield:
  - 기존 코드의 암묵적 결정이 PD로 부트스트래핑 필요
  - codebase_analyze 출력이 클 수 있음 (수백 개 파일)
  - 대부분의 파일이 modify
  - 기존 테스트가 inherited_criteria로 보호되어야 함
```

---

## 시나리오: 기존 Express API에 페이지네이션 + 필터링 추가

### 기존 프로젝트 상태

```
프로젝트: Task Management API (운영 중)
코드 규모: ~60 파일
스택: Express + TypeScript + PostgreSQL + Jest

기존 구조:
  src/
    app.ts                    # Express 서버, 라우터 등록
    db/connection.ts          # PostgreSQL pool
    models/
      task.ts                 # Task CRUD (SQL 직접)
      user.ts                 # User CRUD
    routes/
      tasks.ts                # GET/POST/PUT/DELETE /tasks
      users.ts                # GET/POST /users
      auth.ts                 # POST /auth/login, /auth/register
    auth/
      middleware.ts            # JWT 인증 미들웨어
      token.ts                # JWT 생성/검증
    utils/
      validator.ts            # 입력 검증
      pagination.ts           # (없음 — 추가 예정)
  tests/
    routes/tasks.test.ts      # 12개 테스트
    routes/users.test.ts      # 8개 테스트
    routes/auth.test.ts       # 6개 테스트
    models/task.test.ts       # 5개 테스트

기존 테스트: 31개 전부 통과
```

### 사용자 요청

```
"모든 목록 API에 페이지네이션, 필터링, 정렬 기능을 추가해주세요.
cursor 기반 페이지네이션으로 구현하고, 필터는 쿼리 파라미터로 받고,
정렬은 다중 필드를 지원해야 합니다."
```

---

## Phase 0: PD 부트스트래핑

### 문제: 암묵적 결정

기존 코드에는 명시적으로 기록된 PD가 없다.
하지만 코드 안에 **이미 결정된 것들**이 존재한다:

```
암묵적 결정 (코드에서 추출 필요):
  - Express 4.18 + TypeScript 사용
  - PostgreSQL with pg pool
  - JWT RS256 인증
  - SQL 직접 작성 (ORM 없음)
  - Jest 테스트 프레임워크
  - RESTful URL 패턴 (/tasks, /users, /auth)
  - Task 스키마: { id, title, description, status, userId, createdAt }
  - User 스키마: { id, email, passwordHash, createdAt }
```

### 부트스트래핑 메커니즘

Orchestrator가 codebase_analyze 결과를 기반으로 **초기 PD를 자동 생성**:

```
PD 부트스트래핑 소스:
  1. config → 기술 스택 결정
     package.json deps → PD: "Express 4.18 + TypeScript"
     tsconfig.json → PD: "TypeScript strict mode"

  2. interfaces → 모델/API 결정
     lsp_document_symbols → 모든 exported type/function
     → PD: "Task 스키마", "User 스키마"
     → PD: "authMiddleware 인터페이스"

  3. tests → 검증 기반
     test files → inherited_criteria 초기 목록
     → "npm test: 31/31 통과" (baseline)

  4. structure → 구조 결정
     디렉토리 패턴 → PD: "src/{models,routes,auth,utils}/ 구조"
```

### 부트스트래핑 결과

```markdown
# Phase Decisions (Bootstrap — 기존 코드에서 추출)

## PD-boot-1: Express 4.18 + TypeScript 5.x
- 출처: package.json, tsconfig.json
- 파일: src/app.ts, tsconfig.json
- 유형: Architecture

## PD-boot-2: PostgreSQL with pg pool (ORM 없음)
- 출처: package.json (pg), src/db/connection.ts
- 파일: src/db/connection.ts
- 유형: Architecture

## PD-boot-3: Task 스키마
- 출처: src/models/task.ts (interface 추출)
- 현재: { id: uuid, title: string, description: text, status: enum, userId: uuid, createdAt: timestamp }
- 파일: src/models/task.ts
- 유형: DB Schema

## PD-boot-4: User 스키마
- 출처: src/models/user.ts
- 현재: { id: uuid, email: string, passwordHash: string, createdAt: timestamp }
- 파일: src/models/user.ts
- 유형: DB Schema

## PD-boot-5: JWT RS256 인증
- 출처: src/auth/token.ts
- 인터페이스: sign(payload) → token, verify(token) → payload
- 파일: src/auth/token.ts, src/auth/middleware.ts
- 유형: API Contract

## PD-boot-6: RESTful 라우팅 패턴
- 출처: src/routes/*.ts
- 패턴: /{resource} (복수형), Express Router
- 파일: src/routes/tasks.ts, src/routes/users.ts, src/routes/auth.ts
- 유형: API Contract

## PD-boot-7: Jest 테스트 인프라
- 출처: jest.config.ts, tests/
- 커버리지: 31개 테스트, routes + models
- 명령: npm test
- 유형: Infrastructure
```

### 부트스트래핑 구현

```
Orchestrator의 INIT 단계에서:

1. codebase_analyze 실행 → CodebaseAnalysis

2. Bootstrap PD 생성 (자동)
   → config 섹션 → Architecture PD
   → interfaces 섹션 → Schema/Contract PD
   → tests 섹션 → Infrastructure PD

3. 사용자 확인 (standard/strict 모드에서)
   "기존 코드에서 다음 결정을 추출했습니다. 검토해주세요:"
   → PD 목록 제시
   → 사용자가 수정/추가/삭제 가능

4. .uam/mpl/phase-decisions.md에 저장
   → PD-boot-N 접두사로 구분
```

---

## Phase 0: PP Interview

기존 프로젝트에서의 PP:

```markdown
# Pivot Points

## PP-1: 기존 API 하위 호환성 [CONFIRMED]
- 원칙: 기존 API의 응답 형식과 동작을 깨뜨리지 않는다
- 판정 기준: 기존 31개 테스트 전부 통과
- 우선순위: 1

## PP-2: SQL 직접 작성 (ORM 도입 금지) [CONFIRMED]
- 원칙: 기존 패턴과 동일하게 pg로 직접 SQL 작성
- 판정 기준: ORM 패키지(sequelize, typeorm, prisma 등) import 시 위반
- 우선순위: 2

## PP-3: cursor 기반 페이지네이션 [CONFIRMED]
- 원칙: offset이 아닌 cursor 방식
- 판정 기준: OFFSET 키워드 사용 시 위반
- 우선순위: 3
```

---

## codebase_analyze 출력 (발췌)

```yaml
structure:
  directories:
    - path: "src/models/"
      files: ["task.ts", "user.ts"]
    - path: "src/routes/"
      files: ["tasks.ts", "users.ts", "auth.ts"]
    - path: "src/auth/"
      files: ["middleware.ts", "token.ts"]
  total_files: 58

dependencies:
  high_impact_modules:
    - file: "src/models/task.ts"
      imported_by: ["routes/tasks.ts", "tests/models/task.test.ts", "tests/routes/tasks.test.ts"]
      transitive_impact: 5
      warning: "Task 모델 변경 시 5개 파일 영향"

    - file: "src/db/connection.ts"
      imported_by: ["models/task.ts", "models/user.ts"]
      transitive_impact: 8
      warning: "DB 연결 변경은 전체에 cascade"

  module_clusters:
    - name: "task-domain"
      files: ["src/models/task.ts", "src/routes/tasks.ts"]
      internal_edges: 2

interfaces:
  functions:
    - name: "getAllTasks"
      file: "src/models/task.ts"
      signature: "(userId: string) => Promise<Task[]>"
    - name: "getTaskById"
      file: "src/models/task.ts"
      signature: "(id: string, userId: string) => Promise<Task | null>"

tests:
  framework: "jest"
  run_command: "npm test"
  test_files:
    - path: "tests/routes/tasks.test.ts"
      covers: ["src/routes/tasks.ts"]
      test_count: 12
    - path: "tests/models/task.test.ts"
      covers: ["src/models/task.ts"]
      test_count: 5
  current_status:
    tests: "31/31 pass"
    build: "pass"
```

### 대규모 codebase_analyze 처리

60파일 규모에서는 문제없지만, 수백 파일일 때:

```
전략: Focus Area 지정

codebase_analyze(
  root_path: "./src",
  focus_area: "models/, routes/"  # 관련 영역만 상세 분석
)

→ focus_area 내 파일: 상세 분석 (imports, interfaces, centrality)
→ focus_area 외 파일: 파일명 + imported_by count만

효과:
  - 60파일 → 전체 분석: ~3K tokens
  - 500파일 → focus 분석: ~5K tokens (전체 분석 시 ~15K tokens)
```

---

## phase_decompose 결과

```yaml
architecture_anchor:
  tech_stack: [Node.js, TypeScript, Express, PostgreSQL, pg]
  directory_pattern: "src/{models,routes,auth,utils}/"
  naming_convention: "camelCase, PascalCase types"
  key_decisions:
    - "기존 패턴 유지: pg 직접 쿼리, Express Router"
    - "cursor 페이지네이션: createdAt 기반 커서"

phases:
  - id: phase-1
    name: "Pagination Core"
    scope: "범용 커서 페이지네이션 유틸리티 + SQL 빌더"
    rationale: "공통 유틸리티를 먼저 만들어야 각 엔드포인트에 적용 가능"

    impact:
      create:
        - path: src/utils/pagination.ts
          description: "커서 페이지네이션 유틸리티 (encode/decode cursor, build SQL)"
        - path: src/utils/query-builder.ts
          description: "동적 WHERE/ORDER BY SQL 빌더"
        - path: tests/utils/pagination.test.ts
          description: "페이지네이션 유틸리티 단위 테스트"
      modify: []
      affected_tests: []
      affected_config: []

    interface_contract:
      requires:
        - type: "Database"
          name: "pg pool"
          from_phase: "bootstrap"
      produces:
        - type: "Utility"
          name: "buildPaginatedQuery"
          spec: "(table, filters, sort, cursor, limit) => { sql, params }"
        - type: "Utility"
          name: "encodeCursor / decodeCursor"
          spec: "(row) => string / (cursor) => { field, value, direction }"

    success_criteria:
      - type: "command"
        run: "npx tsc --noEmit"
        expect_exit: 0
      - type: "test"
        run: "npm test -- --testPathPattern utils/pagination"
        expect_exit: 0
      - type: "file_exists"
        paths: ["src/utils/pagination.ts", "src/utils/query-builder.ts"]

    inherited_criteria:
      - from_phase: bootstrap
        test: "npm test (31/31 기존 테스트 통과)"

    estimated_complexity: M
    estimated_todos: 4
    estimated_files: 3
    risk_notes:
      - "커서 인코딩 형식 결정 필요 (base64 vs opaque ID)"

  - id: phase-2
    name: "Tasks API Enhancement"
    scope: "GET /tasks에 페이지네이션, 필터링, 정렬 적용"
    rationale: "가장 많이 사용되는 엔드포인트부터 적용. task-domain 클러스터 내 작업"

    impact:
      create: []
      modify:
        - path: src/models/task.ts
          location_hint: "getAllTasks 함수"
          change_description: "페이지네이션/필터/정렬 파라미터 수용, SQL 변경"
        - path: src/routes/tasks.ts
          location_hint: "GET / 핸들러"
          change_description: "쿼리 파라미터 파싱, 페이지네이션 응답 형식"
      affected_tests:
        - path: tests/routes/tasks.test.ts
          reason: "GET /tasks 응답 형식 변경 (배열 → { data, cursor, hasMore })"
        - path: tests/models/task.test.ts
          reason: "getAllTasks 시그니처 변경"
      affected_config: []

    interface_contract:
      requires:
        - type: "Utility"
          name: "buildPaginatedQuery"
          from_phase: "phase-1"
        - type: "Utility"
          name: "encodeCursor / decodeCursor"
          from_phase: "phase-1"
      produces:
        - type: "REST Endpoint"
          name: "GET /tasks?status=todo&sort=-createdAt&cursor=xxx&limit=20"
          spec: "→ { data: Task[], cursor: string|null, hasMore: boolean }"

    success_criteria:
      - type: "command"
        run: "npx tsc --noEmit"
        expect_exit: 0
      - type: "test"
        run: "npm test -- --testPathPattern tasks"
        expect_exit: 0
      - type: "grep"
        file: "src/routes/tasks.ts"
        pattern: "buildPaginatedQuery"
      - type: "description"
        text: "GET /tasks?limit=2 → 2개만 반환 + hasMore + cursor"

    inherited_criteria:
      - from_phase: bootstrap
        test: "npm test (기존 테스트 — 수정 후에도 통과)"
      - from_phase: phase-1
        test: "npm test -- --testPathPattern utils/pagination"

    estimated_complexity: M
    estimated_todos: 5
    estimated_files: 4
    risk_notes:
      - "기존 GET /tasks 응답 형식 변경 → PP-1(하위 호환성) 주의"
      - "기존 테스트 12개 수정 필요"

  - id: phase-3
    name: "Users API Enhancement + Shared Refinement"
    scope: "GET /users에 동일 패턴 적용, 공통 유틸 보강"
    rationale: "Phase 2 패턴을 복제 적용. 발견된 개선점 반영"

    impact:
      create: []
      modify:
        - path: src/models/user.ts
          location_hint: "getAllUsers 함수"
          change_description: "페이지네이션/필터/정렬 파라미터 수용"
        - path: src/routes/users.ts
          location_hint: "GET / 핸들러"
          change_description: "쿼리 파라미터 파싱, 페이지네이션 응답 형식"
        - path: src/utils/pagination.ts
          location_hint: "필요 시"
          change_description: "Phase 2에서 발견된 개선점 반영"
      affected_tests:
        - path: tests/routes/users.test.ts
          reason: "GET /users 응답 형식 변경"
      affected_config: []

    interface_contract:
      requires:
        - type: "Utility"
          name: "buildPaginatedQuery"
          from_phase: "phase-1"
        - type: "Pattern"
          name: "Tasks 페이지네이션 패턴"
          from_phase: "phase-2"
      produces:
        - type: "REST Endpoint"
          name: "GET /users?sort=-createdAt&cursor=xxx&limit=20"
          spec: "→ { data: User[], cursor: string|null, hasMore: boolean }"

    success_criteria:
      - type: "command"
        run: "npx tsc --noEmit"
        expect_exit: 0
      - type: "test"
        run: "npm test"
        expect_exit: 0

    inherited_criteria:
      - from_phase: bootstrap
        test: "npm test (전체 기존 테스트)"
      - from_phase: phase-1
        test: "pagination 유틸 테스트"
      - from_phase: phase-2
        test: "tasks 테스트"

    estimated_complexity: S
    estimated_todos: 3
    estimated_files: 4
    risk_notes: []

shared_resources:
  - file: src/utils/pagination.ts
    touched_by: [phase-1, phase-3]
    strategy: "sequential"
    notes: "Phase 1에서 생성, Phase 3에서 보강"

decomposition_rationale: >
  공통 유틸리티 → 메인 엔드포인트 → 나머지 엔드포인트 순서.
  task-domain 클러스터가 high_impact이므로 Phase 2에서 집중 처리.
  Phase 3은 Phase 2의 패턴을 복제하는 낮은 위험 작업.
```

---

## Phase 실행 흐름

### Phase 1: Pagination Core

```
Context:
  PP: PP-1(하위호환), PP-2(ORM 금지), PP-3(cursor)
  PD: boot-1~7 (기존 결정)
  impact_files: 없음 (모두 신규)
  maturity: standard

실행:
  TODO-1: src/utils/pagination.ts 생성
    → encodeCursor: base64(JSON.stringify({field, value, dir}))
    → decodeCursor: JSON.parse(atob(cursor))
    → buildCursorWhere: WHERE createdAt > $cursor ORDER BY createdAt

  TODO-2: src/utils/query-builder.ts 생성
    → buildFilterWhere: 동적 WHERE 절 (status=todo → WHERE status = 'todo')
    → buildSortClause: 동적 ORDER BY (-createdAt → ORDER BY created_at DESC)
    → buildPaginatedQuery: filter + sort + cursor + LIMIT 조합

  TODO-3: tests/utils/pagination.test.ts 생성
    → cursor encode/decode 왕복 테스트
    → filter 조합 테스트
    → sort 다중 필드 테스트
    → SQL injection 방지 테스트

  TODO-4: 검증
    → tsc --noEmit: PASS
    → pagination 테스트: PASS (8/8)
    → 기존 31개 테스트: PASS (변경 없으므로 당연)

결과:
  PD-1: cursor 인코딩 형식 (base64 JSON, createdAt 기반)
  PD-2: 쿼리 빌더 인터페이스 (buildPaginatedQuery signature)
  Discovery: 없음
```

### Phase 2: Tasks API Enhancement

```
Context:
  PP: PP-1, PP-2, PP-3
  PD: boot-1~7 + PD-1, PD-2
  impact_files:
    - src/models/task.ts (기존 코드)
    - src/routes/tasks.ts (기존 코드)
    - tests/routes/tasks.test.ts (기존 테스트)
    - tests/models/task.test.ts (기존 테스트)
  maturity: standard

실행:
  TODO-1: src/models/task.ts 수정
    getAllTasks(userId) → getAllTasks(userId, { filters, sort, cursor, limit })
    → buildPaginatedQuery 사용
    → 반환: { data: Task[], cursor, hasMore }

  TODO-2: src/routes/tasks.ts 수정
    GET / 핸들러에 쿼리 파라미터 파싱 추가
    → ?status=todo&sort=-createdAt&cursor=xxx&limit=20
    → 응답: { data: [...], cursor: "...", hasMore: true }

  TODO-3: tests/routes/tasks.test.ts 수정
    기존 12개 테스트 → 응답 형식 변경 반영
    신규 테스트 추가: 페이지네이션, 필터, 정렬

  TODO-4: tests/models/task.test.ts 수정
    getAllTasks 시그니처 변경 반영

  Discovery:
    D-1: "GET /tasks 기존 응답이 배열이었는데 객체로 변경됨.
          PP-1(하위 호환성)에 충돌할 수 있음."

Discovery 처리 (standard 모드):
  → PP-1 충돌 → HITL
  → 사용자: "페이지네이션 추가가 목적이므로 응답 형식 변경은 수용.
             단, 기존 클라이언트를 위해 limit 미지정 시 전체 반환은 유지."
  → PP-1 판정 기준 업데이트:
    "기존 엔드포인트 URL은 유지. 응답 형식 변경은 페이지네이션 목적으로 허용.
     단, limit 파라미터 없이 호출 시 기존과 동일하게 전체 반환."

  TODO-5 (추가): limit 미지정 시 기존 동작 호환 처리
    → limit = undefined → 전체 반환 (기존 동작)
    → limit = N → 페이지네이션 응답

검증:
  → tsc: PASS
  → tasks 테스트: PASS (12개 수정 + 6개 신규 = 18/18)
  → 기존 전체 테스트: 31 + 8(phase-1) + 6(phase-2 신규) = 45/45 PASS

결과:
  PD-3: GET /tasks 페이지네이션 응답 형식 { data, cursor, hasMore }
  PD-4: limit 미지정 시 전체 반환 (하위 호환)
  PD-3-note: PP-1 HITL 결과로 하위 호환 처리 추가됨
```

### Phase 3: Users API Enhancement

```
Context:
  PP: PP-1(업데이트됨), PP-2, PP-3
  PD: boot-1~7 + PD-1~4
  impact_files: src/models/user.ts, src/routes/users.ts, tests/routes/users.test.ts
  maturity: standard

실행:
  Phase 2의 패턴을 그대로 복제 적용.
  PD-3(응답 형식), PD-4(하위 호환)를 참조하여 동일 패턴.

  Discovery: 없음 (Phase 2에서 패턴 확립)

검증:
  → tsc: PASS
  → 전체 테스트: PASS
  → 마지막 phase이므로 전수 검사 실행

결과:
  PD-5: GET /users 페이지네이션 (GET /tasks와 동일 패턴)
```

---

## Brownfield 핵심 메커니즘

### 1. PD 부트스트래핑

```
목적: 기존 코드의 암묵적 결정을 명시적 PD로 변환

입력: codebase_analyze 출력
출력: PD-boot-N 목록

추출 규칙:
  config.package_json.key_deps    → Architecture PD
  config.env_vars                 → Infrastructure PD
  interfaces.types (exported)     → Schema PD
  interfaces.functions (exported) → Contract PD
  interfaces.endpoints            → API Contract PD
  tests.framework                 → Infrastructure PD
  structure.directory_pattern     → Convention PD

정밀도:
  - 자동 추출은 80% 정확
  - 사용자 검토로 보정 (standard/strict 모드)
  - explore 모드에서는 자동 추출 그대로 사용
```

### 2. inherited_criteria 초기 등록

```
기존 테스트를 baseline으로 등록:

from codebase_analyze.tests:
  inherited_criteria_baseline = {
    command: tests.run_command,     # "npm test"
    expected: tests.current_status, # "31/31 pass"
    scope: "전체"
  }

Phase 1부터 이 baseline이 inherited_criteria로 포함됨:
  - from_phase: "bootstrap"
    test: "npm test (31/31 기존 테스트)"
```

### 3. 기존 테스트 수정 전략

```
기존 테스트가 새 기능으로 인해 깨질 수 있는 경우:

1. Decomposer가 affected_tests에 명시
   → 해당 테스트 파일이 impact_files에 포함됨

2. Phase Runner가 기능 구현 + 테스트 수정을 같은 phase에서 처리
   → 테스트가 깨지는 것과 수정이 같은 phase에서 발생

3. inherited_criteria는 "수정된 테스트 포함"으로 검증
   → 기존 31개 → 일부 수정 → 수정 후 전체 통과 확인

주의:
  기존 테스트를 삭제하지 않는다 (PP-1 위반).
  기존 테스트의 의도를 보존하면서 새 형식에 맞게 수정.
```

### 4. 대규모 codebase_analyze 처리

```
파일 수별 전략:

~50 파일:  전체 분석 (기본)
~200 파일: focus_area 지정 (사용자 요청 관련 영역만 상세)
~500 파일: focus_area + 요약 모드 (상세는 focus만, 나머지는 파일명 + centrality)
~1000+ 파일: focus_area + summary + git diff 기반 (최근 변경 파일 우선)

Decomposer에게 전달되는 context는 항상 ~3K-5K tokens로 제한:
  - high_impact_modules: 상위 10개만
  - module_clusters: 관련 클러스터만
  - interfaces: focus_area 내 exported만
```

---

## Brownfield vs Greenfield 비교 (이 시나리오 기준)

```
                        Greenfield (08)    Brownfield (14)
─────────────────────────────────────────────────────────
초기 PD                  0개                7개 (bootstrap)
PP Interview             필수               선택적 (기존 제약 추출 가능)
codebase_analyze         빠름 (~0.5초)      보통 (~2초, 60파일)
Phase 수                 4개                3개 (기존 기반 위 추가)
주요 impact 타입         create             modify
기존 테스트 처리         없음               inherited_criteria baseline
Discovery 위험           기술 선택          기존 코드와의 충돌
PP 충돌 위험             낮음               높음 (하위 호환성)

MPL 이점:
  Greenfield: context 절감, 점진적 검증
  Brownfield: + 기존 코드 보호(inherited), + 충돌 조기 발견(Discovery)
```

---

## 요약

```
Brownfield MPL 적용의 핵심:

1. PD 부트스트래핑: codebase_analyze → 자동 PD 생성 → 사용자 검토
2. inherited_criteria baseline: 기존 테스트를 phase 0부터 보호
3. affected_tests 동반 수정: 기능 변경과 테스트 수정이 같은 phase
4. PP로 하위 호환성 보호: 기존 API 동작 변경 시 HITL
5. focus_area로 대규모 codebase 처리: 관련 영역만 상세 분석

Brownfield에서 MPL이 특히 유리한 이유:
  → Phase 단위로 기존 테스트를 보호하면서 점진적 변경
  → Discovery로 기존 코드와의 충돌을 조기에 발견
  → PD 부트스트래핑으로 기존 결정을 명시화 → 일관성 유지
```
