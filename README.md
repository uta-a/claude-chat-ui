# compact-tools

Claude Code のトランスクリプトで、ツール呼び出しと編集の表示を日本語の1行サマリーにまとめる mod。

- テキストを挟まずに続いたツール呼び出しを1行にまとめる（例: `実行済み 3 件のコマンド, 作成 vercel.ts +74 ›`）
- Edit / Write は `編集しました foo.ts +2 -1` の形で、差分ブロックは隠す
- 行をクリックするとそのまとまりを展開する。ctrl+o では従来どおり全表示

## インストール

Claude Code のプロンプトで:

```
/plugin install compact-tools --marketplace uta-a/claude-chat-ui
```

`Add marketplace?` に `y` で答え、スコープを選ぶ。シェルからは:

```sh
claude plugin install compact-tools --marketplace uta-a/claude-chat-ui
```

開発中のフォルダから直接読み込む場合は `claude --plugin-dir /path/to/claude-chat-ui`。

## 開発

```sh
claude plugin validate .
claude plugin test .
```

`.claude-plugin/types/` は Claude Code が mod の読み込み時に書き出す型定義で、git 管理しない。
