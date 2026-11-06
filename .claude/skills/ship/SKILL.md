---
name: ship
description: 打包未簽名 IPA 或查 CI 結果，並用最少的輸出回報。要打包、下載 IPA、確認 CI 是否通過，或 CI 失敗要看錯誤時使用。
---

# 打包與查 CI

所有 `gh` 指令都要加 `--repo mrhaibaoseal-lang/octagon-cards`（此環境的 `gh` 找不到 git）。以下用 `$R` 代表這個參數。只用標準 runner，不觸發任何可能計費的服務。

## 打包 IPA

先確認要打包的 commit 已 push，再觸發：

```bash
gh workflow run build-unsigned-ipa.yml $R
```

等幾秒後取得 run id，並確認 `headSha` 是剛才的 commit：

```bash
gh run list $R --workflow build-unsigned-ipa.yml --limit 1 --json databaseId,headSha,status
```

## 等待結果

用背景指令等待，不要反覆查詢，也不要讓進度畫面進入對話：

```bash
gh run watch <id> $R --exit-status > /dev/null
```

CI 的 workflow 檔是 `ci.yml`，push 到 main 時會自動跑，同樣用 `gh run list` 取得 id 後等待。

## 失敗時

只看最後 40 行，不要整份貼出：

```bash
gh run view <id> $R --log-failed | tail -n 40
```

## 成功時

檢查 App 層有沒有編譯警告：

```bash
gh run view <id> $R --log | grep "warning:" | grep "App/Sources" | head -n 20
```

下載前先刪掉舊的 `dist/OctagonCards-unsigned-ipa/`（這是可重新下載的產物），再下載：

```bash
gh run download <id> $R --dir dist
```

回報：run id、結果、測試數（CI 才有）、App 層警告數、IPA 路徑與版本。
