// 開工摘要：印出 docs/TASKS.md 的「目前」一節和 docs/HANDOFF.md 最新一筆。
// 用法：node docs/brief.js
const fs = require('fs');
const path = require('path');

function section(file, pick) {
  const lines = fs.readFileSync(path.join(__dirname, file), 'utf8').split(/\r?\n/);
  const start = lines.findIndex(pick);
  if (start < 0) return '';
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n').trim();
}

console.log('# 開工摘要（TASKS 目前 ＋ HANDOFF 最新一筆）\n');
console.log(section('TASKS.md', l => /^## 目前/.test(l)));
console.log('\n# HANDOFF 最新一筆');
console.log(section('HANDOFF.md', l => /^## \d{4}-/.test(l)));
