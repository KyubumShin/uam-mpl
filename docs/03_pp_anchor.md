# 03. PP-Anchored Consistency Mechanism

## 개요

Micro-Phase Loop에서 각 phase가 독립적으로 계획되면 **아키텍처 일관성**이 깨질 수 있다.
이 문제를 UAM의 Pivot Points(PP) 메커니즘을 차용하여 해결한다.

---

## 2-Layer Anchor Model

### Layer 1: Pivot Points (불변 제약)

> "절대 변하지 않는 것" — 사용자가 정의

```markdown
# Pivot Points

## PP-1: REST API Only [CONFIRMED]
- 원칙: 모든 외부 인터페이스는 REST API로 제공
- 판정 기준: GraphQL, gRPC, WebSocket 엔드포인트 생성 시 위반
- 우선순위: 1 (최고)
- 위반 예시: GraphQL schema 파일 생성
- 허용 예시: REST endpoint에 WebSocket 알림 추가 (보조 수단)

## PP-2: 외부 의존성 최소화 [PROVISIONAL]
- 원칙: 외부 패키지는 핵심 기능에만 사용
- 판정 기준: [미정 — Phase 1에서 기준 구체화 예정]
- 우선순위: 2
- 상태: PROVISIONAL (Phase 2까지 CONFIRMED 전환 필요)

## Priority Order
PP-1 > PP-2
(충돌 시 상위 PP 우선)
```

**특성:**
- 사용자 인터뷰로 정의 (UAM `uam-pivot` 4-Round 인터뷰 차용)
- 모든 phase에 동일하게 주입
- Phase가 변경 불가 (Discovery 충돌 시 HITL로 판단)
- CONFIRMED/PROVISIONAL 2단계 상태

### Layer 2: Phase Decisions (누적 결정)

> "이미 결정/구현된 것" — 시스템이 자동 누적

```markdown
# Phase Decisions

## PD-1: Express 4.18 + TypeScript 5.x (Phase 1)
- 결정: Express 4.18 + TypeScript 5.x 기반
- 이유: PP-2(최소 의존성)와 균형, 가장 가벼운 풀스택 프레임워크
- 파일: src/app.ts, tsconfig.json

## PD-2: PostgreSQL with pg (Phase 1)
- 결정: PostgreSQL + pg 드라이버 사용
- 이유: 관계형 데이터(task-user), 타입 지원
- 파일: src/db.ts
- 관련 PP: PP-2 (외부 의존성) — 핵심 기능이므로 허용

## PD-3: Task 스키마 (Phase 2)
- 결정: tasks 테이블 스키마 정의
- 스키마: { id: uuid, title: string, description: text, status: enum, createdAt: timestamp }
- 파일: migrations/001_create_tasks.sql, src/models/task.ts
- 인터페이스: Task { id, title, description, status, createdAt }
```

**특성:**
- Phase 완료 시 자동 생성 (Phase Runner의 Summarize 단계)
- 이후 phase는 참조 기반 (원칙적 불변, 단 명시적 Override 프로토콜로 변경 가능 — D-4 참조)
- 축적되지만 **구조화되어 있어** 전체 히스토리보다 훨씬 작음

---

## PP vs PD 비교

| 차원 | PP (Pivot Points) | PD (Phase Decisions) |
|------|-------------------|---------------------|
| 정의 주체 | 사용자 (인터뷰) | 시스템 (자동) |
| 변경 가능 | 불가 (CONFIRMED) / HITL (PROVISIONAL) | 원칙적 불변, Override 프로토콜로 변경 가능 (D-4) |
| 수준 | 원칙/제약 | 구현 결정/인터페이스 |
| 생성 시점 | Phase 0 (사전) | 각 Phase 완료 시 |
| 역할 | "이것은 하지 마라" | "이것은 이미 이렇게 했다" |
| 크기 | 작음 (2~5개 원칙) | 누적 (phase당 2~5개 결정) |

---

## Phase별 Context 구성

```
Phase N의 Context:
┌──────────────────────────────┐
│ PP (불변)                    │ ~500 tokens (고정)
│ PP-1: REST API Only          │
│ PP-2: 외부 의존성 최소화      │
├──────────────────────────────┤
│ PD (누적)                    │ ~200 tokens × 완료된 phase 수
│ PD-1: Express + TS           │
│ PD-2: PostgreSQL             │
│ PD-3: Task 스키마            │
├──────────────────────────────┤
│ Phase N Definition           │ ~300 tokens
│ scope, success_criteria      │
├──────────────────────────────┤
│ Codebase Current State       │ ~500 tokens
│ file_tree, recent_changes    │
└──────────────────────────────┘
Total: ~1500 + (200 × N) tokens
```

Phase 10이라도 Context는 ~3500 tokens. 현행 시스템의 context 누적(~150K)과 비교하면 극적 차이.

---

## Discovery 처리 흐름

UAM의 Discovery 메커니즘을 MPL에 적용:

```
Worker가 Phase N 실행 중 Discovery 제안
    │
    ├── PP 충돌 검사
    │     ├── CONFIRMED PP 충돌 → 자동 반려
    │     ├── PROVISIONAL PP 충돌 → HITL 판단
    │     │     ├── 반려 → Discovery 무시
    │     │     ├── 수용 → PP 해제, Discovery 반영
    │     │     └── 보류 → 다음 phase 백로그
    │     └── 충돌 없음 ↓
    │
    ├── PD 충돌 검사
    │     ├── 기존 PD와 충돌 → PD Override 요청 (D-4 프로토콜)
    │     │     ├── Override 승인 → PD-override 레코드 생성, 변경 적용
    │     │     └── Override 거부 → 현재 PD 유지, 대안 탐색
    │     └── 충돌 없음 ↓
    │
    └── Maturity Mode에 따라 처리
          ├── explore: 즉시 mini-plan에 반영
          ├── standard: Phase 완료 시 일괄 검토
          └── strict: 다음 phase 백로그로 이관
```

### MPL에서 Discovery가 더 효과적인 이유

```
UAM (현행):
  Phase 2 후반에 Discovery 발생
  → 이미 많은 코드가 작성된 상태
  → 충돌 해소 비용: 높음

MPL:
  Phase N(작은 단위)에서 Discovery 발생
  → 영향 범위가 작음 (해당 phase의 3~5 TODO만)
  → 충돌 해소 비용: 낮음
  → Phase N+1 계획에 자연스럽게 반영
```

---

## PROVISIONAL PP의 자연 진화

현행 UAM에서는 PROVISIONAL PP가 Phase 3 진입 전까지 CONFIRMED로 전환되어야 한다.
MPL에서는 이것이 phase를 거치며 **점진적으로** 정밀해진다:

### 진화 시나리오

```
Phase 0: PP Interview
  PP-2: 외부 의존성 최소화 [PROVISIONAL]
  판정 기준: [미정]

Phase 1: Foundation
  Discovery: "argon2 필요"
  → PP-2 충돌? → PROVISIONAL이므로 HITL
  → 사용자: "보안 라이브러리는 허용"
  → PP-2 판정 기준 업데이트: "보안 외 유틸리티 라이브러리 금지"

Phase 2: Core API
  Discovery: "lodash 도입하면 편리"
  → PP-2 충돌? → 판정 기준 적용 → "보안 외 유틸리티" → 자동 반려

Phase 3: Auth Middleware
  Discovery: "Redis 세션 스토어 도입"
  → PP-2 충돌? → "보안 외..." → 인프라는? → HITL
  → 사용자: "인프라 의존성도 허용"
  → PP-2 판정 기준 업데이트: "순수 유틸리티 라이브러리만 금지"
  → PP-2 상태: PROVISIONAL → CONFIRMED (충분히 구체화됨)
```

**핵심 인사이트**: Phase를 거듭할수록 PP의 판정 기준이 실제 사례를 통해 구체화된다.
이것은 "한번에 전체 실행"하는 현행 모델에서는 얻기 어려운 이점이다.

---

## State Summary 스키마

각 Phase 완료 시 생성되는 State Summary:

```markdown
## Phase {N} State Summary

### 구현된 것
- {파일 경로}: {1줄 설명}
- {파일 경로}: {1줄 설명}

### 생성된 인터페이스
- {타입명} { 필드 목록 }
- {함수명}(파라미터): 반환값

### Phase Decisions (이번 phase)
- PD-{K}: {결정 제목} — {1줄 요약}
- PD-{K+1}: {결정 제목} — {1줄 요약}

### Discovery 처리 결과
- D-{N}: {Discovery 내용} → {반영/반려/보류} (사유: {})

### 검증 결과
- {success_criteria_1}: PASS/FAIL
- {success_criteria_2}: PASS/FAIL
- 회귀 테스트: {X}/{Y} 통과

### 다음 phase를 위한 참고
- {환경변수, 설정 파일, 외부 의존성 등 후속 phase가 알아야 할 정보}
```

---

## Architecture Anchor와의 관계

Phase Decomposer가 초기에 생성하는 `architecture_anchor`는 PP/PD와 별도로 존재:

```
architecture_anchor (Decomposer 생성, 변경 가능):
  - tech_stack, directory_structure, naming_convention
  - Phase 진행 중 업데이트 가능 (PD에 변경 기록)

PP (사용자 정의, 불변):
  - 원칙 수준의 제약

PD (자동 누적, 원칙적 불변 + Override 가능):
  - 구현 수준의 결정
  - 명시적 Override 프로토콜(D-4)로 변경 가능
```

Architecture Anchor는 **"어떤 스타일로 구현할 것인가"**,
PP는 **"절대 하지 말아야 할 것"**,
PD는 **"이미 이렇게 결정된 것"**으로 역할이 구분된다.

---

## 요약

PP를 Micro-Phase Loop의 일관성 메커니즘으로 차용하면:

1. **검증된 메커니즘 재사용**: 인터뷰, 충돌 검사, maturity mode 그대로 사용
2. **제약 기반 일관성**: 구현 상세가 아닌 원칙 수준에서 phase 간 일관성 보장
3. **저비용 Discovery 처리**: 작은 phase에서 발생하므로 충돌 해소 비용 낮음
4. **PP 자연 진화**: PROVISIONAL이 실제 사례를 통해 점진적으로 CONFIRMED로
5. **2-Layer 분리**: 불변 제약(PP) + 누적 결정(PD)으로 깔끔한 구조
