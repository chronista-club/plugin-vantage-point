# 配布とホスト対応

新しい `plugin-vantage-point` が正本。旧 `claude-plugin-*` は凍結した参照元。

| ホスト | 入口 | 確認範囲 |
|---|---|---|
| Claude Code | .claude-plugin/plugin.json | 構造検証、共通テスト。実セッション確認待ち |
| Codex | .codex-plugin/plugin.json | 共通 skills・command hooks、構造検証。実セッション確認待ち |
| Grok CLI | Claude 互換形式 | 実機確認待ち |

hooks がある場合はホストの hook 有効化が必要。SessionStart は JSON 入力の cwd を使用し、Python 3 を必要とする。無効な入力は何も出力しない。MCP がある場合、認証・実行許可・接続はホストごとに設定する。インストール済み設定はこの移植では変更しない。

開発は nightly、安定配布は main。両 manifest の version と CHANGELOG を揃え、検証後に main と vX.Y.Z を公開する。ZIP は git archive により追跡済みプラグイン資材だけから作る。
