# 配布とホスト対応

新しい `plugin-vantage-point` が正本。旧 `claude-plugin-*` は凍結した参照元。

| ホスト | 入口 | 確認範囲 |
|---|---|---|
| Claude Code | .claude-plugin/plugin.json | 構造検証、共通テスト。実セッション確認待ち |
| Codex | .codex-plugin/plugin.json（`hooks` → `hooks/codex-hooks.json`） | 共通 skills・command hooks、構造検証。codex 0.159.2 で hooks の読み込みを実走確認 |
| Grok CLI | Claude 互換形式 | 実機確認待ち |

`hooks/hooks.json` の `modules`（Claude Mods = function hooks、`hooks/vp-mod.ts`）は **Claude Code 専用**で、`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` のときだけ読まれる。**Codex は `modules` を無視しない** — hooks.json のパーサが `deny_unknown_fields`（`description` / `hooks` のみ）で、`unknown field \`modules\`` の parse issue になり、その file の hook が全部読まれない（codex 0.159.2、`/hooks` と `codex exec` の warning で実測）。そのため Codex manifest の `hooks` に **`./hooks/codex-hooks.json`**（command hooks だけ、`modules` 無し）を指定する。Codex は manifest に `hooks` があるとデフォルトの `hooks/hooks.json` を読まない（codex-rs `core-plugins/src/loader.rs::load_plugin_hooks`）。二つの file の `hooks` の中身は `tests/test_distribution.py` が同一であることを検査する。Codex 側の hook trust は file パスで鍵が変わる（`hooks/codex-hooks.json:…`）ので、更新後は `/hooks` で再 trust が要る。Grok は Claude 互換形式のまま（`modules` の扱いは実機確認待ち）。hooks がある場合はホストの hook 有効化が必要。SessionStart は JSON 入力の cwd を使用し、Python 3 を必要とする。無効な入力は何も出力しない。MCP がある場合、認証・実行許可・接続はホストごとに設定する。インストール済み設定はこの移植では変更しない。

開発は nightly、安定配布は main。両 manifest の version と CHANGELOG を揃え、検証後に main と vX.Y.Z を公開する。ZIP は git archive により追跡済みプラグイン資材だけから作る。

## 移植版の検証（2026-09-06）

共有定義・参照先・manifest 同期のテスト、Claude plugin validator、全共有 skill の quick_validate を通過。hook の cwd と JSON 出力の回帰テストを通過。GitHub の Validate workflow は nightly で成功。ホストへの実インストール・MCP 認証・実セッションの発火確認は未実施。
