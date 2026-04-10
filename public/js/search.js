// ─────────────────────────────────────────────
//  search.js · 통합 검색 (유권해석 + 조문 + 실무책자)
// ─────────────────────────────────────────────

import { SUBJ_MAP, TASK_KEYWORDS } from './config.js';

// ── 유권해석 검색 ──
export function searchQA(state) {
  const { qaData, task, vars } = state;
  if (!qaData || !task) return { matches: [], total: 0, dist: emptyDist(), quality: 'low', hasConflict: false };

  const selSubj  = vars['행위주체'] || vars['후원인유형'] || vars['지출주체'] || vars['주체'] || '';
  const normSubj = SUBJ_MAP[selSubj] || selSubj;
  const scored = [];

  for (const qa of qaData) {
    const tags     = qa.tags || {};
    const taskTags = tags['업무유형'] || [];
    const subjs    = tags['주체'] || [];

    // 업무유형 필터
    let taskScore = 0;
    if (taskTags[0] === task)           taskScore = 10;
    else if (taskTags.includes(task))   taskScore = 5;
    else if (taskTags.includes('미분류')) taskScore = 1;
    else continue;

    let score = taskScore;

    // 주체 매칭
    if (normSubj && normSubj !== '기타') {
      if (subjs.includes(normSubj))                                   score += 10;
      else if (subjs.some(s => s.includes(normSubj) || normSubj.includes(s))) score += 5;
    }

    // 키워드 매칭
    const kws = TASK_KEYWORDS[task] || [];
    const titleHit = kws.some(kw => (qa.title || '').includes(kw));
    const qHit     = kws.some(kw => (qa.question || '').includes(kw));
    if (titleHit)      score += 8;
    else if (qHit)     score += 4;
    else               score -= 3;

    // 변수값 매칭
    for (const [k, v] of Object.entries(vars)) {
      if (!v || v === '기타') continue;
      if (['행위주체', '후원인유형', '지출주체', '주체'].includes(k)) continue;
      if ((qa.title || '').includes(v))                          score += 6;
      else if ((qa.question || '').includes(v))                  score += 4;
      else if ((qa.answer || '').slice(0, 300).includes(v))      score += 2;
    }

    // 자유 기술(extraDesc) 키워드 매칭
    const extraDesc = state.extraDesc || '';
    if (extraDesc.length >= 2) {
      const words = extraDesc.split(/[\s,.·]+/).filter(w => w.length >= 2);
      for (const w of words) {
        if ((qa.title || '').includes(w))                        score += 5;
        else if ((qa.question || '').includes(w))                score += 3;
        else if ((qa.answer || '').slice(0, 300).includes(w))    score += 1;
      }
    }

    // 결론 품질
    const concl = qa.conclusion || '';
    if (['합법', '가능', '위법', '불가'].includes(concl)) score += 3;
    else if (concl === '조건부')                          score += 2;
    else if (concl === '단순절차' || concl === '절차')    score += 2;
    else if (['소관외'].includes(concl))                   score -= 2;

    scored.push({ qa, score });
  }

  scored.sort((a, b) => b.score - a.score);

  // ── 변수 기반 좁힘 필터 (사용자가 변수 추가할 때마다 카운트가 줄어들도록) ──
  const meaningfulVars = Object.entries(vars).filter(([k, v]) => v && v !== '기타');
  let filtered = scored;
  if (meaningfulVars.length > 0) {
    filtered = scored.filter(({ qa }) => {
      return meaningfulVars.every(([k, v]) => {
        if (['행위주체', '후원인유형', '지출주체', '주체'].includes(k)) {
          const norm = SUBJ_MAP[v] || v;
          const subjs = qa.tags?.['주체'] || [];
          return subjs.some(s => s === norm || s.includes(norm) || norm.includes(s));
        }
        return (qa.title || '').includes(v) ||
               (qa.question || '').includes(v) ||
               (qa.answer || '').slice(0, 300).includes(v);
      });
    });
    // 너무 줄어들면 (3건 미만) 원래 풀로 폴백
    if (filtered.length < 3 && scored.length >= 3) {
      filtered = scored;
    }
  }

  const top = filtered.slice(0, 8);
  const strongCount = filtered.filter(x => x.score >= 15).length;

  const dist = emptyDist();
  filtered.forEach(x => {
    const c = normalizeConclusion(x.qa.conclusion);
    if (c in dist) dist[c]++;
  });

  const topConcl = top
    .map(x => normalizeConclusion(x.qa.conclusion))
    .filter(c => ['합법', '위법'].includes(c));
  const hasConflict = new Set(topConcl).size > 1;

  const maxScore = top.length ? top[0].score : 0;
  const quality = maxScore >= 25 ? 'high' : maxScore >= 15 ? 'mid' : 'low';

  // 단순절차 사례를 별도 추출 (상위 8건에 안 올라와도 화면에 표시할 수 있도록)
  const procSamples = filtered
    .filter(x => normalizeConclusion(x.qa.conclusion) === '단순절차')
    .slice(0, 3);

  return { matches: top, total: filtered.length, strongCount, dist, hasConflict, quality, maxScore, procSamples };
}

// ── 조문 검색 (자동 매핑 + 키워드 검색) ──
export function searchLaws(state) {
  const { lawIndex, lawsText, task, vars, userArts = [] } = state;
  const out = [];

  // 1) law_index 자동 매핑
  if (lawIndex && task) {
    const m = lawIndex.article_mapping?.[task];
    if (m) {
      for (const [law, arts] of Object.entries(m['핵심법률'] || {})) {
        for (const a of arts) out.push({ law, article: a, type: '핵심', source: 'auto' });
      }
      for (const [law, arts] of Object.entries(m['연관규칙'] || {})) {
        for (const a of arts) out.push({ law, article: a, type: '연관', source: 'auto' });
      }
    }
  }

  // 2) 사용자 직접 추가 조문
  for (const a of userArts) {
    if (!out.find(o => o.law === a.law && o.article === a.num)) {
      out.push({ law: a.law, article: a.num, type: '사용자지정', source: 'user' });
    }
  }

  // 3) 변수값 키워드 매칭으로 조문 검색
  if (lawsText && task) {
    const allKws = [
      ...(TASK_KEYWORDS[task] || []),
      ...Object.values(vars).filter(v => v && v !== '기타'),
    ];
    const laws = lawsText.laws || {};
    for (const [name, data] of Object.entries(laws)) {
      for (const a of data.articles || []) {
        const txt = (a.text || '') + (a.title || '');
        const hit = allKws.some(kw => kw && txt.includes(kw));
        if (hit && !out.find(o => o.law === name && o.article === a.article_num)) {
          out.push({
            law: name, article: a.article_num,
            title: a.title, preview: (a.text || '').slice(0, 120),
            type: '키워드', source: 'kw',
          });
          if (out.length > 30) break;
        }
      }
      if (out.length > 30) break;
    }
  }

  return out;
}

// ── 실무안내서 검색 ──
export function searchGuides(state) {
  const { lawsText, task, vars } = state;
  if (!lawsText) return [];

  // laws_text.json 구조: guidebooks[name].sections[]
  const guidebooks = lawsText.guidebooks || {};
  const queryWords = [
    ...(TASK_KEYWORDS[task] || []),
    ...Object.values(vars).filter(v => v && v !== '기타'),
  ];

  const scored = [];
  for (const [bookName, book] of Object.entries(guidebooks)) {
    const sections = book.sections || [];
    for (const sec of sections) {
      const kws = sec.keywords || [];
      const text = (sec.title || '') + (sec.summary || '');
      let score = 0;
      for (const w of queryWords) {
        if (!w) continue;
        if (kws.some(k => k.includes(w) || w.includes(k))) score += 3;
        if (text.includes(w)) score += 1;
      }
      if (score > 0) scored.push({ ...sec, book: bookName, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 10);
}

// ── 통합 검색: 한 번 호출로 3자원 카운트 + 결과 ──
export function searchAll(state) {
  const qa     = searchQA(state);
  const laws   = searchLaws(state);
  const guides = searchGuides(state);
  return {
    qa, laws, guides,
    counts: {
      qa: qa.total,
      laws: laws.length,
      guides: guides.length,
    },
  };
}

// ── Utils ──
function emptyDist() {
  return { '합법': 0, '위법': 0, '조건부': 0, '단순절차': 0, '소관외': 0 };
}

function normalizeConclusion(c) {
  if (!c) return '';
  if (c === '가능') return '합법';
  if (c === '불가') return '위법';
  if (c === '절차') return '단순절차';
  return c;
}

// ── 조건 추천 (현재 안 채워진 변수 중 매칭 늘려주는 것) ──
export function getSuggestions(state) {
  const { qaData, task, vars } = state;
  if (!qaData || !task) return [];

  const VARS = state._VARS;
  const taskVars = VARS[task] || {};
  const suggestions = [];

  for (const [varKey, options] of Object.entries(taskVars)) {
    if (vars[varKey]) continue;
    for (const opt of options) {
      if (opt === '기타') continue;
      const testState = { ...state, vars: { ...vars, [varKey]: opt } };
      const r = searchQA(testState);
      if (r.matches.length >= 3 && r.maxScore >= 20) {
        suggestions.push({ varKey, opt, cnt: r.total, highCnt: r.matches.length });
      }
    }
  }
  return suggestions.sort((a, b) => b.highCnt - a.highCnt).slice(0, 3);
}

// ── 로컬 추가질문 생성 (AI 호출 없이) ──
// "혹시 [변수]이(가) [옵션]인가요?" 형태로 미입력 변수에 대해 질문지 생성
export function generateLocalQuestions(state) {
  const VARS = state._VARS;
  const taskVars = VARS[state.task] || {};
  const questions = [];

  for (const [varKey, options] of Object.entries(taskVars)) {
    if (state.vars[varKey]) continue; // 이미 입력됨

    // 각 옵션을 추가했을 때 결과 변화 시뮬레이션
    // total 은 점수 가산 전체 풀, strongCount 는 의미있는 매칭(score>=15)
    const optResults = options
      .filter(o => o !== '기타')
      .map(opt => {
        const test = { ...state, vars: { ...state.vars, [varKey]: opt } };
        const r = searchQA(test);
        return { opt, strong: r.strongCount, total: r.total, maxScore: r.maxScore };
      })
      .filter(x => x.strong > 0)
      .sort((a, b) => b.strong - a.strong || b.maxScore - a.maxScore);

    if (!optResults.length) continue;

    const top = optResults[0];
    // 옵션 간 차이가 거의 없으면 좁힘 효과 없음 → 스킵
    const range = optResults[0].strong - optResults[optResults.length - 1].strong;
    if (range < 1) continue;

    questions.push({
      varKey,
      topOpt: top.opt,
      topCount: top.strong,        // 화면에 표시되는 건수
      topScore: top.maxScore,
      allOptions: optResults,      // 답변 예시 (각 옵션 + strong 카운트)
    });
  }

  // 좁힘 효과가 큰 변수부터 (옵션별 차이가 큰 순)
  questions.sort((a, b) => {
    const da = (a.allOptions[0]?.strong || 0) - (a.allOptions[a.allOptions.length - 1]?.strong || 0);
    const db = (b.allOptions[0]?.strong || 0) - (b.allOptions[b.allOptions.length - 1]?.strong || 0);
    return db - da;
  });
  return questions.slice(0, 5);
}

// ── 단순절차 빠른 답변 추출 ──
// 별도 procSamples 에서 추출 (상위 8건에 안 올라와도 찾을 수 있도록)
export function getQuickProcedure(state) {
  const r = searchQA(state);
  const procCount = r.dist['단순절차'] || 0;
  // 1건이라도 있고, 비율 10% 이상이거나 절대 3건 이상이면 트리거
  if (procCount < 1) return null;
  const procRatio = r.total > 0 ? procCount / r.total : 0;
  if (procRatio < 0.1 && procCount < 3) return null;

  // procSamples 에서 가져오기 (상위 8건과 독립적)
  if (r.procSamples && r.procSamples.length > 0) {
    return r.procSamples[0].qa;
  }
  return null;
}

// 정규화 export
export function normalize(c) { return normalizeConclusion(c); }
