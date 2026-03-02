# 09. Phase Decisions 누적 관리

## 문제

Phase가 진행될수록 PD가 누적된다. Phase 10이면 PD가 20~50개가 될 수 있다.
PD는 다음 phase의 context로 주입되므로 **크기 관리**가 필수.

```
Phase 1:  PD 2개   → ~400 tokens
Phase 5:  PD 12개  → ~2,400 tokens
Phase 10: PD 25개  → ~5,000 tokens
Phase 20: PD 50개  → ~10,000 tokens  ← context 예산 초과 위험
```

---

## 전략: 3-Tier PD 관리

### Tier 1: Active PD (항상 전체 포함)

현재 phase에 **직접 관련된** PD. 전체 내용을 포함.

```markdown
## PD-6: JWT RS256 with 1h expiry (Phase 3)
- 결정: JWT RS256, 만료 1시간
- 이유: 보안 + 합리적 만료
- 파일: src/auth/token.ts
- 인터페이스: sign(payload) → token, verify(token) → payload
```

**선택 기준**: 현재 phase의 `requires`에 명시된 PD + 현재 phase의 `impact.modify` 파일과 관련된 PD.

### Tier 2: Summary PD (요약만 포함)

현재 phase에 간접 관련된 PD. 1줄 요약으로 축소.

```markdown
- PD-1: Express 4.18 + TypeScript 5.x (Phase 1)
- PD-2: PostgreSQL with pg (Phase 1)
- PD-4: status enum: ['todo', 'in_progress', 'done'] (Phase 2)
```

### Tier 3: Archived PD (파일에만 존재)

현재 phase와 무관한 PD. Context에 포함하지 않음.
`.uam/mpl/phase-decisions.md` 파일에만 보존.

---

## PD 분류 알고리즘

```
For each PD in all_phase_decisions:

  if PD.affected_files ∩ current_phase.impact.{create,modify} ≠ ∅:
    → Tier 1 (Active)

  elif PD.from_phase in current_phase.interface_contract.requires[].from_phase:
    → Tier 1 (Active)

  elif PD.type in ['DB Schema', 'API Contract', 'Architecture']:
    → Tier 2 (Summary) — 구조적 결정은 항상 요약으로 유지

  else:
    → Tier 3 (Archived)
```

### 예시: Phase 4 실행 시

```
전체 PD: PD-1 ~ PD-7

Phase 4의 impact.modify: [src/models/task.ts, src/routes/tasks.ts, src/app.ts]
Phase 4의 requires: [phase-2(Task model), phase-3(authMiddleware)]

분류:
  Tier 1 (Active):
    PD-3: Task 스키마 (task.ts 관련)
    PD-3-override: userId 추가 (task.ts 관련)
    PD-5: authMiddleware 인터페이스 (phase-3 requires)

  Tier 2 (Summary):
    PD-1: Express + TypeScript (아키텍처)
    PD-2: PostgreSQL (DB 아키텍처)
    PD-6: JWT RS256 (인증 아키텍처)

  Tier 3 (Archived):
    PD-4: status enum (Phase 4 작업과 무관)
    PD-7: argon2 해싱 (Phase 4 작업과 무관)
```

### Context에 주입되는 형태

```markdown
## Phase Decisions

### Active (상세)
#### PD-3: Task 스키마 (Phase 2)
- 원래: { id, title, description, status, createdAt }
- Override (Phase 4): { id, title, description, status, **userId**, createdAt }
- 파일: src/models/task.ts, migrations/001, 003
- 인터페이스: Task { id: string, title: string, ... }

#### PD-5: authMiddleware (Phase 3)
- req.userId: string 설정
- 파일: src/auth/middleware.ts
- 사용법: router.use(authMiddleware)

### Summary (1줄)
- PD-1: Express 4.18 + TypeScript 5.x
- PD-2: PostgreSQL with pg pool
- PD-6: JWT RS256, 1h expiry, sign/verify in src/auth/token.ts

### Archived: PD-4, PD-7 (상세는 .uam/mpl/phase-decisions.md 참조)
```

---

## Token 예산 추정

```
Tier 1: ~200 tokens × 2~4개 = 400~800 tokens
Tier 2: ~30 tokens × 3~8개  = 90~240 tokens
Tier 3: 0 tokens

총 PD context: ~500~1,000 tokens (phase 수와 무관하게 안정)
```

Phase 20이라도 Active PD는 3~5개, Summary는 5~10개로 제한되므로
**PD context가 phase 수에 비례하여 증가하지 않는다**.

---

## PD Override 히스토리 관리

Override가 많아지면 PD 자체가 복잡해진다:

```
PD-3 (Phase 2) → PD-3-override-1 (Phase 4) → PD-3-override-2 (Phase 7)
```

### 전략: Latest Only

Active PD에는 **최신 버전만** 포함. Override 히스토리는 파일에만 보존.

```markdown
# Context에 주입되는 형태
#### PD-3: Task 스키마 (Phase 2, overridden Phase 4, Phase 7)
- 현재: { id, title, description, status, userId, priority, createdAt }
- 변경 이력: 2회 override (상세: phase-decisions.md)
```

---

## PD Compaction (대규모 프로젝트용)

Phase 15+ 이후 PD가 30개 이상이면 compaction 실행:

```
Compaction 조건:
  총 PD 수 > 30
  또는 Tier 2가 15개 이상

Compaction 방법:
  1. 같은 도메인의 PD를 하나로 합침
     PD-1(Express), PD-2(PostgreSQL), PD-6(Jest)
     → PD-compact-infra: "Express 4.18 + TypeScript, PostgreSQL with pg, Jest"

  2. Override 체인을 최신 버전으로 평탄화
     PD-3 → override-1 → override-2
     → PD-3-final: 최신 스키마만

  3. Archived PD 중 어떤 phase의 requires에도 없는 것 삭제
     (파일에는 보존, 분류 목록에서만 제거)
```

---

## phase-decisions.md 파일 형식

전체 PD를 보존하는 마스터 파일:

```markdown
# Phase Decisions

## Active Decisions

### PD-3: Task 스키마
- Phase: 2 (created), 4 (override-1)
- Current: { id: uuid, title: string, description: text, status: enum, userId: uuid, createdAt: timestamp }
- History:
  - v1 (Phase 2): { id, title, description, status, createdAt }
  - v2 (Phase 4): + userId 추가 (소유권 검사용)
- Files: src/models/task.ts, migrations/001, 003
- Related PP: none

### PD-5: authMiddleware
- Phase: 3
- Current: (req, res, next) → req.userId 설정, 401 on invalid
- Files: src/auth/middleware.ts
- Related PP: PP-1 (REST Only — 미들웨어는 REST 범위 내)

## Summary Decisions

| ID | 결정 | Phase | 파일 |
|----|------|-------|------|
| PD-1 | Express 4.18 + TypeScript 5.x | 1 | src/app.ts |
| PD-2 | PostgreSQL with pg | 1 | src/db.ts |
| PD-4 | status: todo/in_progress/done | 2 | src/models/task.ts |
| PD-6 | JWT RS256, 1h expiry | 3 | src/auth/token.ts |
| PD-7 | argon2 password hashing | 3 | src/models/user.ts |

## Archived Decisions
(이전 phase에서 생성되었으나 현재 작업과 무관한 결정)

| ID | 결정 | Phase | 이유 |
|----|------|-------|------|
| — | 현재 없음 | — | — |
```

---

## 요약

```
문제: PD가 phase마다 누적 → context 무한 증가 위험
해결: 3-Tier 분류 (Active/Summary/Archived)

핵심:
  - Active PD만 상세 포함 (현재 phase와 직접 관련된 것만)
  - Summary PD는 1줄 요약
  - Archived PD는 context에서 제외
  - Phase 수와 무관하게 PD context ~500~1,000 tokens 유지
  - Override는 최신 버전만 Active, 히스토리는 파일에 보존
  - 30개 이상이면 Compaction 실행
```
