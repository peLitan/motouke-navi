// 画面の「4. Claude で点検した結果(AI の候補)」(F12a)。
// 画面は通信しない。手元のプログラム(tools/claude-check.mjs)が書き出した結果の JSON を、利用者が選んで読み込み、別の欄に出すだけ。
import { renderAiCandidates } from './view.mjs';

const RESULT_FORMAT = 'ai-candidates';

// 結果のファイルの中身を確かめる。おかしければ理由を書いた Error
export function parseAiResult(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('JSON として読めません。'); }
  if (!d || d.format !== RESULT_FORMAT) throw new Error('AI の候補の結果のファイルではありません(format が違います)。');
  if (!Array.isArray(d.candidates)) throw new Error('候補の一覧がありません。');
  const candidates = d.candidates.map((c, i) => {
    if (!c || typeof c.message !== 'string' || !c.message.trim() || typeof c.basis !== 'string' || !c.basis.trim()) throw new Error((i + 1) + ' 件目の候補に、指摘か根拠がありません。');
    return { label: 'AI の候補', file: typeof c.file === 'string' ? c.file : '', message: c.message, basis: c.basis };
  });
  const warnings = Array.isArray(d.warnings) ? d.warnings.map(String) : [];
  return { candidates, warnings };
}

export function loadAiResult(doc, text) {
  const out = doc.getElementById('ai-result');
  const status = doc.getElementById('ai-status');
  try {
    const r = parseAiResult(text);
    out.innerHTML = renderAiCandidates(r.candidates, r.warnings);
    if (status) status.textContent = 'AI の候補を ' + r.candidates.length + ' 件読み込みました。';
  } catch (e) {
    if (status) status.textContent = '読み込めませんでした: ' + e.message;
  }
}

export function startAi(doc) {
  const file = doc.getElementById('ai-load');
  if (!file) return;
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    loadAiResult(doc, await f.text());
    file.value = '';
  });
}
