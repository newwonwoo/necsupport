// ─────────────────────────────────────────────
//  app.js · 메인 진입점 / 상태 관리
// ─────────────────────────────────────────────

import { CFG, MAIN_CATS, TASKS, VARS, VERDICT_META } from './config.js';
import { loadAll, setupUploadFallback } from './data-loader.js';
import { searchAll, searchQA, generateLocalQuestions } from './search.js';
import * as ai from './ai-client.js';
import * as ui from './ui.js';

// ─── 전역 상태 ─────────────────────────
const S = {
  step: 0,
  main: null,
  task: null,
  elecType: '',
  vars: {},
  extraDesc: '',
  userArts: [],
  qaData: null,
  lawsText: null,
  lawIndex: null,
  _VARS: VARS,
  _lastResults: null,
};

window.__state = S; // 디버그용

// ─── 초기화 ─────────────────────────
async function init() {
  // API 키 복원
  const k = localStorage.getItem('elaw_key');
  if (k) {
    document.getElementById('apiKey').value = k;
    CFG.api_key = k;
    CFG.api_enabled = true;
    setApiStatus(true);
  }
  document.getElementById('apiKey').addEventListener('input', e => {
    const v = e.target.value.trim();
    CFG.api_key = v || null;
    CFG.api_enabled = !!v;
    setApiStatus(!!v);
    if (v) localStorage.setItem('elaw_key', v);
    else localStorage.removeItem('elaw_key');
  });

  // 사이드바 컨트롤
  document.getElementById('btnSidebarClose').addEventListener('click', ui.closeSidebar);
  document.getElementById('btnSidebarCopy').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('sbBody').textContent).then(() => alert('복사됐습니다'));
  });
  document.getElementById('btnSidebarLink').addEventListener('click', () => {
    const u = document.getElementById('sidebar').dataset.url;
    if (u) window.open(u, '_blank');
  });

  // 단계 점 클릭
  for (let i = 0; i < 5; i++) {
    const d = document.getElementById('dot' + i);
    if (d) d.addEventListener('click', () => goStep(i));
  }

  // 히스토리
  document.getElementById('histBtn').addEventListener('click', () => {
    document.getElementById('histPanel').classList.toggle('open');
  });
  renderHist();

  // 데이터 로딩
  showOverlay(true);
  const ok = await loadAll(S, onDataProgress);
  if (ok) {
    showOverlay(false);
    bootApp();
  } else {
    // 자동 fetch 실패 → 업로드 모드로 전환
    enableUploadMode();
  }
}

function setApiStatus(ok) {
  const e = document.getElementById('apiStatus');
  e.textContent = ok ? '✓ 연결됨' : '미입력';
  e.className = 'api-status ' + (ok ? 'ok' : 'no');
}

function showOverlay(show) {
  const ov = document.getElementById('dataOverlay');
  if (!ov) return;
  ov.style.display = show ? 'flex' : 'none';
}

function onDataProgress(key, status, payload) {
  const row = document.querySelector(`.data-progress-row[data-key="${key}"]`);
  if (!row) return;
  if (status === 'loading') {
    row.className = 'data-progress-row';
    row.querySelector('.icon').textContent = '⏳';
    row.querySelector('.label').textContent = row.dataset.label + ' 로딩 중...';
  } else if (status === 'ok') {
    row.className = 'data-progress-row ok';
    row.querySelector('.icon').textContent = '✅';
    const cnt = Array.isArray(payload) ? payload.length.toLocaleString() + '건' : '로드 완료';
    row.querySelector('.label').textContent = row.dataset.label + ' ' + cnt;
  } else if (status === 'err') {
    row.className = 'data-progress-row err';
    row.querySelector('.icon').textContent = '⚠️';
    row.querySelector('.label').textContent = row.dataset.label + ' (직접 업로드 필요)';
  }
}

function enableUploadMode() {
  const ov = document.getElementById('dataOverlay');
  if (!ov) return;
  ov.querySelector('.overlay-title').textContent = 'DB 파일 업로드';
  ov.querySelector('.overlay-desc').textContent = '서버에서 데이터를 불러오지 못했습니다. 아래 파일을 직접 선택해주세요.';
  setupUploadFallback(S, () => {
    showOverlay(false);
    bootApp();
  }, onDataProgress);
}

function bootApp() {
  ui.slide(S.step);
  ui.renderMainCats(S, selMain);
  ui.updateStepBar(S.step);
}

// ─── 단계 이동 ─────────────────────────
function goStep(s) {
  if (s > S.step) return;
  S.step = s;
  ui.slide(S.step);
  ui.updateStepBar(S.step);
  ui.updateBreadcrumb(S, goStep);
}

function nextStep() {
  S.step++;
  ui.slide(S.step);
  ui.updateStepBar(S.step);
  ui.updateBreadcrumb(S, goStep);
}

// ─── 패널 핸들러 ─────────────────────────
function selMain(id) {
  S.main = id;
  S.task = null;
  S.elecType = '';
  S.vars = {};
  ui.renderTasks(S, selTask);
  ui.updateBreadcrumb(S, goStep);
  S.step = 1;
  ui.slide(S.step);
  ui.updateStepBar(S.step);
}

function selTask(id) {
  S.task = id;
  S.vars = {};
  S.extraDesc = '';
  S.userArts = [];
  ui.updateBreadcrumb(S, goStep);
  S.step = 2;
  ui.slide(S.step);
  ui.updateStepBar(S.step);
  ui.resetVarChatFlags();
  // 진입 카운트바 + 채팅 변수 입력 시작
  ui.renderCountBar('countBar2', S, '변수를 선택할수록 결과가 좁혀집니다');
  setTimeout(() => {
    ui.startVarChat(S, onVarComplete, () => {
      ui.renderCountBar('countBar2', S, '변수를 선택할수록 결과가 좁혀집니다');
    });
  }, 80);
}

function onVarComplete() {
  // 변수 입력 끝나면 제출 버튼 자동 노출 (ui.startVarChat 내부에서)
  ui.renderCountBar('countBar2', S, '결과 검색 준비 완료');
}

// ─── 검색 실행 ─────────────────────────
async function submitQuery() {
  const taskVars = VARS[S.task] || {};
  const reqKeys = Object.keys(taskVars);
  const filled = reqKeys.filter(k => S.vars[k]);
  if (reqKeys.length > 0 && filled.length < Math.min(2, reqKeys.length)) {
    alert('판단 변수를 최소 2개 이상 입력해주세요.');
    return;
  }

  nextStep(); // 패널3 (로딩)
  try {
    setLoad('관련 자료 검색 중...', '유권해석 / 실무안내 / 조문');
    await sleep(250);
    const results = searchAll(S);
    S._lastResults = results;
    setLoad('결과 정리 중...', '거의 다 됐습니다');
    await sleep(200);
    const verdict = ui.renderResult(S, results, null);
    nextStep(); // 패널4 (결과)
    saveHist(verdict);
    bindResultActions();

    // 결과가 부족(<3건)하거나 너무 많으면(>=30건) 자동으로 좁힘 모드 진입
    if (results.qa.total < 3 || results.qa.total >= 30) {
      setTimeout(() => onAnswerNo(), 800);
    }
  } catch (e) {
    console.error(e);
    alert('오류: ' + e.message);
    goStep(2);
  }
}

function setLoad(m, s) {
  document.getElementById('loadMsg').textContent = m;
  document.getElementById('loadSub').textContent = s;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── 결과 화면 액션 ─────────────────────────
function bindResultActions() {
  document.getElementById('answerYesBtn')?.addEventListener('click', onAnswerYes);
  document.getElementById('answerNoBtn')?.addEventListener('click', onAnswerNo);
  document.querySelectorAll('.btn-act').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.act;
      if (a === 'print') window.print();
      else if (a === 'copy') {
        navigator.clipboard.writeText(document.getElementById('resultWrap').innerText)
          .then(() => alert('복사됐습니다'));
      } else if (a === 'reset') resetSearch();
    });
  });

  // QA 카드 클릭 → 사이드바
  document.querySelectorAll('#tab-qa .qa-card').forEach(c => {
    c.addEventListener('click', () => {
      const idx = parseInt(c.dataset.idx);
      const m = S._lastResults?.qa?.matches?.[idx];
      if (m) ui.showQASidebar(m.qa);
    });
  });
  // 조문 카드 클릭 → 사이드바
  document.querySelectorAll('#tab-law .law-card').forEach(c => {
    c.addEventListener('click', () => ui.openSidebar(S, c.dataset.law, c.dataset.art));
  });
  // 실무안내 카드 → 사이드바에 풀텍스트
  document.querySelectorAll('#tab-guide .guide-card').forEach(c => {
    c.addEventListener('click', () => {
      const idx = parseInt(c.dataset.idx);
      const g = S._lastResults?.guides?.[idx];
      if (g) ui.showGuideSidebar(g);
    });
  });

  // 단순절차 강조 카드 → QA 사이드바
  document.querySelectorAll('.proc-section-card').forEach(c => {
    c.addEventListener('click', () => {
      const idx = parseInt(c.dataset.procIdx);
      const m = S._lastResults?.qa?.matches?.[idx];
      if (m) ui.showQASidebar(m.qa);
    });
  });

  // "더 좁혀서 검색" 버튼 → 추가 질문 모드
  document.getElementById('narrowMoreBtn')?.addEventListener('click', onAnswerNo);
}

function onAnswerYes() {
  const sec = document.getElementById('answerCheck');
  if (sec) sec.innerHTML = '<div style="font-size:13px;color:var(--mint);font-weight:600;padding:6px 0">✅ 검색을 완료했습니다.</div>';
}

// ─────────────────────────────────────
//  답이 없을 때 흐름 (로컬 우선 → AI 폴백)
// ─────────────────────────────────────
//
//  1) 로컬: 미입력 변수에서 "혹시 ○○이 ○○인가요?" Y/N 질문 자동 생성
//  2) 사용자가 답하면 vars 업데이트 + 결과 즉시 갱신
//  3) 결과가 충분(>=3건)해지면 멈추고 안내
//  4) 모든 질문 답해도 결과가 부족하면 → AI 폴백 호출
//
async function onAnswerNo() {
  const sec = document.getElementById('answerCheck');
  if (sec) sec.innerHTML = '<div style="font-size:13px;color:var(--text3);padding:6px 0">🔍 추가 정보를 분석합니다...</div>';

  _freeFormShown = false;
  _localQs = generateLocalQuestions(S);
  _localQIdx = 0;
  _localAns = {};

  if (!_localQs.length) {
    // 좁힐 변수 없음 → 자유 입력 폼 제공
    showFreeInputForm('더 좁힐 수 있는 항목이 없습니다. 구체적인 상황을 직접 입력해주세요.');
    return;
  }
  setTimeout(askNextLocalQuestion, 400);
}

// 자유 입력 폼 (질문 다 끝났거나 처음부터 좁힐 게 없을 때)
function showFreeInputForm(headerText) {
  if (_freeFormShown) return;
  _freeFormShown = true;

  const area = document.getElementById('aiChatArea');
  if (!area) return;

  const d = document.createElement('div');
  d.className = 'chat-bubble';
  d.innerHTML = `
    <div class="bubble-av">🤖</div>
    <div class="bubble-body">
      <div style="font-size:13px;margin-bottom:8px">${ui.escapeHtml(headerText)}</div>
      <textarea class="free-desc-input" rows="3"
        style="width:100%;border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;font-size:13px;font-family:var(--sans);outline:none;resize:vertical;background:var(--bg)"
        placeholder="예) 선거일 90일 전 지역 체육행사에서 후보자 명함을 배부..."></textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="choice-pill free-submit-btn" style="background:var(--mint);color:#fff;border-color:var(--mint);font-weight:600">
          ${CFG.api_key ? '🤖 AI에게 분석 요청' : '🔁 키워드로 재정렬'}
        </button>
        <button class="choice-pill free-skip-btn">건너뛰기</button>
      </div>
      ${!CFG.api_key
        ? '<div style="font-size:10px;color:var(--text3);margin-top:8px">💡 API 키가 없어도 입력 내용으로 결과를 다시 정렬할 수 있습니다.</div>'
        : ''}
    </div>`;
  area.appendChild(d);
  scrollChatToEnd();

  const inp = d.querySelector('.free-desc-input');
  const submitBtn = d.querySelector('.free-submit-btn');
  const skipBtn = d.querySelector('.free-skip-btn');
  inp?.focus();

  submitBtn.addEventListener('click', () => {
    const val = (inp?.value || '').trim();
    if (!val) { inp?.focus(); return; }
    addUserBubble(area, val);
    _localAns['추가설명'] = val;
    inp.disabled = true;
    submitBtn.disabled = true;
    skipBtn.disabled = true;

    if (CFG.api_key) {
      addAIBubble(area, null);
      scrollChatToEnd();
      setTimeout(runFinalFallback, 600);
    } else {
      doFreeTextRerank(val);
    }
  });

  skipBtn.addEventListener('click', () => {
    inp.disabled = true;
    submitBtn.disabled = true;
    skipBtn.disabled = true;
    addLocalSystemMsg('검색을 종료합니다.');
  });
}

// 자유 텍스트로 결과 재정렬 (API 키 없을 때)
function doFreeTextRerank(text) {
  const words = text.split(/[\s,.]+/).filter(w => w.length >= 2);
  const matches = (S._lastResults?.qa?.matches || []).map(m => {
    let bonus = 0;
    words.forEach(w => {
      if ((m.qa.title || '').includes(w)) bonus += 10;
      if ((m.qa.question || '').includes(w)) bonus += 5;
      if ((m.qa.answer || '').slice(0, 300).includes(w)) bonus += 2;
    });
    return { ...m, score: (m.score || 0) + bonus };
  }).sort((a, b) => b.score - a.score);
  if (S._lastResults) {
    S._lastResults.qa.matches = matches;
    refreshResultTabs(S._lastResults);
  }
  addLocalSystemMsg(`🔁 입력 내용의 키워드(${words.slice(0, 4).join(', ')}...)로 결과를 재정렬했습니다. 위 유권해석 탭을 다시 확인해주세요.`);
}

function scrollChatToEnd() {
  const area = document.getElementById('aiChatArea');
  if (!area) return;
  const panel = area.closest('.slide-panel');
  if (panel) {
    setTimeout(() => { panel.scrollTop = panel.scrollHeight; }, 50);
  }
}

let _localQs = [], _localQIdx = 0;
let _localAns = {};
let _freeFormShown = false;

function askNextLocalQuestion() {
  const area = document.getElementById('aiChatArea');
  if (!area) return;

  // 매번 결과를 다시 검색해서 적절한 범위(3~30)인지 확인
  const r = searchAll(S);
  S._lastResults = r;
  refreshResultTabs(r);

  // 적정 범위(3~29건)면 그만 묻기
  if (r.qa.total >= 3 && r.qa.total < 30) {
    addLocalSystemMsg(`✅ 결과가 ${r.qa.total}건으로 적절해졌습니다. 위 유권해석 탭을 확인하세요.`);
    setTimeout(() => showFreeInputForm('더 좁히고 싶으면 구체적인 상황을 자유롭게 입력하세요.'), 400);
    return;
  }
  if (_localQIdx >= _localQs.length) {
    // 로컬 질문 다 했음 → 자유 입력 폼 (AI 또는 키워드 재정렬)
    const msg = r.qa.total >= 30
      ? `현재 ${r.qa.total}건으로 여전히 많아요. 직접 상황을 입력하면 더 좁힐 수 있습니다.`
      : `현재 ${r.qa.total}건으로 부족해요. 직접 상황을 입력해주세요.`;
    addLocalSystemMsg(msg);
    setTimeout(() => showFreeInputForm('구체적인 사실관계를 자유롭게 입력해주세요.'), 400);
    return;
  }

  const q = _localQs[_localQIdx];
  // 답변 예시 (상위 옵션들)
  const exampleHtml = q.allOptions
    .slice(0, 6)
    .map(o => `<button class="choice-pill" data-val="${ui.escapeAttr(o.opt)}">${ui.escapeHtml(o.opt)} <span class="cnt">${o.strong}</span></button>`)
    .join('');

  const bubble = addAIBubble(area,
    `<div style="margin-bottom:6px"><b>${ui.escapeHtml(q.varKey)}</b>이(가) <b style="color:var(--mint)">${ui.escapeHtml(q.topOpt)}</b>인가요?</div>
     <div style="font-size:11px;color:var(--text3);margin-bottom:8px">관련 사례 ${q.topCount}건이 있습니다.</div>
     <div class="bubble-choices">
       <button class="choice-pill" data-val="${ui.escapeAttr(q.topOpt)}">예 (${ui.escapeHtml(q.topOpt)})</button>
       <button class="choice-pill" data-no="1">아니오 / 다른 답</button>
     </div>
     <div style="font-size:10px;color:var(--text3);margin-top:8px;font-family:var(--mono)">↓ 다른 답 예시</div>
     <div class="bubble-choices" style="margin-top:4px">${exampleHtml}</div>`
  );

  bubble.querySelectorAll('.choice-pill').forEach(b => {
    b.addEventListener('click', () => {
      const isNo = b.dataset.no;
      if (isNo) {
        // 아니오 → 예시 보기 유지, 사용자가 다른 옵션 선택하도록
        addUserBubble(area, '아니오 / 다른 답');
        bubble.querySelector('[data-no]')?.setAttribute('disabled', 'disabled');
        bubble.querySelector('[data-val]')?.setAttribute('disabled', 'disabled');
        // 예시 옵션은 클릭 가능 상태 유지 (그대로)
        return;
      }
      const ans = b.dataset.val;
      if (!ans) return;
      S.vars[q.varKey] = ans;
      _localAns[q.varKey] = ans;
      bubble.querySelectorAll('.choice-pill').forEach(x => x.disabled = true);
      b.classList.add('picked');
      addUserBubble(area, `${q.varKey}: ${ans}`);
      _localQIdx++;
      setTimeout(askNextLocalQuestion, 500);
    });
  });
}

function addLocalSystemMsg(text) {
  const area = document.getElementById('aiChatArea');
  if (!area) return;
  const d = document.createElement('div');
  d.className = 'chat-bubble';
  d.innerHTML = `<div class="bubble-av">💡</div><div class="bubble-body" style="background:var(--bg2);color:var(--text2);font-size:12px">${ui.escapeHtml(text)}</div>`;
  area.appendChild(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// 결과 탭 카드들만 갱신 (헤더/탭 구조는 유지)
function refreshResultTabs(results) {
  const wrap = document.getElementById('resultWrap');
  if (!wrap) return;

  const tabs = wrap.querySelectorAll('.res-tab .badge');
  if (tabs[0]) tabs[0].textContent = results.counts.qa;
  if (tabs[1]) tabs[1].textContent = results.counts.guides;
  if (tabs[2]) tabs[2].textContent = results.counts.laws;

  const qaTab = document.getElementById('tab-qa');
  const guideTab = document.getElementById('tab-guide');
  const lawTab = document.getElementById('tab-law');
  if (qaTab) qaTab.innerHTML = ui._renderQATab(results.qa);
  if (guideTab) guideTab.innerHTML = ui._renderGuideTab(results.guides);
  if (lawTab) lawTab.innerHTML = ui._renderLawTab(results.laws);
  bindResultActions();
}

async function runFinalFallback() {
  const area = document.getElementById('aiChatArea');
  if (!area) return;
  const bubble = addAIBubble(area, null);

  const localAnsTxt = Object.entries(_localAns || {}).map(([q, a]) => `${q}: ${a}`).join('; ');
  const ctx = {
    task: S.task,
    elecType: S.elecType,
    vars: S.vars,
    extra: [S.extraDesc, localAnsTxt].filter(Boolean).join(' / '),
    qaCount: S._lastResults?.counts?.qa || 0,
    guideCount: S._lastResults?.counts?.guides || 0,
    lawCount: S._lastResults?.counts?.laws || 0,
    articles: (S._lastResults?.laws || []).slice(0, 4).map(a => `${a.law} ${a.article}`).join(', '),
  };

  try {
    const res = await ai.fallbackAnalysis(ctx);
    if (!res) { replaceAIBubble(bubble, 'AI 응답을 해석하지 못했습니다.'); return; }

    // 우리 폼 형식으로 출력
    let html = '';
    if (res['해석요약']) {
      html += `<div style="margin-bottom:10px"><b style="font-size:11px;color:var(--mint-dark)">[AI 해석요약]</b><br>${ui.escapeHtml(res['해석요약'])}</div>`;
    }
    if (res['결론']) {
      const vd = VERDICT_META[res['결론']] || VERDICT_META['미분류'];
      html += `<div style="margin-bottom:10px"><b style="font-size:11px;color:var(--mint-dark)">[AI 판단]</b><br><span class="verdict ${vd.cls}" style="font-size:12px;padding:4px 12px">${vd.label}</span></div>`;
    }
    if (res['핵심조문']?.length) {
      html += `<div style="margin-bottom:10px"><b style="font-size:11px;color:var(--mint-dark)">[핵심 조문]</b><br>${res['핵심조문'].map(a => `<span style="display:inline-block;background:var(--mint-light);padding:2px 8px;border-radius:10px;font-family:var(--mono);font-size:11px;margin:2px 4px 2px 0">${ui.escapeHtml(a)}</span>`).join('')}</div>`;
    }
    if (res['추천실무책자']?.length) {
      html += `<div style="margin-bottom:10px"><b style="font-size:11px;color:var(--mint-dark)">[추천 실무책자]</b><br>${res['추천실무책자'].map(b => ui.escapeHtml(b)).join(', ')}</div>`;
    }
    if (res['추가확인']) {
      html += `<div><b style="font-size:11px;color:var(--mint-dark)">[추가 확인 필요]</b><br>${ui.escapeHtml(res['추가확인'])}</div>`;
    }
    replaceAIBubble(bubble, html || '분석을 완료했습니다.');

    // 재랭킹힌트로 DB 재검색
    if (res['재랭킹힌트']?.length && S.qaData) {
      const hints = res['재랭킹힌트'];
      const reranked = (S._lastResults?.qa?.matches || []).slice();
      reranked.sort((a, b) => {
        const sa = hints.filter(h => (a.qa.title || '').includes(h) || (a.qa.question || '').includes(h)).length;
        const sb = hints.filter(h => (b.qa.title || '').includes(h) || (b.qa.question || '').includes(h)).length;
        return sb - sa;
      });
      // 결과 영역 카드 갱신은 안전을 위해 안함 (추가 메시지로만 알림)
      addAIBubble(area, `🔁 키워드 "${hints.join(', ')}"로 재정렬할 수 있는 사례가 있습니다.`);
    }
  } catch (e) {
    replaceAIBubble(bubble, `AI 호출 실패: ${e.message}`);
  }
}

function addAIBubble(area, html) {
  const d = document.createElement('div');
  d.className = 'chat-bubble';
  d.innerHTML = html === null
    ? `<div class="bubble-av">🤖</div><div class="bubble-body"><div class="typing-dots"><span></span><span></span><span></span></div></div>`
    : `<div class="bubble-av">🤖</div><div class="bubble-body">${html}</div>`;
  area.appendChild(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return d;
}
function replaceAIBubble(bubble, html) {
  bubble.querySelector('.bubble-body').innerHTML = html;
}
function addUserBubble(area, text) {
  const d = document.createElement('div');
  d.className = 'chat-bubble user';
  d.innerHTML = `<div class="bubble-av u">👤</div><div class="bubble-body">${ui.escapeHtml(text)}</div>`;
  area.appendChild(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// ─── 새 검색 ─────────────────────────
function resetSearch() {
  S.step = 0;
  S.main = null;
  S.task = null;
  S.elecType = '';
  S.vars = {};
  S.extraDesc = '';
  S.userArts = [];
  S._lastResults = null;
  _freeFormShown = false;
  ui.renderMainCats(S, selMain);
  ui.slide(0);
  ui.updateStepBar(0);
  ui.updateBreadcrumb(S, goStep);
  ui.closeSidebar();
}

// ─── 히스토리 ─────────────────────────
function saveHist(verdict) {
  const item = {
    id: Date.now(),
    date: new Date().toLocaleString('ko-KR'),
    main: S.main,
    task: S.task,
    elecType: S.elecType,
    verdict: verdict?.label || '미분류',
  };
  const h = JSON.parse(localStorage.getItem('elaw_hist') || '[]');
  h.unshift(item);
  if (h.length > 50) h.pop();
  localStorage.setItem('elaw_hist', JSON.stringify(h));
  renderHist();
}

function renderHist() {
  const h = JSON.parse(localStorage.getItem('elaw_hist') || '[]');
  const vc = { '합법': '#E1F5EE', '위법': '#FEE', '조건부': '#FEF3C7', '단순절차': '#EFF6FF', '미분류': '#F3F4F6' };
  const list = document.getElementById('histList');
  if (!list) return;
  list.innerHTML = h.length ? h.map(x => `
    <div class="hist-item">
      <div class="hist-date">${x.date}</div>
      <div class="hist-info">${x.main || ''} › ${x.task || ''}</div>
      <div class="hist-v" style="background:${vc[x.verdict] || '#F3F4F6'}">${x.verdict}</div>
    </div>
  `).join('') : '<div style="padding:16px;font-size:12px;color:var(--text3);text-align:center">히스토리 없음</div>';
}

// ─── 제출 버튼 바인딩 ─────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnSubmit').addEventListener('click', submitQuery);
  document.getElementById('btnBack2').addEventListener('click', () => goStep(1));
  init();
});
