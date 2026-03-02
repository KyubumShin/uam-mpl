# 04. Phase Decomposer Design: MCP-Style Interface

## 설계 철학

> "탐색하는 에이전트"에서 "인터페이스로 받는 에이전트"로

```
현행: Decomposer가 직접 codebase 탐색 → 분석 → 정리 → 계획
      (탐색 자체가 context를 잡아먹음)

MPL:  사전에 구조화된 input을 만들어놓고 → Decomposer는 순수 추론만
      (MCP tool처럼 docs/input/output 인터페이스만 존재)
```

모든 "탐색"은 도구(tool)가 하고, 모든 "추론"은 에이전트가 한다. 두 역할이 완전히 분리된다.

---

## 전체 흐름

```
User Request
    ↓
[codebase_analyze]  ← 도구 실행 (에이전트 아님, 토큰 소비 최소)
    │  output: CodebaseAnalysis
    ↓
[PP Interview]      ← 사용자 인터랙션
    │  output: PivotPoints
    ↓
[phase_decompose]   ← 순수 추론 (파일 접근 없음)
    │  input:  {user_request, PP, CodebaseAnalysis}
    │  output: {phases[], shared_resources, anchor}
    ↓
For each phase:
    │
    ├── [impact_files_reader]  ← 도구 실행 (phase.impact에 명시된 파일만)
    │     output: [{path, content}]
    │
    └── [phase_run]  ← 실행 에이전트
          input:  {PP, PD[], phase_def, impact_files}
          output: {changes, decisions, discoveries, verification}
              │
              └── state_summary → 다음 phase의 PD에 추가
```

---

## Component 1: `codebase_analyze` (Input Provider)

### MCP Interface

```yaml
name: codebase_analyze
description: |
  코드베이스를 분석하여 구조화된 요약을 생성한다.
  Phase Decomposer의 입력으로 사용된다.
  코드를 "이해"하지 않고, 구조를 "추출"한다.

input_schema:
  root_path: string
  focus_area: string?     # 특정 영역만 분석 (optional)

output_schema:
  structure: StructureAnalysis
  dependencies: DependencyGraph
  interfaces: InterfaceExtraction
  centrality: CentralityAnalysis
  tests: TestInfrastructure
  config: ConfigurationMap
```

### 6개 분석 모듈

#### Module 1: Structure Analysis

```yaml
목적: "이 코드베이스에 뭐가 있는가?"
출력:
  directories:
    - path: "src/auth/"
      purpose: "인증 관련 모듈"       # Layer 3(LLM)에서만 생성
      files: ["middleware.ts", "token.ts", "hash.ts"]
    - path: "src/routes/"
      purpose: "API 라우트 핸들러"
      files: ["users.ts", "posts.ts"]

  entry_points:
    - file: "src/app.ts"
      type: "server"
    - file: "src/cli.ts"
      type: "cli"

  file_stats:
    total_files: 42
    by_type: { ts: 30, json: 5, sql: 3, md: 4 }

구현: glob + fs (정적, 토큰 0)
```

#### Module 2: Dependency Graph

```yaml
목적: "X를 바꾸면 Y가 영향받음" → Impact Analysis의 핵심
출력:
  modules:
    - file: "src/auth/middleware.ts"
      imports: ["src/auth/token.ts", "src/models/user.ts"]
      imported_by: ["src/routes/users.ts", "src/routes/posts.ts", "src/app.ts"]

    - file: "src/models/user.ts"
      imports: ["src/db/connection.ts"]
      imported_by: ["src/auth/middleware.ts", "src/routes/users.ts"]

  external_deps:
    - name: "express"
      used_in: ["src/app.ts", "src/routes/*.ts"]
    - name: "jsonwebtoken"
      used_in: ["src/auth/token.ts"]

구현: AST import 추출 (정적, 토큰 0)
상세: 05_dependency_graph_impl.md 참조
```

#### Module 3: Interface Extraction

```yaml
목적: 타입/함수 시그니처 → Phase 간 계약(interface contract)의 근거
출력:
  types:
    - name: "User"
      file: "src/models/user.ts"
      fields: ["id: string", "email: string", "passwordHash: string"]
      exported: true

  functions:
    - name: "verifyToken"
      file: "src/auth/token.ts"
      signature: "(token: string) => Promise<TokenPayload>"
      exported: true

  endpoints:
    - method: "POST"
      path: "/users"
      handler: "src/routes/users.ts:createUser"

구현: LSP (lsp_document_symbols) 또는 TypeScript Compiler API
```

#### Module 4: Centrality Analysis

```yaml
목적: "가장 많이 참조되는 파일 = 변경 시 가장 위험한 파일"
출력:
  high_impact:
    - file: "src/models/user.ts"
      imported_by_count: 8
      risk: "high"
    - file: "src/db/connection.ts"
      imported_by_count: 6
      risk: "high"

  isolated:
    - file: "src/utils/format.ts"
      imported_by_count: 1
      risk: "low"

Decomposer에게 주는 의미:
  high_impact 파일을 건드리는 phase → 크기 작게, 검증 강하게
  isolated 파일 → 안전하게 병렬 처리 가능

구현: Dependency Graph의 imported_by count (Module 2의 부산물, 추가 비용 0)
```

#### Module 5: Test Infrastructure

```yaml
목적: 검증 수단 파악
출력:
  framework: "jest"
  run_command: "npm test"
  build_command: "npm run build"
  lint_command: "npx eslint ."

  test_files:
    - path: "tests/routes/users.test.ts"
      covers: ["src/routes/users.ts"]
      test_count: 8

  uncovered:
    - "src/auth/middleware.ts"
    - "src/utils/format.ts"

  current_status:
    build: "pass"
    tests: "12/12 pass"
    lint: "3 warnings, 0 errors"

구현: glob + config 파싱 + 1회 실행 (build, test)
```

#### Module 6: Configuration Map

```yaml
목적: 환경변수, 설정파일, 의존성 정보
출력:
  env_vars:
    - name: "DATABASE_URL"
      used_in: ["src/db/connection.ts"]
      has_default: false

  config_files:
    - path: "tsconfig.json"
      purpose: "TypeScript 컴파일 설정"

  package_json:
    scripts: { build: "tsc", test: "jest", start: "node dist/app.js" }
    key_deps: ["express@4.18", "pg@8.11", "jsonwebtoken@9.0"]

구현: grep + json 파싱 (정적, 토큰 0)
```

---

## 구현 전략: 3-Layer Hybrid

```
Layer 1 (필수, 정적 분석): 토큰 0
  Structure     → glob + fs
  Dep Graph     → AST import 추출
  Centrality    → Graph count (Dep Graph 부산물)
  Config        → grep + json 파싱
  Test Infra    → glob + config 파싱

Layer 2 (권장, LSP): 토큰 0, 시간만
  Interface     → lsp_document_symbols
  Dep Graph 보강 → lsp_find_references

Layer 3 (선택, LLM): ~8K tokens
  Purpose 추론  → haiku 요약 (~5K tokens)
  Convention    → haiku 패턴 감지 (~3K tokens)
```

Layer 1만으로 Decomposer가 동작 가능하게 설계.
Layer 2/3은 품질 향상 옵션.

---

## Component 2: `phase_decompose` (Decomposer)

### MCP Interface

```yaml
name: phase_decompose
description: |
  사용자 요청을 순서화된 phase 목록으로 분해한다.
  코드를 직접 읽지 않는다. 구조화된 input만으로 추론한다.

input_schema:
  user_request: string
  pivot_points: PivotPoints
  codebase: CodebaseAnalysis    # codebase_analyze 출력
  maturity_mode: enum[explore, standard, strict]

output_schema:
  architecture_anchor:
    tech_stack: string[]
    directory_pattern: string
    naming_convention: string

  phases: [
    {
      id: string
      name: string
      scope: string

      impact:
        create: [{path, description}]
        modify: [{path, location_hint, change_description}]
        affected_tests: [{path, reason}]
        affected_config: [{path, change}]

      interface_contract:
        requires: [{type, name, from_phase}]
        produces: [{type, name, spec}]

      success_criteria: string[]
      estimated_complexity: enum[S, M, L]
    }
  ]

  shared_resources: [{file, touched_by, strategy}]
```

---

## Component 3: `phase_run` (Phase Runner)

### MCP Interface

```yaml
name: phase_run
description: |
  단일 phase를 실행한다.
  Impact로 지정된 파일만 context로 받는다.

input_schema:
  pivot_points: PivotPoints
  phase_decisions: PhaseDecision[]
  phase_definition: PhaseDefinition
  impact_files: [{path, content}]    # 사전에 읽어둔 영향 파일

output_schema:
  mini_plan:
    todos: [{id, description, target_files}]

  changes: [{path, action, diff_summary}]

  new_decisions: [
    {id, title, reason, affected_files, related_pp}
  ]

  discoveries: [
    {id, description, pp_conflict, recommendation}
  ]

  verification:
    criteria_results: [{criterion, pass, evidence}]
    regression_results: [{from_phase, test, pass}]

  state_summary: string
```

---

## 실제 구현 형태

```
방법 1: 스크립트 (tools/ 디렉토리)
  → Node.js 스크립트가 AST 파싱 + glob + json 파싱
  → stdout으로 structured JSON 출력
  → 토큰 비용 0, 가장 빠름

방법 2: MCP Server
  → codebase_analyze를 MCP tool로 노출
  → 에이전트가 tool call로 호출
  → 결과를 structured JSON으로 받음

방법 3: 사전 생성 파일 (.uam/mpl/codebase-analysis.json)
  → 변경 시에만 재생성 (git hook 등)
  → Decomposer는 파일만 읽으면 됨
  → deepinit(AGENTS.md)과 자연스럽게 연결 가능
```

---

## Context Budget 이점

```
현행 (탐색형):
  Decomposer context = 탐색 결과 (불확정, ~30K+ tokens)
  + 탐색 과정 자체의 tool call 히스토리

MCP식 (주입형):
  Decomposer context = CodebaseAnalysis (확정, ~3K-5K tokens)
  + user_request + PP (~1K tokens)
  + 추론 (~2K tokens)
  Total: ~6K-8K tokens (예측 가능)
```

각 Component를 독립적으로 테스트 가능:
  - codebase_analyze → mock codebase로 출력 검증
  - phase_decompose → mock input으로 phase 품질 평가 (코드 없이)
  - phase_run → mock impact_files로 실행 검증
