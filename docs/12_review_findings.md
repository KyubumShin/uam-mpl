# 12. Design Review Findings

## 리뷰 개요

전체 13개 문서에 대한 종합 리뷰 결과. 2026-03-02 실시.

---

## A. 문서 간 모순 (해결 완료)

### 모순-1: 파일 경로 불일치 [CRITICAL → RESOLVED]

- **문제**: 02, 04에서 `.mpl/` 경로 사용. 나머지 문서는 `.uam/mpl/` 사용.
- **해결**: `.uam/mpl/`로 통일. 02, 04 수정.

### 모순-2: PD 변경 정책 모순 [HIGH → RESOLVED]

- **문제**: 03에서 "PD 수정 불가"라고 명시. 00(D-4), 07, 08, 09는 PD Override 허용.
- **해결**: 03의 PD 성격을 "원칙적 불변, Override 프로토콜로 변경 가능"으로 재정의.

### 모순-3: Dependency Graph 구현 방식 불일치 [HIGH → RESOLVED]

- **문제**: D-3 결정은 ast-grep + LSP. 05는 TS Compiler API + tree-sitter 권장.
- **해결**: 05를 ast-grep + LSP 기반으로 재작성. 기존 방식은 대안으로 보존.

### 모순-4: PD 번호 체계 불일치 [MEDIUM → RESOLVED]

- **문제**: 07의 예시와 08 워크스루에서 PD 번호가 불일치.
- **해결**: 08 워크스루 기준으로 통일 (PD-1~PD-7). 07의 예시를 정합.

---

## B. 누락 사항 (구현 전 해결 필요)

### 누락-1: Orchestrator 설계 [CRITICAL → TODO]

Decomposer와 Phase Runner를 연결하는 중추 컴포넌트가 없음.

필요한 정의:
- Phase Runner를 순차 실행하는 상태 머신
- Phase 간 state summary 전달 관리
- impact_files 로딩 (phase.impact 기반)
- Circuit breaker 후 재분해 트리거
- 전체 진행 상태 추적 및 보고

→ `13_orchestrator_design.md`로 해결 예정

### 누락-2: Phase 간 병렬 실행 [HIGH → DEFERRED]

dependencies 필드가 있지만 병렬 실행 전략이 없음.

현재 결정: v1에서는 순차 실행만 지원.
dependencies 필드는 "선행 조건 검증용"으로 역할 한정.
병렬 실행은 v2에서 검토.

### 누락-3: Brownfield 워크스루 [HIGH → TODO]

기존 프로젝트 시나리오가 검증되지 않음.

필요한 정의:
- 기존 코드의 암묵적 결정을 PD로 부트스트래핑하는 메커니즘
- 대규모 codebase_analyze 출력 처리
- 기존 테스트의 inherited_criteria 초기 등록

→ 별도 워크스루 문서로 해결 예정

### 누락-4: State Summary 품질 보장 [MEDIUM → TODO]

State Summary가 다음 phase의 유일한 컨텍스트인데 품질 검증 없음.

제안된 해결 방향:
- 필수 섹션 존재 여부 구조적 검증
- interface_contract.produces 이행 여부 체크
- 누락 감지 시 Phase Runner에게 보충 요청

### 누락-5: impact_files 범위 외 접근 프로토콜 [MEDIUM → TODO]

Phase Runner가 impact 범위 밖 파일에 접근해야 할 때의 절차 미정의.

제안된 해결 방향:
- Discovery 생성 → Orchestrator에게 범위 확장 요청
- Orchestrator가 추가 파일 로딩 → Phase Runner에 보충 주입
- 범위 확장이 빈번하면 → Decomposer의 impact 예측 품질 개선 신호

---

## C. 구현 가능성 문제 (설계 보강 필요)

### 구현-1: success_criteria 검증 [CRITICAL → TODO]

문제: "POST /auth/register → 201" 같은 자연어 criteria를 기계가 검증하려면
서버 기동, DB 연결, 환경변수 설정 등 인프라가 필요.

제안된 해결 방향:
- success_criteria를 실행 가능한 명령어 스키마로 변경
  ```yaml
  success_criteria:
    - type: "command"
      run: "npx tsc --noEmit"
      expect_exit: 0
    - type: "test"
      run: "npm test -- --grep auth"
      expect_exit: 0
    - type: "description"  # 기계 검증 불가, Phase Runner가 테스트 작성
      text: "인증 없이 GET /tasks → 401"
  ```
- type=description인 criteria는 Phase Runner가 테스트 코드로 변환 후 실행

### 구현-2: Fresh Session 구현 방법 [HIGH → TODO]

문제: Claude Code에서 "세션 리셋"이 명시적으로 지원되지 않음.

제안된 해결 방향:
- 각 Phase Runner를 별도 Task agent로 생성
- PD + PP + impact_files를 agent prompt로 주입
- Agent 완료 후 output만 Orchestrator에 반환 (세션 자동 종료)
- 이 방식이면 자연스럽게 "fresh session" 구현됨

### 구현-3: 회귀 테스트 비용 [HIGH → TODO]

문제: Phase N에서 1~(N-1)의 모든 criteria 재실행 → 비선형 증가.

제안된 해결 방향:
- `npm test`로 전체 테스트를 한 번에 실행 (토큰 비용 = 1회 Bash)
- inherited_criteria는 "영향 기반 선택적 검사"로 최적화
  - 이번 phase에서 수정한 파일에 관련된 테스트만 선택
  - 전수 검사는 마지막 phase에서만

### 구현-4: 토큰 비용 추정 보정 [MEDIUM → TODO]

문제: Worker 위임 overhead, 비정상 경로 비용 누락.

제안된 해결 방향:
- 비용 추정에 worst-case 시나리오 추가
- Worker overhead: ~2K tokens/TODO (시스템 프롬프트 + context)
- Retry: ~30% 추가 (3회 중 1회 retry 발생 가정)
- 보정된 추정: MPL ~95K → ~120K (worst), Standard ~115K → ~140K (worst)

---

## D. 보존할 강점

1. **PP 점진적 구체화**: PROVISIONAL → CONFIRMED 자연 진화
2. **3-Tier PD 관리**: Phase 수와 무관한 context 안정화
3. **MCP-Style 인터페이스**: 탐색=도구, 추론=에이전트 분리
4. **PP + PD 2-Layer**: "하지 마라" + "이미 했다" 구분
5. **평가 프레임워크**: 5차원 메트릭 + 손익분기점
6. **Decision Log**: 설계 결정의 추적 가능성

---

## E. 우선순위별 액션 아이템

### P0 (구현 전 필수)
- [x] 모순-1: 경로 통일 (.uam/mpl/) — 02, 04 수정 완료
- [x] 모순-2: PD Override 정책 반영 — 03 수정 완료 (4곳)
- [x] 모순-3: 05번 ast-grep + LSP 기반 전면 재작성 완료
- [x] 모순-4: PD 번호 통일 — 07 수정 완료 (PD-2 → PD-3, target_pd 포함)
- [x] 누락-1: Orchestrator 설계 문서 — 13_orchestrator_design.md 작성 완료
- [x] 구현-1: success_criteria 스키마 구체화 — 13번 문서에 5-type 스키마 정의

### P1 (구현 초기 해결)
- [x] 구현-2: Fresh session 구현 방법 확정 — 13번 문서에 Task agent 방식 정의
- [x] 누락-3: Brownfield 워크스루 — 14_brownfield_walkthrough.md 작성 완료
- [x] 구현-3: 회귀 테스트 최적화 — 13번 문서에 영향 기반 선택적 검사 정의

### P2 (구현 중 해결 가능)
- [ ] 누락-2: Phase 병렬 실행 (v2로 defer)
- [x] 누락-4: State Summary 품질 검증 — 13번 문서에 필수 섹션 + produces 이행 검사 정의
- [x] 누락-5: impact 범위 외 접근 프로토콜 — 13번 문서에 Discovery 기반 프로토콜 정의
- [ ] 구현-4: 토큰 비용 보정

---

## F. 2차 리뷰 결과 (2026-03-02)

13, 14번 문서 추가 후 전체 15개 문서 종합 리뷰. 23개 이슈 발견.

### CRITICAL (2건 → 모두 해결)

| ID | 이슈 | 해결 |
|----|------|------|
| R2-C1 | decomposition.json vs .yaml 불일치 (08, 11) | 08, 11에서 `.yaml`로 통일 |
| R2-C2 | PD-2-override → PD-3-override 불일치 (07) | 07에서 모든 PD-2 참조를 PD-3으로 수정 |

### HIGH (7건 → 모두 해결)

| ID | 이슈 | 해결 |
|----|------|------|
| R2-H1 | pivot-points.md 경로 (02) `.uam/mpl/` → `.uam/` | 02 수정 (공유 경로) |
| R2-H2 | 상태 머신 retry 책임 불명확 (13) | PHASE_FAILED 제거, Phase Runner 내부 처리 명시 |
| R2-H3 | Circuit Breaker 무한 루프 (13) | max_redecompose=2 + FAILED 터미널 상태 추가 |
| R2-H4 | summaries/ 경로 불일치 (13) | `phases/phase-{N}/state-summary.md`로 통일 (11번 기준) |
| R2-H5 | discoveries.md 경로 (13) | `.uam/discoveries.md` (공유 경로) |
| R2-H6 | progress.json vs state.json (13) | `state.json`으로 통일 (11번 기준) |
| R2-H7 | maturity_mode → phase 크기 규칙 부재 (06) | 구체적 테이블 + 규칙 추가 |

### MEDIUM (9건)

| ID | 이슈 | 상태 |
|----|------|------|
| R2-M1 | 13번 파일 시스템 구조도 불일치 | ✅ 구조도 전면 재작성 |
| R2-M2 | 13번 pseudo-code에 redecompose 가드 없음 | ✅ MAX_REDECOMPOSE + FAILED 분기 추가 |
| R2-M3 | 03 line 40 "Phase가 변경 불가" 모호함 | PP 지칭이므로 문맥상 정확, 보류 |
| R2-M4~M9 | 경미한 용어/형식 불일치 | 향후 구현 시 자연스럽게 해결 |

### LOW (5건) — 향후 구현 시 자연스럽게 해결

---

## G. 3차 리뷰 결과 (2026-03-02, 최종 검증)

전체 15개 문서 최종 검증. 10개 이슈 발견, CRITICAL 0건.

### HIGH (3건 → 모두 해결)

| ID | 이슈 | 해결 |
|----|------|------|
| R3-H1 | PD 번호 체계 불일치 (03 vs 08/09) | 03의 PD 예시를 08 워크스루 기준으로 정렬 (PD-1=Express, PD-2=PostgreSQL, PD-3=Task 스키마) |
| R3-H2 | PD-2-override 잔존 (00, 08) | 00의 D-4 예시를 PD-3-override(tasks 스키마)로 변경, 08:378 PD-2→PD-3 수정, 09:24 PD-8→PD-6 수정 |
| R3-H3 | 13 Step 2 unreachable "failed" 분기 | "failed" 분기 제거, "complete"/"circuit_break"만 수신하도록 명시 |

### MEDIUM (4건 → 2건 해결, 2건 보류)

| ID | 이슈 | 상태 |
|----|------|------|
| R3-M1 | 02 Circuit Breaker에 max_redecompose 누락 | ✅ max_redecompose=2 + FAILED 종료 추가 |
| R3-M2 | 06 Rule 2 "3-7 TODOs" vs explore "1-3 TODOs" 충돌 | ✅ "1-7 TODOs depending on maturity mode"로 수정 |
| R3-M3 | 03 예시 시나리오와 08 워크스루 phase 순서 미스매치 | ✅ R3-H1 수정 시 함께 해결 |
| R3-M4 | 11 vs 13 state.json 스키마 형태 차이 | 보류: 11은 개념적 소개, 13이 canonical. 구현 시 13 기준 |

### LOW (3건) — 향후 구현 시 자연스럽게 해결
