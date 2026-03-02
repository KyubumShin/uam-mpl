# 00. Design Decisions Log

MPL 설계 과정에서 결정된 사항을 기록한다.

---

## D-1: Phase Runner 세션 모델 → Hybrid (C)

**결정**: 기본 fresh session, 실패 시에만 같은 세션에서 retry

```
Phase N 시작 → fresh session (PD + PP + impact_files만 주입)
  → 성공 → state_summary 생성 → Phase N+1 (fresh session)
  → 실패 → 같은 세션에서 retry (max 3)
           → retry 성공 → Phase N+1 (fresh session)
           → retry 실패 → circuit breaker (re-decompose)
```

**근거**:
- Fresh session으로 SG-Loop의 "인지 위생" 이점 확보
- 실패 시에는 세션 유지가 효율적 (에러 컨텍스트 보존)
- 성공 경로에서는 context 오염 방지

**영향**:
- Phase Runner는 PD + PP + impact_files만으로 작업 가능해야 함
- State Summary의 품질이 critical (다음 fresh session의 유일한 컨텍스트)

---

## D-2: HITL 빈도 → Maturity 연동 (D)

**결정**: Maturity mode에 따라 HITL 빈도 차등 적용

| Maturity | HITL 정책 | 설명 |
|----------|----------|------|
| `explore` | 완전 자율 | 끝까지 자동, 실패 시에만 개입 |
| `standard` | Discovery 충돌 시만 | PP 충돌 없으면 자동 진행 |
| `strict` | 매 phase마다 | Phase 완료 → 사용자 확인 → 다음 |

**근거**:
- 탐색 단계에서는 속도 우선 (explore)
- 일반 개발에서는 PP가 가드레일 역할 (standard)
- 중요 작업에서는 매 단계 확인 (strict)
- 사용자가 maturity mode 선택으로 간접적으로 HITL 빈도를 제어

**영향**:
- Phase Runner에 maturity_mode별 분기 로직 필요
- standard에서 Discovery 없는 phase는 사용자 개입 0

---

## D-3: 언어 지원 → ast-grep + LSP 조합

**결정**: ast-grep으로 import 추출, LSP로 경로 해석/참조 보강

```
Layer 1: ast-grep (import 추출)
  → 언어별 AST 패턴으로 import문 추출
  → tree-sitter 기반, 17개 언어 지원
  → 별도 언어별 파서 구현 불필요

Layer 2: LSP (경로 해석 + 참조)
  → goto_definition으로 import 경로 → 실제 파일 해석
  → find_references로 역방향 그래프 보강

Fallback: regex
  → ast-grep/LSP 없는 환경에서의 대안
```

**ast-grep 패턴 예시**:
```
TypeScript: import $$$IMPORTS from '$MODULE'
Python:     from $MODULE import $$$NAMES
Go:         import "$MODULE"
Rust:       use $PATH::{$$$ITEMS}
```

**근거**:
- TS Compiler API는 TypeScript 전용, tree-sitter 직접 사용은 설치 복잡
- ast-grep은 이미 OMC 도구로 존재 (`ast_grep_search`)
- LSP도 이미 OMC 도구로 존재 (`lsp_goto_definition` 등)
- 기존 인프라만으로 다중 언어 지원 가능

**영향**:
- 05_dependency_graph_impl.md의 구현 방식이 ast-grep 기반으로 변경
- 언어별 parser 파일 대신 언어별 pattern 파일만 관리

---

## D-4: PD 수정 정책 → 명시적 Override (B)

**결정**: 이전 phase의 Phase Decision 수정 가능, 단 사유 기록 + HITL 필요

```
Phase 4에서 PD-3 (Phase 2의 결정) 수정 필요 발견:
  → PD Override 요청 생성
  → maturity_mode에 따른 처리:
       explore:  자동 승인, override 기록
       standard: HITL → 사용자 판단
       strict:   HITL → 사용자 판단 + 영향 분석 필요

  → Override 승인 시:
       PD-3 원본 보존 (히스토리)
       PD-3-override 추가 (새 결정 + 변경 사유)
       영향받는 이전 phase 파일 목록 기록
```

**PD Override 레코드 형식**:
```markdown
## PD-3-override: tasks 테이블 스키마 변경 (Phase 4에서 수정)
- 원래 결정 (Phase 2): { id: uuid, title, description, status, createdAt }
- 변경된 결정 (Phase 4): { id: uuid, title, description, status, createdAt, userId: uuid }
- 변경 사유: Phase 4(Authorization) 구현 중 Task 소유권 검사를 위해 userId 필요
- 영향받는 파일: migrations/001_create_tasks.sql, src/models/task.ts
- 승인: 사용자 HITL (standard mode)
```

**근거**:
- "절대 불가" 정책은 현실에서 과도한 제약
- 실제 개발에서 이전 결정을 바꿔야 하는 경우는 흔함
- 단, 무분별한 수정은 일관성을 깨므로 기록 + 승인 필요
- Override 히스토리가 쌓이면 PP 개선의 근거 자료가 됨

**영향**:
- Phase Runner에 PD Override 감지 + 요청 로직 필요
- PD 문서에 override 히스토리 섹션 추가
- Override가 빈번하면 → PP가 부족하다는 신호 → PP 보강 제안
