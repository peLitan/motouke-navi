// F50b: README の節「業界の構造にどう効くか」に、効かないことと出典がそろっていることを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const section = readme.split('## 業界の構造にどう効くか(効かないことも含めて)')[1]?.split('\n## ')[0] ?? '';

test('節があり、効かないことが4つとも項目で書いてある', () => {
  assert.ok(section, '節が無い');
  for (const head of ['受注', '価格', '使う人の選別', '安全の実務']) {
    assert.match(section, new RegExp(`^- ${head}: `, 'm'), head);
  }
});

test('F50a の条と結果の節の名前が書いてある', () => {
  for (const s of ['第20条第6項', '第25条の27第2項', '第2条第5項', '労務費と処遇の確認(確認が要る候補)']) {
    assert.ok(section.includes(s), s);
  }
});

test('節の国の資料が「データと出典」の表に取得日つきで載っている', () => {
  const sources = readme.split('## データと出典')[1].split('\n## ')[0];
  for (const id of ['001971681', '001971712', '001760946', '001984988']) {
    assert.match(sources, new RegExp(`/${id}\\.pdf \\| \\d{4}-\\d{2}-\\d{2} \\|`), id);
  }
});
