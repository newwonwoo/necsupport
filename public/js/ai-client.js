// ─────────────────────────────────────────────
//  ai-client.js · Groq API 호출 (OpenAI 호환)
//  · 무료 + 매우 빠름 (llama-3.3-70b-versatile 등)
//  · 키는 https://console.groq.com/keys 에서 발급
// ─────────────────────────────────────────────

import { CFG } from './config.js';

async function callLLM(systemPrompt, userPrompt, maxTokens = 900) {
  if (!CFG.api_key) throw new Error('API 키가 설정되지 않았습니다');
  const r = await fetch(CFG.api_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CFG.api_key}`,
    },
    body: JSON.stringify({
      model: CFG.model,
      max_tokens: maxTokens,
      temperature: CFG.temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`API ${r.status}: ${t.slice(0, 200)}`);
  }
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

function parseJSON(text) {
  const cleaned = text.replace(/```json?|```/g, '').trim();
  try { return JSON.parse(cleaned); }
  catch (e) { console.warn('JSON 파싱 실패:', cleaned); return null; }
}

const BASE_SYS = `당신은 대한민국 선거법 유권해석 보조 AI입니다.
- 룰베이스가 우선이며 당신은 보조입니다
- 룰베이스 결론이 있으면 뒤집지 않습니다
- 입력되지 않은 사실관계를 가정하지 않습니다
- 근거 없는 조문이나 해석을 생성하지 않습니다
- 응답은 반드시 유효한 JSON 객체 (마크다운 금지)`;

// ── 추가 질문 생성 (결과 부족 시) ──
export async function askForMoreInfo(ctx) {
  const prompt = `[작업] 결론 판단에 필요한 추가 질문 생성 (최대 3개)
[원질문] ${ctx.q || '없음'}
[입력] 선거유형:${ctx.elecType || '전체'} / 업무유형:${ctx.task} / 판단변수:${JSON.stringify(ctx.vars)}
[현재 검색 결과] 유권해석 ${ctx.qaCount}건, 실무안내 ${ctx.guideCount}건, 조문 ${ctx.lawCount}건
[지시]
- 이미 입력된 내용은 묻지 않습니다
- 예/아니오 또는 선택형 위주
- 합법/위법 단정 금지

다음 JSON 스키마로 응답:
{"추가질문":[{"질문":"...","형식":"예/아니오","선택지":["예","아니오"]}]}`;

  return parseJSON(await callLLM(BASE_SYS, prompt, 800));
}

// ── 단순절차 안내 ──
export async function explainProcedure(ctx) {
  const prompt = `[작업] 단순절차 안내
[원질문] ${ctx.q || '없음'}
[입력] 선거유형:${ctx.elecType || '전체'} / 업무유형:${ctx.task}
[관련 조문] ${ctx.articles || '없음'}
[지시] 합법/위법 판단 금지. 절차와 확인사항만 기술

JSON 스키마: {"절차안내":"...","확인필요":"...","관련근거":"..."}`;

  return parseJSON(await callLLM(BASE_SYS, prompt, 900));
}

// ── 룰베이스 결과 보조 설명 ──
export async function explainResult(ctx) {
  const prompt = `[작업] 룰베이스 결과 기반 실무형 보조답변
[원질문] ${ctx.q || '없음'}
[추가응답] ${JSON.stringify(ctx.followups || {})}
[입력] 선거:${ctx.elecType || '전체'} / 주체:${ctx.actor || ''} / 업무:${ctx.task}
[룰베이스 결론] ${ctx.verdict}
[관련 조문] ${ctx.articles || '없음'}
[지시] 결론 변경 금지, 사실 가정 금지

JSON 스키마: {"결론":"...","근거":"...","추가확인":"..."}`;

  return parseJSON(await callLLM(BASE_SYS, prompt, 900));
}

// ── 결과 없을 때 최종 폴백: AI에게 던지고 우리 폼 형식으로 받기 ──
export async function fallbackAnalysis(ctx) {
  const prompt = `[업무유형] ${ctx.task}
[선거유형] ${ctx.elecType || '전체'}
[판단변수] ${JSON.stringify(ctx.vars)}
[추가설명] ${ctx.extra || '없음'}
[현재 룰베이스 결과] 유권해석 ${ctx.qaCount}건, 실무안내 ${ctx.guideCount}건, 조문 ${ctx.lawCount}건 — 모두 부족
[현재 매핑된 핵심 조문] ${ctx.articles || '없음'}

룰베이스에서 충분한 답을 찾지 못했습니다.
대한민국 선거법령(공직선거법, 정치자금법, 정당법, 위탁선거법 등)을 바탕으로
다음 JSON 스키마로 응답하세요:

{
  "결론": "합법|위법|조건부|판단불가",
  "핵심조문": ["법령명 제XX조"],
  "추천실무책자": ["책자명"],
  "해석요약": "3문장 이내 실무형 요약",
  "재랭킹힌트": ["DB 재검색용 키워드 2~4개"],
  "추가확인": "더 필요한 정보"
}`;

  return parseJSON(await callLLM(BASE_SYS, prompt, 1000));
}
