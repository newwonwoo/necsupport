# 선거지원 AI · 통합 검색

선거관리위원회 직원이 업무 중 궁금한 사항을 물어보면
**유권해석 · 실무안내 · 조문**을 한 번에 검색해주는 단일 페이지 도구입니다.

## 컨셉

```
[큰 분류]   선거절차 / 지도
    ↓
[세부 분류] 기부행위, 선거운동, 인터넷·SNS, 후원회 등 13종
    ↓
[변수 입력] 행위주체·시기·수단 등 채팅형으로 좁히기
    ↓        (매 단계마다 유권해석/실무안내/조문 매칭 건수 실시간 표시)
[결과]      3개 탭 통합 결과 + "원하는 답변이 있나요?"
    ↓
[부족하면]  로컬 추가질문 (Y/N + 예시) → 답변마다 재검색
    ↓
[그래도 부족] AI 폴백 (Claude API)
```

### 핵심 흐름

1. **좁힘 단계마다 3종 자료 카운트** 가시화 (유권해석 N건 / 실무안내 N건 / 조문 N건)
2. **단순절차 빠른 답변** — 변수 입력 도중 단순절차 비율이 높으면 즉시 답변 카드 노출 + "이게 찾던 답인가요?" 확인
3. **결과 부족 시 로컬 추가질문** — `search.js`의 `generateLocalQuestions()`가 미입력 변수를 분석해서 "혹시 ○○이 ○○인가요?" Y/N 형태로 자동 생성. 답변 예시(다른 옵션들)도 함께 노출
4. **AI는 마지막 폴백** — 로컬 질문도 다 답했는데 결과가 여전히 부족하면 그제서야 Claude를 호출. 응답은 우리 폼 형식(`결론/핵심조문/추천실무책자/해석요약/추가확인`)으로 받아 결과창에 통합

## 폴더 구조

```
necsupport/
├── README.md
├── vercel.json              # Vercel 배포 설정 (outputDirectory: public)
├── .gitignore
├── public/                  # ◀ Vercel에 배포되는 정적 자산
│   ├── index.html           #   진입점 (마크업만)
│   ├── css/
│   │   └── app.css          #   모든 스타일
│   ├── js/                  #   ES Module로 분리
│   │   ├── config.js        #     상수·카테고리·변수·키워드
│   │   ├── data-loader.js   #     fetch + 업로드 폴백
│   │   ├── search.js        #     searchQA / searchLaws / searchGuides / generateLocalQuestions
│   │   ├── ai-client.js     #     Claude API 호출 (브라우저 직접)
│   │   ├── ui.js            #     슬라이드·카드·결과 렌더링
│   │   └── app.js           #     메인 진입점·상태 관리
│   └── data/                #   JSON 데이터셋 (자동 fetch 대상)
│       ├── nec_qa.json          (24MB · 9,725건 유권해석)
│       ├── laws_text.json       (실무안내서 5권 + Rule Engine)
│       └── law_index.json       (업무유형↔법령 매핑)
└── docs/                    # ◀ 참고 자료 (배포 제외)
    ├── election-law-ai_legacy.html   # 원본 단일 HTML (참고용)
    └── laws/                          # 선거 관련 법령 PDF 16개
        ├── 공직선거법_2026.pdf
        ├── 정치자금법_2025.pdf
        └── ...
```

## 데이터셋

| 파일 | 설명 |
|---|---|
| `nec_qa.json`     | 중앙선거관리위원회 공개 Q&A 9,725건. 정규화 필드 `tags.업무유형/주체/관련조문` 포함 |
| `laws_text.json`  | 실무안내서 5권(295섹션) + Rule Engine 38건 + Rule Catalog 22건 |
| `law_index.json`  | 업무유형 14종 × 핵심법률/연관규칙 매핑 + 법령 메타데이터 |

⚠️ **모두 공개 정보입니다.** 개인정보 포함 없음.

## 로컬 실행

```bash
# 정적 파일이라 그냥 서버만 띄우면 됩니다
cd public
python3 -m http.server 8000
# → http://localhost:8000
```

또는 Node 환경:

```bash
npx serve public
```

## Vercel 배포

이 저장소는 별도 빌드 없이 정적 사이트로 배포됩니다.

1. Vercel에서 `Add New Project` → 이 GitHub 저장소 import
2. **Framework Preset**: `Other`
3. **Root Directory**: `./` (저장소 루트)
4. **Build Command**: 비워둠
5. **Output Directory**: `public` (vercel.json에 이미 설정됨)
6. Deploy

배포 후 `https://<project>.vercel.app/` 접속.

> ⚠️ **API 키 보안 주의**: 현재는 사용자가 브라우저에 직접 Groq API 키를 입력하여 `localStorage`에 저장합니다. Groq은 무료 티어가 충분하므로 직원별 개인 키 발급 권장. 공유 키를 쓰려면 Vercel Edge Function 프록시로 마이그레이션 권장.

## 사용법

1. 상단 우측 `API` 입력란에 **Groq API 키** 입력 (선택, AI 폴백용)
   - 무료 발급: https://console.groq.com/keys
   - 키 형식: `gsk_xxxx...`
   - 모델: `llama-3.3-70b-versatile` (config.js에서 변경 가능)
2. 패널 0에서 **선거절차 / 지도** 중 선택
3. 패널 1에서 세부 업무 선택 (각 카드에 자료 건수 표시)
4. 패널 2에서 채팅형 변수 입력 (실시간 카운트바 갱신)
5. **단순절차** 비율이 높으면 중간에 빠른답변 카드 등장 → "이게 답인가요?" 확인
6. 입력 완료 → `통합 검색하기` 클릭
7. 결과 화면에서 3개 탭(유권해석/실무안내/조문) 확인
8. 답이 부족하면 `❌ 없어요` → 로컬 추가질문(Y/N)에 답변
9. 그래도 부족하면 자동으로 AI 분석 진행

## 직원용 단축 안내

| 상황 | 동작 |
|---|---|
| 비슷한 사례 찾고 싶을 때 | 변수 2~3개만 선택하고 `통합 검색하기` |
| 절차 안내만 필요할 때 | 변수 입력 중 등장하는 파란 카드 클릭 |
| 결과가 너무 적을 때 | `❌ 없어요` → Y/N 추가 질문에 답하기 |
| 처음부터 다시 | 결과 화면 `🔄 새 검색` 또는 상단 단계 번호 클릭 |

## 라이선스 / 출처

- 선거 법령 PDF: 법제처 (공개)
- 유권해석 Q&A: 중앙선거관리위원회 (공개)
- 실무안내서: 중앙선거관리위원회 (공개)
