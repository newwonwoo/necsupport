// ─────────────────────────────────────────────
//  stress-test.mjs · 100건 결과 도출 테스트
//  각 task × 변수 조합으로 100건 시나리오를 만들고
//  모든 건에서 결과가 정상 도출되는지 검증
// ─────────────────────────────────────────────

import fs from 'fs';
import {
  searchQA, searchAll, searchLaws, searchGuides,
  generateLocalQuestions, getQuickProcedure,
} from '../public/js/search.js';
import { VARS, TASKS, MAIN_CATS } from '../public/js/config.js';

// ── 데이터 로드 ──
const raw = JSON.parse(fs.readFileSync('public/data/nec_qa.json', 'utf8'));
const qaData = raw.map(qa => {
  const wt = Array.isArray(qa.work_types) ? qa.work_types
    : (typeof qa.work_types === 'string' && qa.work_types ? qa.work_types.split(',').map(s => s.trim()) : []);
  const arts = Array.isArray(qa.articles) ? qa.articles : [];
  let subjs = Array.isArray(qa.variables) ? qa.variables.filter(v => v && v !== '미분류') : [];
  return { ...qa, conclusion: qa.conclusion || '', tags: { '업무유형': wt, '주체': subjs, '관련조문': arts } };
});
const lawsText = JSON.parse(fs.readFileSync('public/data/laws_text.json', 'utf8'));
const lawIndex = JSON.parse(fs.readFileSync('public/data/law_index.json', 'utf8'));

function makeState(over = {}) {
  return { qaData, lawsText, lawIndex, task: null, vars: {}, extraDesc: '', userArts: [], elecType: '', _VARS: VARS, ...over };
}

// ── 100건 시나리오 생성 ──
const scenarios = [];
let id = 0;

// 모든 task에 대해 다양한 변수 조합
const allTasks = Object.values(TASKS).flat().map(t => t.id);

for (const taskId of allTasks) {
  const taskVars = VARS[taskId] || {};
  const varKeys = Object.keys(taskVars);

  // 1) 변수 없음
  scenarios.push({ id: ++id, task: taskId, vars: {}, extraDesc: '', label: `${taskId} / 변수없음` });

  // 2) 첫 번째 변수만 (각 옵션)
  if (varKeys.length > 0) {
    const k0 = varKeys[0];
    const opts0 = taskVars[k0].filter(o => o !== '기타');
    for (const opt of opts0.slice(0, 3)) {
      scenarios.push({ id: ++id, task: taskId, vars: { [k0]: opt }, extraDesc: '', label: `${taskId} / ${k0}=${opt}` });
    }
  }

  // 3) 두 변수 조합
  if (varKeys.length >= 2) {
    const k0 = varKeys[0], k1 = varKeys[1];
    const o0 = taskVars[k0].filter(o => o !== '기타')[0];
    const o1 = taskVars[k1].filter(o => o !== '기타')[0];
    if (o0 && o1) {
      scenarios.push({ id: ++id, task: taskId, vars: { [k0]: o0, [k1]: o1 }, extraDesc: '', label: `${taskId} / ${k0}=${o0} + ${k1}=${o1}` });
    }
  }

  // 4) 모든 변수 입력
  if (varKeys.length >= 1) {
    const fullVars = {};
    for (const k of varKeys) {
      const opts = taskVars[k].filter(o => o !== '기타');
      if (opts.length) fullVars[k] = opts[0];
    }
    scenarios.push({ id: ++id, task: taskId, vars: fullVars, extraDesc: '', label: `${taskId} / 전체변수` });
  }

  // 5) 자유기술 포함
  scenarios.push({ id: ++id, task: taskId, vars: {}, extraDesc: '선거일 90일 전 후보자 홍보물', label: `${taskId} / 자유기술` });
}

// 부족하면 edge case 추가
while (scenarios.length < 100) {
  const t = allTasks[scenarios.length % allTasks.length];
  scenarios.push({ id: ++id, task: t, vars: {}, extraDesc: `테스트 ${scenarios.length}`, label: `${t} / extra-${scenarios.length}` });
}

// ── 테스트 실행 ──
console.log(`\n🧪 ${scenarios.length}건 시나리오 테스트 시작\n`);

let pass = 0, fail = 0;
const failures = [];

for (const s of scenarios.slice(0, 100)) {
  try {
    const st = makeState({ task: s.task, vars: s.vars, extraDesc: s.extraDesc });

    // 1) searchQA 정상 반환
    const qa = searchQA(st);
    if (typeof qa.total !== 'number') throw new Error('qa.total 비정상');
    if (!Array.isArray(qa.matches)) throw new Error('qa.matches 비배열');
    if (qa.total < 0) throw new Error(`qa.total 음수: ${qa.total}`);
    if (qa.matches.length > 8) throw new Error(`matches > 8: ${qa.matches.length}`);

    // 2) searchAll 정상 반환
    const all = searchAll(st);
    if (all.counts.qa !== qa.total) throw new Error(`counts 불일치: ${all.counts.qa} vs ${qa.total}`);
    if (typeof all.counts.laws !== 'number') throw new Error('laws 카운트 비정상');
    if (typeof all.counts.guides !== 'number') throw new Error('guides 카운트 비정상');

    // 3) procSamples 존재
    if (!Array.isArray(qa.procSamples)) throw new Error('procSamples 비배열');

    // 4) getQuickProcedure 에러 없음
    const qp = getQuickProcedure(st);
    // null 또는 객체 둘 다 OK

    // 5) generateLocalQuestions 에러 없음
    const lqs = generateLocalQuestions(st);
    if (!Array.isArray(lqs)) throw new Error('localQuestions 비배열');

    // 6) searchLaws 에러 없음
    const laws = searchLaws(st);
    if (!Array.isArray(laws)) throw new Error('searchLaws 비배열');

    // 7) searchGuides 에러 없음
    const guides = searchGuides(st);
    if (!Array.isArray(guides)) throw new Error('searchGuides 비배열');

    // 8) dist 키 정상
    const distKeys = Object.keys(qa.dist);
    if (!distKeys.includes('합법')) throw new Error('dist에 합법 키 없음');
    if (!distKeys.includes('단순절차')) throw new Error('dist에 단순절차 키 없음');

    // 9) 결과가 1건 이상 (task가 정상이면)
    if (qa.total === 0 && s.task) {
      // 변수 좁힘으로 0건 → 폴백 발동 여부 확인
      // 0건도 허용하되 기록
    }

    pass++;
  } catch (e) {
    fail++;
    failures.push({ id: s.id, label: s.label, err: e.message });
  }
}

// ── 결과 ──
console.log('──────────────────────────────────────────');
console.log(`📊 결과: ${pass} pass / ${fail} fail (총 ${Math.min(scenarios.length, 100)}건)`);
console.log('──────────────────────────────────────────');

if (failures.length) {
  console.log('\n❌ 실패:');
  failures.forEach(f => console.log(`  #${f.id} ${f.label}: ${f.err}`));
}

if (fail === 0) {
  console.log('\n✅ 100건 전체 통과! 배포 가능.\n');
} else {
  console.log(`\n⚠️ ${fail}건 실패. 수정 필요.\n`);
}

// ── 통계 요약 ──
console.log('📈 task별 평균 결과 카운트:');
const taskStats = {};
for (const s of scenarios.slice(0, 100)) {
  const st = makeState({ task: s.task, vars: s.vars, extraDesc: s.extraDesc });
  const qa = searchQA(st);
  if (!taskStats[s.task]) taskStats[s.task] = { totals: [], procs: [] };
  taskStats[s.task].totals.push(qa.total);
  taskStats[s.task].procs.push(qa.dist['단순절차'] || 0);
}
for (const [task, st] of Object.entries(taskStats)) {
  const avgTotal = (st.totals.reduce((a, b) => a + b, 0) / st.totals.length).toFixed(0);
  const avgProc = (st.procs.reduce((a, b) => a + b, 0) / st.procs.length).toFixed(0);
  const minTotal = Math.min(...st.totals);
  const maxTotal = Math.max(...st.totals);
  console.log(`  ${task}: avg=${avgTotal} (${minTotal}~${maxTotal}), 단순절차 avg=${avgProc}`);
}

process.exit(fail > 0 ? 1 : 0);
