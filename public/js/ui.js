// ─────────────────────────────────────────────
//  ui.js · 패널 / 카운트바 / 결과 렌더링
// ─────────────────────────────────────────────

import { MAIN_CATS, TASKS, ELECTION_TYPES, VARS, VERDICT_META, TASK_KEYWORDS } from './config.js';
import { searchAll, searchQA, searchLaws, searchGuides, getQuickProcedure } from './search.js';

// ─── 슬라이드/스텝 (active 토글, transform 없음) ─────────────
export function slide(step) {
  document.querySelectorAll('.slide-panel').forEach((p, i) => {
    p.classList.toggle('active', i === step);
  });
}

export function updateStepBar(step) {
  for (let i = 0; i < 5; i++) {
    const d = document.getElementById('dot' + i);
    if (d) d.className = 'step-dot' + (i < step ? ' done' : '') + (i === step ? ' active' : '');
  }
  for (let i = 0; i < 4; i++) {
    const l = document.getElementById('line' + i + (i + 1));
    if (l) l.className = 'step-line' + (i < step ? ' done' : '');
  }
}

export function updateBreadcrumb(state, onGoStep) {
  const bc = document.getElementById('breadcrumb');
  const p = [];
  if (state.main) {
    const c = MAIN_CATS.find(x => x.id === state.main);
    if (c) p.push(`<span data-step="0">${c.name}</span>`);
  }
  if (state.task) {
    const nm = Object.values(TASKS).flat().find(t => t.id === state.task);
    if (nm) p.push(`<span class="sep">›</span><span data-step="1">${nm.name}</span>`);
  }
  if (state.elecType) {
    const e = ELECTION_TYPES.find(x => x.id === state.elecType);
    if (e) p.push(`<span class="sep">·</span><span style="color:var(--mint)">${e.name}</span>`);
  }
  bc.innerHTML = p.join('');
  bc.querySelectorAll('span[data-step]').forEach(el => {
    el.addEventListener('click', () => onGoStep(parseInt(el.dataset.step)));
  });
}

// ─── 통합 카운트 바 (3가지 자원) ─────────────
export function renderCountBar(containerId, state, hint = '') {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!state.task || !state.qaData) {
    el.innerHTML = `<span class="count-hint">분류를 선택하면 결과 수가 표시됩니다</span>`;
    return;
  }
  const r = searchAll(state);
  el.innerHTML = `
    <span class="count-chip qa"><span class="dot"></span>유권해석 <strong>${r.counts.qa}</strong>건</span>
    <span class="count-chip guide"><span class="dot"></span>실무안내 <strong>${r.counts.guides}</strong>건</span>
    <span class="count-chip law"><span class="dot"></span>관련 조문 <strong>${r.counts.laws}</strong>건</span>
    <span class="count-divider"></span>
    <span class="count-hint">${hint}</span>
  `;
}

// ─── 패널 0: 대분류 ─────────────────────────
export function renderMainCats(state, onSelect) {
  const grid = document.getElementById('electionGrid');
  if (!grid) return;

  const counts = {};
  if (state.qaData) {
    for (const m of MAIN_CATS) {
      const taskIds = (TASKS[m.id] || []).map(t => t.id);
      counts[m.id] = state.qaData.filter(q => {
        const tt = q.tags?.['업무유형'] || [];
        return tt.some(t => taskIds.includes(t));
      }).length;
    }
  }

  grid.innerHTML = MAIN_CATS.map((c, i) => `
    <div class="main-card${i === 1 ? ' main-card-guide' : ''}" data-id="${c.id}">
      <div class="main-card-num">0${i + 1}</div>
      <div class="main-card-icon">${c.icon}</div>
      <div class="main-card-name">${c.name}</div>
      <div class="main-card-desc">${c.desc}</div>
      ${counts[c.id] !== undefined ? `<div class="main-card-counts"><span>유권해석 ${counts[c.id].toLocaleString()}건</span></div>` : ''}
      <div class="main-card-arrow">→</div>
    </div>
  `).join('');

  grid.querySelectorAll('.main-card').forEach(card => {
    card.addEventListener('click', () => onSelect(card.dataset.id));
  });
}

// ─── 패널 1: 세부분류 ─────────────────────────
export function renderTasks(state, onSelect) {
  const tasks = TASKS[state.main] || [];
  const html = tasks.map((t, i) => {
    const counts = state.qaData ? getTaskCounts(state, t.id) : null;
    return `
      <div class="choice-card" data-id="${t.id}" style="animation:fadeUp .3s both;animation-delay:${i * 40}ms">
        <div class="choice-icon">${t.icon}</div>
        <div class="choice-name">${t.name}</div>
        ${counts ? `
          <div class="choice-counts">
            <span class="qa">유권 ${counts.qa}</span>
            <span class="guide">실무 ${counts.guides}</span>
            <span class="law">조문 ${counts.laws}</span>
          </div>` : ''}
      </div>
    `;
  }).join('');

  const g = document.getElementById('taskGrid');
  if (!g) return;
  g.innerHTML = html;
  g.querySelectorAll('.choice-card').forEach(card => {
    card.addEventListener('click', () => onSelect(card.dataset.id));
  });
}

function getTaskCounts(state, taskId) {
  const tempState = { ...state, task: taskId, vars: {} };
  return {
    qa:     state.qaData.filter(q => (q.tags?.['업무유형'] || []).includes(taskId)).length,
    laws:   searchLaws(tempState).length,
    guides: searchGuides(tempState).length,
  };
}

// ─── 패널 2: 변수 입력 (채팅형) ─────────────────
let _varKeys = [], _varIdx = 0;
let _onVarComplete = null;
let _onVarChange = null;

export function startVarChat(state, onComplete, onChange) {
  _onVarComplete = onComplete;
  _onVarChange = onChange;
  const area = document.getElementById('chatVarArea');
  const sw = document.getElementById('varSubmitWrap');
  if (!area) return;
  area.innerHTML = '';
  if (sw) sw.style.display = 'none';
  _varKeys = Object.keys(VARS[state.task] || {});
  _varIdx = 0;

  if (!_varKeys.length) { _showVarSubmit(state); return; }
  setTimeout(() => _nextVarQ(state), 150);
}

function _nextVarQ(state) {
  if (_varIdx >= _varKeys.length) { _showVarSubmit(state); return; }
  const area = document.getElementById('chatVarArea');
  if (!area) return;

  const varKey = _varKeys[_varIdx];
  const opts = VARS[state.task][varKey] || [];
  const counted = opts
    .filter(o => o !== '기타')
    .map(o => ({ val: o, cnt: countVarOption(state, varKey, o) }));

  // 매칭 카운트 기준으로 정렬: 많은 → 적은 → 0건
  counted.sort((a, b) => b.cnt - a.cnt);

  const positive = counted.filter(x => x.cnt > 0);
  const anyPositive = positive.length > 0;
  const isSingle = positive.length === 1;

  const d = document.createElement('div');
  d.className = 'var-bubble';

  // ── 특수 케이스: 매칭 옵션이 1개뿐 ──
  if (isSingle) {
    const only = positive[0];
    d.innerHTML = `
      <div class="var-av">🤖</div>
      <div class="var-body">
        <div><b>${varKey}</b>에 매칭되는 사례가 <b style="color:var(--mint)">${escapeHtml(only.val)}</b> <span style="font-family:var(--mono);color:var(--mint)">${only.cnt}건</span> 뿐이에요.</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px">이걸로 진행할까요? 다른 답이라면 옆 버튼을 눌러주세요.</div>
        <div class="var-pills" style="margin-top:10px">
          <button class="var-pill picked-suggest" data-only="1" data-key="${varKey}" data-val="${escapeAttr(only.val)}">✅ ${escapeHtml(only.val)}로 진행</button>
          <button class="var-show-others" type="button">❌ 다른 답 선택</button>
        </div>
      </div>`;
    area.appendChild(d);
    d.scrollIntoView({ behavior: 'smooth', block: 'end' });
    _bindSingleBubble(state, d, varKey, counted);
    _checkProcedureSnippet(state);
    return;
  }

  // ── 일반 케이스: 옵션 모두 표시 (0건은 예시) ──
  const pillsHtml = counted.map(x => {
    const isZero = x.cnt === 0;
    const ct = x.cnt > 0 ? `<span class="cnt">${x.cnt}</span>` : '';
    const cls = isZero ? ' var-pill-example' : '';
    return `<button class="var-pill${cls}" data-key="${varKey}" data-val="${escapeAttr(x.val)}" title="${isZero ? 'DB 사례 없음 (예시)' : x.cnt + '건 매칭'}">${x.val}${ct}</button>`;
  }).join('');

  const headerHtml = anyPositive
    ? `<div><b>${varKey}</b>이(가) 무엇인가요?</div>
       <div style="font-size:11px;color:var(--text3);margin-top:4px">아래 예시에서 선택하거나 직접 입력해주세요. 숫자는 DB 매칭 건수입니다.</div>`
    : `<div><b>${varKey}</b>이(가) 무엇인가요?</div>
       <div style="font-size:11px;color:var(--amber);margin-top:4px">⚠️ 직접 매칭되는 사례는 없지만, 아래 예시 중 가까운 것을 선택하거나 직접 입력하세요.</div>`;

  d.innerHTML = `
    <div class="var-av">🤖</div>
    <div class="var-body">
      ${headerHtml}
      <div class="var-pills" style="margin-top:10px">${pillsHtml}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="var-free-btn" data-key="${varKey}">✏️ 직접 입력</button>
        <button class="var-skip-btn" data-key="${varKey}">건너뛰기</button>
      </div>
    </div>`;
  area.appendChild(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'end' });
  _bindVarBubble(state, d, varKey);

  // 매 변수 입력 후 단순절차 빠른 답변 체크
  _checkProcedureSnippet(state);
}

// 매칭 1개뿐일 때 바인딩 — "진행" or "다른 답 선택"
function _bindSingleBubble(state, bubble, varKey, counted) {
  bubble.querySelector('[data-only="1"]').addEventListener('click', e => {
    const val = e.currentTarget.dataset.val;
    state.vars[varKey] = val;
    bubble.querySelectorAll('button').forEach(b => b.disabled = true);
    e.currentTarget.classList.add('picked');
    _appendUserBubble(val);
    _varIdx++;
    _onVarChange?.();
    setTimeout(() => _nextVarQ(state), 300);
  });
  bubble.querySelector('.var-show-others').addEventListener('click', () => {
    // 일반 모드로 전환 (같은 버블에 모든 옵션 표시)
    const pillsHtml = counted.map(x => {
      const isZero = x.cnt === 0;
      const ct = x.cnt > 0 ? `<span class="cnt">${x.cnt}</span>` : '';
      const cls = isZero ? ' var-pill-example' : '';
      return `<button class="var-pill${cls}" data-key="${varKey}" data-val="${escapeAttr(x.val)}" title="${isZero ? 'DB 사례 없음 (예시)' : x.cnt + '건 매칭'}">${x.val}${ct}</button>`;
    }).join('');
    const body = bubble.querySelector('.var-body');
    body.innerHTML = `
      <div><b>${varKey}</b>이(가) 무엇인가요?</div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px">아래 예시에서 선택하거나 직접 입력해주세요. 숫자는 DB 매칭 건수입니다.</div>
      <div class="var-pills" style="margin-top:10px">${pillsHtml}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="var-free-btn" data-key="${varKey}">✏️ 직접 입력</button>
        <button class="var-skip-btn" data-key="${varKey}">건너뛰기</button>
      </div>`;
    _bindVarBubble(state, bubble, varKey);
  });
}

function _bindVarBubble(state, bubble, varKey) {
  bubble.querySelectorAll('.var-pill').forEach(b => {
    b.addEventListener('click', () => {
      state.vars[varKey] = b.dataset.val;
      bubble.querySelectorAll('.var-pill').forEach(x => { x.disabled = true; });
      b.classList.add('picked');
      bubble.querySelectorAll('.var-free-btn,.var-skip-btn').forEach(x => x.style.display = 'none');
      _appendUserBubble(b.dataset.val);
      _varIdx++;
      _onVarChange?.();
      setTimeout(() => _nextVarQ(state), 300);
    });
  });
  bubble.querySelectorAll('.var-skip-btn').forEach(b => {
    b.addEventListener('click', () => {
      bubble.querySelectorAll('.var-pill').forEach(x => x.disabled = true);
      bubble.querySelectorAll('.var-free-btn,.var-skip-btn').forEach(x => x.style.display = 'none');
      _varIdx++;
      setTimeout(() => _nextVarQ(state), 200);
    });
  });
  bubble.querySelectorAll('.var-free-btn').forEach(b => {
    b.addEventListener('click', () => {
      const body = bubble.querySelector('.var-body');
      body.querySelectorAll('.var-pills,.var-free-btn,.var-skip-btn').forEach(el => el.style.display = 'none');
      const wrap = document.createElement('div');
      wrap.className = 'var-free-input-wrap';
      wrap.innerHTML = `<input class="var-free-input" placeholder="${varKey} 직접 입력"><button class="var-confirm-btn" data-key="${varKey}">확인</button>`;
      body.appendChild(wrap);
      _bindFreeInput(state, wrap, varKey);
    });
  });
  bubble.querySelectorAll('.var-confirm-btn').forEach(b => {
    _bindFreeInput(state, bubble, varKey);
  });
}

function _bindFreeInput(state, container, varKey) {
  const inp = container.querySelector('.var-free-input');
  const btn = container.querySelector('.var-confirm-btn');
  if (!inp || !btn) return;
  inp.focus();
  const submit = () => {
    const v = inp.value.trim();
    if (!v) return;
    state.vars[varKey] = v;
    inp.disabled = true;
    btn.disabled = true;
    _appendUserBubble(v);
    _varIdx++;
    _onVarChange?.();
    setTimeout(() => _nextVarQ(state), 300);
  };
  btn.addEventListener('click', submit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function _appendUserBubble(text) {
  const area = document.getElementById('chatVarArea');
  if (!area) return;
  const d = document.createElement('div');
  d.className = 'var-bubble user';
  d.innerHTML = `<div class="var-av u">👤</div><div class="var-body">${escapeHtml(text)}</div>`;
  area.appendChild(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function _showVarSubmit(state) {
  const wrap = document.getElementById('varSubmitWrap');
  const area = document.getElementById('chatVarArea');
  if (area) {
    const d = document.createElement('div');
    d.className = 'var-bubble';
    const cnt = Object.values(state.vars).filter(Boolean).length;
    d.innerHTML = `
      <div class="var-av">🤖</div>
      <div class="var-body" style="color:var(--mint-dark)">
        ${cnt > 0 ? cnt + '개 조건이 입력됐습니다. ' : ''}구체적인 상황이나 추가 정보를 자유롭게 입력해주세요. (선택)
        <textarea rows="3" class="extra-desc-input"
          placeholder="예) 후보자가 선거일 90일 전 지역 노인회 모임에서 음료를 제공함"
        >${escapeHtml(state.extraDesc || '')}</textarea>
      </div>`;
    area.appendChild(d);
    const inp = d.querySelector('.extra-desc-input');
    if (inp) {
      inp.addEventListener('input', e => { state.extraDesc = e.target.value; });
    }
  }
  if (wrap) {
    wrap.style.display = 'block';
    setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
  }
  _onVarComplete?.();
}

function countVarOption(state, varKey, optVal) {
  if (!state.qaData) return -1;
  const VARS_DATA = state._VARS;
  const isSubj = ['행위주체', '후원인유형', '지출주체', '주체'].includes(varKey);

  let pool = state.qaData.filter(qa => {
    const tt = qa.tags?.['업무유형'] || [];
    return tt[0] === state.task || tt.includes(state.task);
  });
  for (const [k, v] of Object.entries(state.vars)) {
    if (!v || v === '기타') continue;
    if (['행위주체', '후원인유형', '지출주체', '주체'].includes(k)) {
      const f = pool.filter(qa => (qa.tags?.['주체'] || []).some(s => s.includes(v) || v.includes(s)));
      if (f.length >= 3) pool = f;
    } else {
      const f = pool.filter(qa => ((qa.title || '') + (qa.question || '')).includes(v));
      if (f.length >= 3) pool = f;
    }
  }
  if (isSubj) {
    return pool.filter(qa => (qa.tags?.['주체'] || []).some(s => s.includes(optVal) || optVal.includes(s))).length;
  }
  return pool.filter(qa => ((qa.title || '') + (qa.question || '')).includes(optVal)).length;
}

// ── 변수 입력 중간 단순절차 빠른답변 카드 ──
let _quickShown = false;
function _checkProcedureSnippet(state) {
  if (_quickShown) return;
  const r = searchQA(state);
  if (r.total < 2) return;
  const proc = getQuickProcedure(state);
  if (!proc) return;
  _quickShown = true;

  const area = document.getElementById('chatVarArea');
  if (!area) return;
  const card = document.createElement('div');
  card.className = 'proc-quick-card';
  card.innerHTML = `
    <div class="proc-quick-hd">📋 단순절차로 보입니다</div>
    <div class="proc-quick-title">${escapeHtml(proc.title || '단순절차 안내')}</div>
    <div class="proc-quick-body">${escapeHtml((proc.answer || '').slice(0, 320))}${(proc.answer || '').length > 320 ? '...' : ''}</div>
    <div class="proc-quick-actions">
      <button class="proc-quick-yes">✅ 이게 찾던 답이에요</button>
      <button class="proc-quick-no">❌ 더 자세히 볼게요</button>
    </div>
  `;
  area.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'end' });

  card.querySelector('.proc-quick-yes').addEventListener('click', () => {
    card.querySelectorAll('.proc-quick-actions button').forEach(b => b.disabled = true);
    card.insertAdjacentHTML('beforeend', '<div style="margin-top:10px;font-size:12px;color:var(--mint);font-weight:600">✅ 검색을 종료합니다. 새 검색은 우측 상단 단계 표시를 클릭하세요.</div>');
  });
  card.querySelector('.proc-quick-no').addEventListener('click', () => {
    card.remove();
    _quickShown = false;
  });
}

export function resetVarChatFlags() {
  _quickShown = false;
}

// ─── 결과 렌더링 (탭 형식: 유권해석/실무안내/조문) ──
export function renderResult(state, results, ai) {
  const wrap = document.getElementById('resultWrap');
  if (!wrap) return;

  const verdict = computeVerdict(results.qa, ai);
  const vd = VERDICT_META[verdict.label] || VERDICT_META['미분류'];

  // ── 단순절차 강조 카드 (procSamples 별도 추출, 상위 8건과 독립) ──
  const procMatches = (results.qa.procSamples || []).slice(0, 3);
  const procHtml = procMatches.length ? `
    <div class="proc-section">
      <div class="proc-section-hd">📋 단순절차로 처리되는 유사사례 ${procMatches.length}건</div>
      ${procMatches.map((m, i) => `
        <div class="proc-section-card" data-proc-idx="${i}">
          <div class="proc-section-title">${escapeHtml(m.qa.title || '')}</div>
          <div class="proc-section-body">${escapeHtml((m.qa.answer || '').slice(0, 200))}${(m.qa.answer || '').length > 200 ? '...' : ''}</div>
        </div>
      `).join('')}
    </div>
  ` : '';

  // ── 결과 너무 많을 때 좁힘 안내 ──
  const tooManyHtml = (results.counts.qa >= 30) ? `
    <div class="too-many-banner">
      <div class="too-many-text">
        🔍 결과가 <b>${results.counts.qa}건</b>으로 많아요. 상위 ${results.qa.matches.length}건만 표시 중입니다.
      </div>
      <button class="too-many-btn" id="narrowMoreBtn">+ 더 좁혀서 검색</button>
    </div>
  ` : '';

  let html = `
    <div class="result-header">
      <div class="verdict ${vd.cls}">${vd.label}</div>
      <div class="trust">${verdict.trust}</div>
    </div>

    ${procHtml}
    ${tooManyHtml}

    <div class="res-tabs">
      <button class="res-tab active" data-tab="qa">📚 유권해석 <span class="badge">${results.counts.qa}</span></button>
      <button class="res-tab" data-tab="guide">📋 실무안내 <span class="badge">${results.counts.guides}</span></button>
      <button class="res-tab" data-tab="law">⚖️ 조문 <span class="badge">${results.counts.laws}</span></button>
    </div>

    <div class="res-tab-panel active" id="tab-qa">${renderQATab(results.qa)}</div>
    <div class="res-tab-panel" id="tab-guide">${renderGuideTab(results.guides)}</div>
    <div class="res-tab-panel" id="tab-law">${renderLawTab(results.laws)}</div>

    <div class="answer-check" id="answerCheck">
      <div class="answer-check-label">💬 원하는 답변이 있으신가요?</div>
      <button class="answer-yes" id="answerYesBtn">✅ 있어요</button>
      <button class="answer-no" id="answerNoBtn">❌ 없어요</button>
    </div>
    <div id="suggestSection" style="display:none"></div>
    <div id="aiChatArea" class="chat-area"></div>

    <div class="res-actions">
      <button class="btn-act" data-act="print">📄 PDF</button>
      <button class="btn-act" data-act="copy">📋 복사</button>
      <button class="btn-act" data-act="reset">🔄 새 검색</button>
    </div>
  `;
  wrap.innerHTML = html;

  // 탭 전환
  wrap.querySelectorAll('.res-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.res-tab').forEach(b => b.classList.remove('active'));
      wrap.querySelectorAll('.res-tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      wrap.querySelector('#tab-' + btn.dataset.tab)?.classList.add('active');
    });
  });

  return verdict;
}

export function _renderQATab(qa) { return renderQATab(qa); }
export function _renderGuideTab(g) { return renderGuideTab(g); }
export function _renderLawTab(l) { return renderLawTab(l); }

function renderQATab(qa) {
  if (!qa.matches.length) {
    return `<div class="res-sec" style="text-align:center;padding:32px 16px"><div style="font-size:32px;margin-bottom:10px">🔍</div><div style="font-weight:600;margin-bottom:6px">관련 유권해석이 없습니다</div><div style="font-size:12px;color:var(--text3)">아래 "❌ 없어요" 버튼을 눌러 추가 정보를 입력하면 다시 검색합니다</div></div>`;
  }
  const cards = qa.matches.map((m, i) => {
    const q = m.qa;
    const concl = q.conclusion || '미분류';
    const preview = (q.answer || '').slice(0, 140).replace(/\n/g, ' ');
    return `
      <div class="qa-card match" data-idx="${i}">
        <div class="qa-hd">
          <div class="qa-title">${escapeHtml(q.title || '제목없음')}</div>
          <div class="qa-v ${concl}">${concl}</div>
        </div>
        <div style="font-size:11px;color:var(--text3);margin:6px 0;line-height:1.5">${escapeHtml(preview)}${preview.length >= 140 ? '...' : ''}</div>
        <div style="display:flex;gap:6px;font-size:10px;font-family:var(--mono);color:var(--text3)">
          <span>${q.date || ''}</span>
          ${q.source ? `<span>· ${q.source}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
  return `<div class="res-sec"><div class="res-sec-title">📚 유관 유권해석 ${qa.matches.length}건 (전체 ${qa.total}건 중 상위)</div>${cards}</div>`;
}

function renderGuideTab(guides) {
  if (!guides.length) {
    return `<div class="res-sec" style="text-align:center;padding:32px 16px;color:var(--text3)">관련 실무안내가 없습니다</div>`;
  }
  const cards = guides.map((g, i) => `
    <div class="guide-card" data-idx="${i}">
      <div class="guide-card-hd">
        <span class="guide-book">${escapeHtml(g.book || '')}</span>
        <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">p.${g.page_hint || '-'}</span>
      </div>
      <div class="guide-card-title">${escapeHtml(g.title || '')}</div>
      <div class="guide-card-summary">${escapeHtml(g.summary || '')}</div>
    </div>
  `).join('');
  return `<div class="res-sec"><div class="res-sec-title">📋 관련 실무안내 ${guides.length}건</div>${cards}</div>`;
}

function renderLawTab(laws) {
  if (!laws.length) {
    return `<div class="res-sec" style="text-align:center;padding:32px 16px;color:var(--text3)">관련 조문이 없습니다</div>`;
  }
  const grouped = {};
  for (const a of laws) {
    if (!grouped[a.law]) grouped[a.law] = [];
    grouped[a.law].push(a);
  }
  const html = Object.entries(grouped).map(([law, arts]) => {
    const items = arts.map(a => `
      <div class="law-card" data-law="${escapeAttr(a.law)}" data-art="${escapeAttr(a.article)}">
        <div class="law-card-hd">
          <span class="law-card-name">${escapeHtml(a.law)}</span>
          <span class="law-card-num">${escapeHtml(a.article)} <span style="color:var(--mint);font-weight:600">${a.type}</span></span>
        </div>
        ${a.title ? `<div class="law-card-title">${escapeHtml(a.title)}</div>` : ''}
        ${a.preview ? `<div class="law-card-preview">${escapeHtml(a.preview)}</div>` : ''}
      </div>
    `).join('');
    return items;
  }).join('');
  return `<div class="res-sec"><div class="res-sec-title">⚖️ 관련 조문 ${laws.length}건</div>${html}</div>`;
}

// ── 결론 판정 ──
function computeVerdict(qa, ai) {
  if (ai?.['결론']) return { label: ai['결론'], trust: '🤖 AI 판단' };
  if (!qa.matches.length) return { label: '미분류', trust: '🟠 검색 결과 부족' };

  const concs = qa.matches.map(x => x.qa.conclusion).filter(Boolean);
  if (!concs.length) return { label: '미분류', trust: '🟠 결론 없음' };

  const freq = {};
  concs.forEach(c => freq[c] = (freq[c] || 0) + 1);
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const top = sorted[0][0];

  if (qa.hasConflict) return { label: '조건부', trust: '🔴 결론 충돌' };
  if (qa.maxScore >= 25 && sorted[0][1] >= 2) return { label: top, trust: '🟢 직접일치' };
  if (qa.maxScore >= 15) return { label: top, trust: '🟡 유사일치' };
  return { label: top, trust: '🟠 참고' };
}

// ─── 사이드바 ───────────────────────────────
export function openSidebar(state, law, num) {
  const data = state.lawsText?.laws?.[law] || state.lawsText?.guidebooks?.[law];
  const lawUrl = `https://www.law.go.kr/법령/${encodeURIComponent(law)}`;
  if (!data) {
    // 원문 데이터 없음 → 바로 법제처 새 창으로 열기 (사이드바는 띄우지 않음)
    window.open(lawUrl, '_blank', 'noopener');
    return;
  }
  const art = (data.articles || []).find(a => a.article_num === num);
  if (!art) {
    // 해당 조문 못 찾으면 법령 페이지라도 열기
    window.open(lawUrl, '_blank', 'noopener');
    return;
  }
  document.getElementById('sbLaw').textContent = law;
  document.getElementById('sbArt').textContent = num;
  document.getElementById('sbTit').textContent = art.title ? '(' + art.title + ')' : '';
  document.getElementById('sbBody').textContent = art.text;
  document.getElementById('sidebar').dataset.url = lawUrl;
  document.getElementById('sidebar').classList.add('open');
}

export function showQASidebar(qa) {
  document.getElementById('sbLaw').textContent = '유권해석';
  document.getElementById('sbArt').textContent = qa.conclusion || '';
  document.getElementById('sbTit').textContent = qa.date || '';
  const text = [
    qa.title || '',
    qa.question ? '\n[질의]\n' + qa.question : '',
    qa.answer ? '\n[답변]\n' + qa.answer : '',
  ].filter(Boolean).join('\n');
  document.getElementById('sbBody').textContent = text;
  document.getElementById('sidebar').dataset.url = qa.url || '';
  document.getElementById('sidebar').classList.add('open');
}

export function showGuideSidebar(g) {
  document.getElementById('sbLaw').textContent = g.book || '실무안내';
  document.getElementById('sbArt').textContent = g.title || '제목없음';
  document.getElementById('sbTit').textContent = g.page_hint ? `p.${g.page_hint}` : '';
  const text = [
    g.summary ? '[요약]\n' + g.summary : '',
    g.text ? '\n\n[본문]\n' + g.text : '',
    g.keywords?.length ? '\n\n[키워드]\n' + g.keywords.join(' · ') : '',
  ].filter(Boolean).join('\n').trim() || '본문 없음';
  document.getElementById('sbBody').textContent = text;
  document.getElementById('sidebar').dataset.url = '';
  document.getElementById('sidebar').classList.add('open');
}

export function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
}

// ─── Utils ───────────────────────────────
export function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
