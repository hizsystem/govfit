# GovFit — 회사 맞춤 정부지원사업 추천 (MVP)

회사 정보를 입력하면 조건에 맞는 정부지원사업을 골라 **규칙 필터링 + AI 적합도 평가**로 추천해주는 플랫폼입니다.

> 🚧 **현재 단계: 아이디어 검증용 MVP**
> 지원사업 데이터는 흐름 검증용 **샘플 데이터**로 동작합니다. 추후 기업마당(bizinfo)·K-Startup 등 공공 API로 교체할 수 있도록 설계되어 있습니다.

## 동작 방식

```
회사정보 입력
   ↓
[1] 규칙 필터링  — 업종/지역/업력/규모/특성 조건이 맞는 사업만 추림
   ↓
[2] AI 적합도 평가 — Claude가 회사 설명을 읽고 점수(0~100) + 추천 이유 생성
   ↓
순위별 추천 결과 표시
```

AI 매칭은 `ANTHROPIC_API_KEY`가 설정돼 있을 때 동작하며, **키가 없으면 규칙 기반 점수로 자동 폴백**합니다(키 없이도 전체 흐름이 동작).

## 시작하기

```bash
# 1. 의존성 설치 (이미 설치돼 있다면 생략)
npm install

# 2. (선택) AI 매칭을 쓰려면 환경변수 설정
cp .env.example .env.local
# .env.local 파일을 열어 ANTHROPIC_API_KEY 입력

# 3. 개발 서버 실행
npm run dev
```

브라우저에서 http://localhost:3000 접속.

## 기술 스택

| 영역 | 선택 |
|------|------|
| 프레임워크 | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind CSS |
| AI 매칭 | Claude API (`@anthropic-ai/sdk`, 기본 모델 Haiku 4.5) |
| 데이터 | 샘플 데이터 (`src/lib/data/programs.ts`) — 추후 공공 API로 교체 |

## 프로젝트 구조

```
src/
├── app/
│   ├── page.tsx               # 입력 폼 + 결과 화면 (클라이언트 컴포넌트)
│   └── api/recommend/route.ts # 추천 API 엔드포인트
└── lib/
    ├── types.ts              # 데이터 타입 정의
    ├── constants.ts          # 업종/지역/분야 선택지
    ├── filter.ts             # 규칙 기반 1차 필터링
    ├── match.ts              # Claude AI 적합도 평가 (+ 규칙 폴백)
    └── data/programs.ts      # 샘플 지원사업 데이터
```

## 다음 단계 (로드맵)

- [ ] `src/lib/data/programs.ts`를 공공데이터포털 기업마당 API 연동으로 교체
- [ ] 지원사업 DB 저장 (현재는 메모리 → SQLite/Postgres)
- [ ] 회원가입 / 관심 사업 저장
- [ ] 신청 마감 임박 알림
- [ ] 추천 결과 정확도 피드백 수집

## 공공 API 연동 안내

지원사업 데이터를 실제로 받아오려면 [공공데이터포털](https://www.data.go.kr)에서
**기업마당 지원사업정보** API 키를 발급받은 뒤, `src/lib/data/programs.ts`의
`PROGRAMS` 배열을 API 호출 결과로 채우면 됩니다. 나머지 필터링·매칭 로직은 그대로
재사용됩니다.
