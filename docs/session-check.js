// 每次使用者送出訊息時由 hook 執行（.claude/settings.json 的 UserPromptSubmit）：
// 讀這個對話紀錄最後一次呼叫的大小，印一行給模型，讓它在回覆最後提醒要不要開新 session。
// 手動測試：node docs/session-check.js <對話紀錄.jsonl>
const fs = require('fs');

const REMIND = 150000; // 超過：建議這件事做完就開新的
const URGENT = 250000; // 超過：建議現在就收工開新的
const TAIL = 512 * 1024; // 只讀檔尾，長對話的紀錄可能有幾十 MB

function lastContext(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      try {
        const u = JSON.parse(lines[i]).message.usage;
        const n = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        if (n > 0) return n;
      } catch { /* 檔尾第一行可能被切斷，跳過 */ }
    }
  } finally {
    fs.closeSync(fd);
  }
  return 0;
}

function main() {
  let file = process.argv[2];
  if (!file) {
    try { file = JSON.parse(fs.readFileSync(0, 'utf8')).transcript_path; } catch { return; }
  }
  if (!file || !fs.existsSync(file)) return;
  const n = lastContext(file);
  if (!n) return;
  const k = Math.round(n / 1000);
  let advice = '還不大，除非換了不相干的題目，否則繼續用這個';
  if (n >= URGENT) advice = '已經很大，建議現在收工（更新 HANDOFF、commit）後開新的';
  else if (n >= REMIND) advice = '偏大，建議手上這件事做完就開新的';
  console.log(`[session-check] 這個對話目前約 ${k}k tokens（${REMIND / 1000}k 提醒、${URGENT / 1000}k 強烈建議）：${advice}。照 AGENTS.md §1 在回覆最後一行告訴使用者。`);
}

try { main(); } catch { /* 提醒失敗不該擋住使用者的訊息 */ }
