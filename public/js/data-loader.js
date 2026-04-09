// ─────────────────────────────────────────────
//  data-loader.js
//  · public/data/*.json 자동 fetch
//  · 실패 시 사용자 업로드 폴백
//  · QA 데이터 정규화 (work_types/articles → tags.*)
// ─────────────────────────────────────────────

import { CFG } from './config.js';

const FILES = [
  { key: 'qaData',   path: 'nec_qa.json',    label: '유권해석 DB',   normalize: normalizeQA },
  { key: 'lawsText', path: 'laws_text.json', label: '실무안내서',   normalize: x => x },
  { key: 'lawIndex', path: 'law_index.json', label: '법령 인덱스',  normalize: x => x },
];

export async function loadAll(state, onProgress) {
  for (const f of FILES) {
    onProgress?.(f.key, 'loading');
    try {
      const r = await fetch(CFG.data_path + f.path);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const raw = await r.json();
      state[f.key] = f.normalize(raw);
      onProgress?.(f.key, 'ok', state[f.key]);
    } catch (e) {
      console.warn(`[data] ${f.path} fetch 실패:`, e.message);
      onProgress?.(f.key, 'err', e);
      return false; // 첫 실패 시 업로드 모드로 전환
    }
  }
  return true;
}

function normalizeQA(data) {
  if (!Array.isArray(data)) return [];
  const first = data[0] || {};
  const needsNorm = !first.tags && (first.work_types !== undefined || first.articles !== undefined);
  if (!needsNorm) return data;

  return data.map(qa => {
    const workTypes = Array.isArray(qa.work_types)
      ? qa.work_types
      : (typeof qa.work_types === 'string' && qa.work_types
          ? qa.work_types.split(',').map(s => s.trim())
          : []);
    const articles = Array.isArray(qa.articles)
      ? qa.articles
      : (typeof qa.articles === 'string' && qa.articles
          ? qa.articles.split(',').map(s => s.trim())
          : []);
    let subjs = [];
    if (Array.isArray(qa.variables)) {
      subjs = qa.variables.filter(v => v && v !== '미분류');
    } else if (qa.variables && typeof qa.variables === 'object') {
      subjs = qa.variables['행위주체'] || qa.variables['주체'] || [];
      if (!Array.isArray(subjs)) subjs = [subjs];
    }
    return {
      ...qa,
      conclusion: qa.conclusion || '',
      tags: { '업무유형': workTypes, '주체': subjs, '관련조문': articles },
    };
  });
}

// 사용자 직접 업로드 처리 (fetch 실패 시 폴백)
export function setupUploadFallback(state, onComplete, onProgress) {
  const overlay = document.getElementById('dataOverlay');
  if (!overlay) return;
  overlay.classList.add('upload-mode');

  const uploadHtml = `
    <div class="data-upload">
      ${FILES.map(f => `
        <label class="data-upload-label" data-key="${f.key}">
          <span style="font-size:24px">📂</span>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:var(--text)">${f.label}</div>
            <div style="font-size:11px;color:var(--text3);font-family:var(--mono)">${f.path}</div>
          </div>
          <input type="file" accept=".json" style="display:none" data-key="${f.key}">
        </label>`).join('')}
    </div>
  `;
  overlay.querySelector('.data-upload-mount').innerHTML = uploadHtml;

  overlay.querySelectorAll('input[type=file]').forEach(input => {
    input.addEventListener('change', async ev => {
      const key = ev.target.dataset.key;
      const file = ev.target.files[0];
      if (!file) return;
      const meta = FILES.find(f => f.key === key);
      onProgress?.(key, 'loading');
      try {
        const text = await file.text();
        const raw = JSON.parse(text);
        state[meta.key] = meta.normalize(raw);
        onProgress?.(key, 'ok', state[meta.key]);
        if (FILES.every(f => state[f.key])) onComplete?.();
      } catch (e) {
        onProgress?.(key, 'err', e);
      }
    });
  });
}
