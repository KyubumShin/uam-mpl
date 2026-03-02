# 05. Dependency Graph: ast-grep + LSP 기반 구현 설계

## 목적

```
"X를 바꾸면 Y가 영향받는다"를 코드에서 자동 추출
→ Phase Decomposer의 Impact Analysis 근거
→ Centrality Analysis의 기반 데이터
```

### 구현 방식 선택 (D-3)

```
결정: ast-grep + LSP
이유:
  - ast-grep: 다중 언어 AST 패턴 매칭 (TS, Python, Go, Rust, Java...)
  - LSP: 언어별 서버가 경로 해석, 참조 검색을 정확하게 처리
  - 두 도구 모두 OMC/UAM에 이미 통합되어 있음 (추가 의존성 없음)

대안 (보존):
  A: TypeScript Compiler API — TS 전용, 경로 해석 정확하지만 단일 언어
  B: tree-sitter — 다중 언어지만 경로 해석 직접 구현 필요
  C: Regex — 의존성 0, 빠르지만 edge case 취약
```

---

## 추출 대상: Import 패턴 카탈로그

### TypeScript / JavaScript

```typescript
// 1. ES Module - Named Import
import { User, AuthToken } from './models/user';

// 2. ES Module - Default Import
import express from 'express';

// 3. ES Module - Namespace Import
import * as crypto from 'crypto';

// 4. ES Module - Side-effect Import
import './config/setup';

// 5. ES Module - Re-export
export { verifyToken } from './auth/token';
export * from './types';

// 6. CommonJS - Require
const db = require('./db/connection');

// 7. Dynamic Import
const module = await import('./plugins/' + name);

// 8. Type-only Import (TypeScript)
import type { Config } from './types';
```

### Python

```python
# 1. Absolute Import
import os
import json

# 2. From Import
from flask import Flask, request

# 3. Relative Import
from . import models
from ..utils import helper

# 4. Wildcard Import
from .types import *
```

### 우선순위

```
반드시 처리:  1, 2, 3, 5, 6 (정적, 결정적)
처리 권장:    4, 8 (side-effect, type-only)
최선 노력:    7 (동적, 런타임 결정 → 정적 분석 한계)
```

---

## ast-grep 기반 Import 추출

### ast-grep 패턴 매칭

ast-grep은 AST 패턴을 사용하여 코드 구조를 매칭한다.
메타변수(`$NAME`, `$$$ARGS`)로 유연한 패턴 정의가 가능.

#### TypeScript/JavaScript 패턴

```yaml
# 1. ES Module - Named Import
- pattern: "import { $$$IMPORTS } from '$MODULE'"
  language: typescript

# 2. ES Module - Default Import
- pattern: "import $NAME from '$MODULE'"
  language: typescript

# 3. ES Module - Namespace Import
- pattern: "import * as $NAME from '$MODULE'"
  language: typescript

# 4. Side-effect Import
- pattern: "import '$MODULE'"
  language: typescript

# 5. Re-export (named)
- pattern: "export { $$$EXPORTS } from '$MODULE'"
  language: typescript

# 5b. Re-export (wildcard)
- pattern: "export * from '$MODULE'"
  language: typescript

# 6. CommonJS Require
- pattern: "require('$MODULE')"
  language: typescript

# 7. Dynamic Import
- pattern: "import($MODULE)"
  language: typescript

# 8. Type-only Import
- pattern: "import type { $$$IMPORTS } from '$MODULE'"
  language: typescript
```

#### Python 패턴

```yaml
# 1. Absolute Import
- pattern: "import $MODULE"
  language: python

# 2. From Import
- pattern: "from $MODULE import $$$NAMES"
  language: python

# 3. Relative Import (from . / from ..)
- pattern: "from $MODULE import $$$NAMES"
  language: python
  # 상대 경로는 $MODULE 값의 '.' 접두사로 판별

# 4. Wildcard Import
- pattern: "from $MODULE import *"
  language: python
```

### ast-grep 실행 방식

```
도구 호출:
  ast_grep_search(
    pattern: "import { $$$IMPORTS } from '$MODULE'",
    language: "typescript",
    path: "src/"
  )

결과 예시:
  [
    { file: "src/auth/middleware.ts", line: 1, match: "import { verifyToken } from './auth/token'" },
    { file: "src/routes/users.ts", line: 2, match: "import { User } from '../models/user'" }
  ]

→ 각 결과에서 $MODULE 값 추출 → 의존 관계 엣지 생성
```

### ast-grep의 장점

```
1. 언어별 실제 AST 기반 → 주석/문자열 내 import 오탐 없음
2. 패턴 매칭으로 모든 import 형식 통일적 처리
3. OMC에 이미 통합 (ast_grep_search MCP tool)
4. 추가 의존성 설치 불필요
5. 멀티라인 import도 AST 레벨에서 정확히 처리
6. 다중 언어 지원: TS, Python, Go, Rust, Java, C/C++, Ruby, Kotlin, Swift
```

---

## LSP 기반 경로 해석 및 참조 검색

### 문제: ast-grep만으로는 부족한 것

```
ast-grep은 "import 문의 텍스트"를 추출한다.
하지만 실제 파일 경로로의 해석은 별도 작업:

import { User } from './models/user';
→ 실제 파일: src/models/user.ts? src/models/user/index.ts?

import { Config } from '@/config';
→ @/ 는? → tsconfig.json paths alias

import express from 'express';
→ 외부 패키지 → node_modules
```

### LSP로 해결

LSP(Language Server Protocol)가 언어별 경로 해석을 정확하게 처리:

```
1. lsp_goto_definition → import 대상의 실제 파일 경로 반환
   - tsconfig paths alias 자동 해석
   - node resolution 자동 처리
   - index.ts 자동 해석

2. lsp_find_references → 특정 심볼을 참조하는 모든 위치 반환
   - 역방향 의존성(imported_by) 정확 계산
   - re-export 체인 추적

3. lsp_document_symbols → 파일의 exported 심볼 목록
   - interface_contract의 produces 항목 자동 추출
```

### 2단계 파이프라인: ast-grep → LSP

```
Step 1: ast-grep으로 전체 import 빠르게 수집 (토큰 0, 정적)
  → 대부분의 상대 경로는 직접 해석 가능
  → bare specifier (express, lodash)는 외부 패키지로 분류

Step 2: LSP로 모호한 경로만 정확하게 해석 (토큰 0, 시간만)
  → path alias (@/, ~/...)
  → barrel files (index.ts re-export)
  → 복잡한 모듈 해석이 필요한 경우만

효율:
  - Step 1만으로 80~90% 해석 가능
  - Step 2는 나머지 10~20%에만 사용
  - 전체 토큰 비용: 0 (둘 다 정적 분석)
```

---

## 경로 해석 (Path Resolution)

### 기본 해석 (ast-grep 결과 후처리)

```
Step 1: 외부 vs 내부 판별
  - bare specifier (경로 구분자 없음) → external_dep
  - './' 또는 '../' 시작 → 내부 모듈
  - '@' 시작 → path alias 또는 scoped package

Step 2: 간단한 상대 경로 해석
  현재 파일 위치 기준으로 상대 경로 계산:
    src/auth/middleware.ts + './token' → src/auth/token
  확장자 시도: .ts, .tsx, .js, .jsx, /index.ts, /index.js

Step 3: LSP fallback (해석 실패 시)
  lsp_goto_definition으로 정확한 경로 확인
```

### Python 경로 해석

```
Step 1: 상대 vs 절대 판별
  - '.' 시작 → 상대 import (현재 패키지 기준)
  - 그 외 → 절대 import

Step 2: 절대 import 해석
  - 프로젝트 내부 모듈 vs 외부 패키지 판별
  - pyproject.toml 또는 setup.py의 packages 참조

Step 3: 파일 매핑
  - from app.models import User → app/models.py 또는 app/models/__init__.py
```

---

## 그래프 구성 알고리즘

### 자료구조

```typescript
interface DependencyNode {
  file: string;                    // "src/auth/middleware.ts"
  imports: ImportEdge[];           // 이 파일이 가져오는 것
  imported_by: string[];           // 이 파일을 가져오는 파일들 (역방향)
}

interface ImportEdge {
  target: string;                  // "src/auth/token.ts"
  specifiers: string[];            // ["verifyToken", "TokenPayload"]
  type: 'static' | 'dynamic' | 'type-only' | 'side-effect' | 're-export';
}

interface ExternalDep {
  name: string;                    // "express"
  used_in: string[];               // ["src/app.ts", "src/routes/users.ts"]
}

interface DependencyGraph {
  modules: Map<string, DependencyNode>;
  external_deps: ExternalDep[];
}
```

### 알고리즘

```
BuildDependencyGraph(root_path):
  1. ast-grep으로 모든 import 수집
     for each language in [typescript, python, ...]:
       for each pattern in import_patterns[language]:
         matches = ast_grep_search(pattern, language, root_path)
         raw_imports.push(...matches)

  2. 경로 해석
     for each import in raw_imports:
       resolved = resolve_path(import.module, import.file)
       if resolved == null:
         resolved = lsp_goto_definition(import.file, import.line, import.col)

  3. 그래프 구성
     graph = new Map()
     for each file in source_files:
       graph[file] = { imports: resolved[file], imported_by: [] }

  4. 역방향 엣지 계산
     for each (file, node) in graph:
       for each edge in node.imports:
         if edge.target in graph:
           graph[edge.target].imported_by.push(file)

  5. 외부 의존성 집계
     external = new Map()
     for each (file, node) in graph:
       for each edge in node.imports:
         if edge.target is external:
           external[edge.target].used_in.push(file)

  return { modules: graph, external_deps: external }
```

---

## Centrality 계산

Dependency Graph가 구성되면 Centrality는 부산물로 나옴:

```typescript
function computeCentrality(graph: DependencyGraph) {
  const centrality: { file: string; score: number; risk: string }[] = [];

  for (const [file, node] of graph.modules) {
    const score = node.imported_by.length;
    centrality.push({
      file,
      score,
      risk: score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low'
    });
  }

  // 점수 내림차순 정렬
  centrality.sort((a, b) => b.score - a.score);
  return centrality;
}
```

### 고급: 전이적 영향도 (Transitive Impact)

단순 `imported_by` count는 직접 의존만 반영한다. 전이적 영향도를 계산하면 더 정확:

```
src/db/connection.ts
  ← src/models/user.ts
       ← src/auth/middleware.ts
            ← src/routes/users.ts
            ← src/routes/posts.ts
       ← src/routes/users.ts

connection.ts의 직접 imported_by: 1 (user.ts만)
connection.ts의 전이적 영향: 4 (user.ts, middleware.ts, users.ts, posts.ts)
```

```typescript
function computeTransitiveImpact(
  graph: DependencyGraph,
  file: string,
  visited = new Set<string>()
): Set<string> {
  if (visited.has(file)) return visited;
  visited.add(file);

  const node = graph.modules.get(file);
  if (!node) return visited;

  for (const dependent of node.imported_by) {
    computeTransitiveImpact(graph, dependent, visited);
  }

  return visited;
}

// connection.ts → {connection.ts, user.ts, middleware.ts, users.ts, posts.ts}
```

**Decomposer에게 주는 의미**:
- 전이적 영향도가 높은 파일 = 변경 시 cascade 위험
- 이런 파일을 건드리는 phase는 **반드시 초기에 배치** (후반에 변경하면 많은 것이 깨짐)

### LSP 보강: lsp_find_references

ast-grep 기반 역방향 엣지가 부정확할 때 LSP로 보강:

```
lsp_find_references("src/models/user.ts", line=5, char=15)
→ User 타입을 참조하는 모든 파일과 위치 반환

ast-grep은 import 문만 추출하지만,
LSP는 실제 사용처(변수 할당, 함수 호출 등)까지 포함.
→ 더 정확한 imported_by 계산
```

---

## 다중 언어 지원 전략

### ast-grep 지원 언어

```
ast-grep이 네이티브 지원하는 언어:
  TypeScript, JavaScript, TSX, Python, Go, Rust, Java,
  Kotlin, Swift, C, C++, C#, Ruby, HTML, CSS

각 언어별 import 패턴만 정의하면 동일 파이프라인으로 동작.
```

### LSP 서버 매핑

```
TypeScript/JavaScript → typescript-language-server (tsserver)
Python                → pyright 또는 pylsp
Go                    → gopls
Rust                  → rust-analyzer
Java                  → jdtls
Kotlin                → kotlin-language-server

lsp_servers() 호출로 설치 상태 확인 가능.
미설치 시 ast-grep만으로 동작 (경로 해석 정확도 하락 허용).
```

### 언어별 패턴 확장 예시

```yaml
# Go
- pattern: 'import "$MODULE"'
  language: go
- pattern: 'import ($$$IMPORTS)'
  language: go

# Rust
- pattern: "use $MODULE;"
  language: rust
- pattern: "use $MODULE::{$$$ITEMS};"
  language: rust
- pattern: "mod $NAME;"
  language: rust

# Java
- pattern: "import $MODULE;"
  language: java
- pattern: "import static $MODULE;"
  language: java
```

---

## Edge Cases

### 1. 순환 의존 (Circular Dependency)

```
A → B → C → A (순환)
```

처리: 그래프에 cycle이 존재해도 구성은 가능. Centrality 계산 시 `visited` set으로 무한루프 방지.
Decomposer에게 경고로 전달: "이 파일들은 순환 의존이 있어 같은 phase에서 처리하는 것을 권장".

### 2. Barrel Files (index.ts re-export)

```typescript
// src/models/index.ts
export { User } from './user';
export { Post } from './post';
export { Comment } from './comment';
```

처리: ast-grep으로 re-export 패턴 매칭 → LSP의 lsp_goto_definition으로 실제 소스 추적.
index.ts의 centrality는 높지만, 실제 변경 대상은 개별 파일.

### 3. Dynamic Import (런타임 경로)

```typescript
const plugin = await import(`./plugins/${pluginName}`);
```

처리: 정적 분석 불가. `plugins/` 디렉토리 전체를 잠재적 대상으로 표시.
```json
{
  "target": "src/plugins/*",
  "type": "dynamic",
  "note": "런타임 결정 - 정적 분석 한계"
}
```

### 4. Monorepo / Workspace

```
packages/
  core/src/...
  api/src/...      ← import from '@myapp/core'
  web/src/...      ← import from '@myapp/core'
```

처리: workspace 설정(package.json workspaces, lerna.json 등)을 읽어 패키지 간 의존도 해석.
LSP가 workspace-aware이므로 lsp_goto_definition으로 크로스 패키지 참조도 정확히 해석.

### 5. Conditional Import

```typescript
let adapter;
if (process.env.DB === 'postgres') {
  adapter = require('./adapters/postgres');
} else {
  adapter = require('./adapters/sqlite');
}
```

처리: ast-grep이 require 패턴 모두 매칭 → 두 경로 모두 의존으로 기록. type을 'conditional'로 표시.

---

## 출력 형식

### JSON 출력 예시

```json
{
  "modules": [
    {
      "file": "src/auth/middleware.ts",
      "imports": [
        {
          "target": "src/auth/token.ts",
          "specifiers": ["verifyToken"],
          "type": "static"
        },
        {
          "target": "src/models/user.ts",
          "specifiers": ["User"],
          "type": "type-only"
        }
      ],
      "imported_by": [
        "src/routes/users.ts",
        "src/routes/posts.ts",
        "src/app.ts"
      ]
    }
  ],
  "external_deps": [
    {
      "name": "express",
      "version": "4.18.2",
      "used_in": ["src/app.ts", "src/routes/users.ts", "src/routes/posts.ts"]
    },
    {
      "name": "jsonwebtoken",
      "version": "9.0.0",
      "used_in": ["src/auth/token.ts"]
    }
  ],
  "centrality": [
    { "file": "src/models/user.ts", "direct": 4, "transitive": 7, "risk": "high" },
    { "file": "src/db/connection.ts", "direct": 2, "transitive": 7, "risk": "high" },
    { "file": "src/auth/token.ts", "direct": 2, "transitive": 5, "risk": "medium" },
    { "file": "src/utils/format.ts", "direct": 1, "transitive": 1, "risk": "low" }
  ]
}
```

---

## 프로토타입 구현 계획

### 구현 구조

```
tools/
  dep-graph/
    index.ts          # 진입점, 파이프라인 오케스트레이션
    ast-extractor.ts  # ast-grep 기반 import 추출
    lsp-resolver.ts   # LSP 기반 경로 해석 (fallback)
    path-resolver.ts  # 기본 경로 해석 (정적)
    graph.ts          # 그래프 구성 + centrality 계산
    output.ts         # JSON 출력 포맷팅

    patterns/
      typescript.yaml  # TS/JS import 패턴 정의
      python.yaml      # Python import 패턴 정의
      go.yaml          # Go import 패턴 정의 (확장용)
      rust.yaml        # Rust import 패턴 정의 (확장용)

사용법:
  npx ts-node tools/dep-graph/index.ts ./src --format json
  → stdout으로 DependencyGraph JSON 출력
```

### 실행 파이프라인

```
1. 언어 감지
   → tsconfig.json 존재 → TypeScript
   → pyproject.toml 존재 → Python
   → go.mod 존재 → Go
   → 복수 언어 → 각각 처리 후 병합

2. ast-grep import 수집 (병렬)
   → 언어별 패턴 파일 로드
   → ast_grep_search 병렬 호출
   → raw import 목록 생성

3. 경로 해석
   → 80~90%: 정적 해석 (path-resolver.ts)
   → 10~20%: LSP fallback (lsp-resolver.ts)

4. 그래프 구성 + centrality
   → 순방향/역방향 엣지
   → 직접/전이적 centrality

5. 출력
   → JSON (기본) 또는 YAML
```

### 실행 성능 목표

```
소규모 (50 파일):   < 1초   (ast-grep만으로 충분)
중규모 (200 파일):  < 3초   (LSP fallback 일부)
대규모 (1000 파일): < 10초  (LSP 병렬 호출)

ast-grep은 Rust 기반이라 대규모에서도 빠름.
LSP 호출이 병목 → 필요한 경우에만 사용.
```

---

## Decomposer에게 전달되는 최종 형태

Dependency Graph + Centrality가 합쳐져서 Decomposer에게는 이렇게 전달됨:

```yaml
# codebase_analyze 출력 중 dependencies + centrality 부분

dependencies:
  high_impact_modules:       # centrality high인 것만 요약
    - file: "src/models/user.ts"
      imported_by: ["middleware.ts", "users.ts", "posts.ts", "admin.ts"]
      transitive_impact: 7
      warning: "변경 시 7개 파일에 cascade 영향"

    - file: "src/db/connection.ts"
      imported_by: ["user.ts", "post.ts"]
      transitive_impact: 7
      warning: "DB 계층 변경은 전체 모델에 영향"

  circular_deps:             # 있으면 경고
    - cycle: ["src/auth/session.ts", "src/auth/middleware.ts"]
      recommendation: "같은 phase에서 처리 권장"

  module_clusters:           # 밀접하게 연결된 파일 그룹
    - name: "auth"
      files: ["src/auth/middleware.ts", "src/auth/token.ts", "src/auth/hash.ts"]
      internal_edges: 4
      external_edges: 3
    - name: "routes"
      files: ["src/routes/users.ts", "src/routes/posts.ts"]
      internal_edges: 1
      external_edges: 5
```

**module_clusters**는 Decomposer에게 "이 파일들은 하나의 phase로 묶는 것이 자연스럽다"는 힌트를 준다.
밀접하게 연결된 파일을 다른 phase로 쪼개면 phase 간 충돌 가능성이 높아지기 때문.

---

## 대안 구현 (보존)

D-3에서 ast-grep + LSP를 선택했지만, 특수 상황을 위해 대안을 기록한다.

### 대안 A: TypeScript Compiler API (TS 전용)

```
장점: 경로 해석이 가장 정확 (tsconfig paths, node resolution 자동)
단점: TypeScript 전용, ts.createProgram이 무거움, node_modules 필요
적합: 대형 TypeScript 프로젝트에서 ast-grep 경로 해석이 부족할 때
```

### 대안 B: tree-sitter (다중 언어)

```
장점: 빠른 incremental parsing, 다중 언어
단점: 경로 해석 직접 구현 필요, 타입 정보 없음
적합: LSP 서버가 없는 환경에서 다중 언어 지원이 필요할 때
```

### 대안 C: Regex (경량)

```
장점: 의존성 0, 설치 불필요, 매우 빠름
단점: 멀티라인/주석 오탐, specifier 추출 어려움
적합: 빠른 프로토타이핑, 정확도보다 속도가 우선일 때
```
