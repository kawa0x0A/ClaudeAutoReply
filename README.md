# autoreply

Claude の返答が終わるたびに、Haiku が「次に送るべきプロンプト」を1つ書きます。それをプロンプトの上に3秒表示してから自動で送信する Claude Code の mod です。

- 連続5回まで送信したら止まり、あなたの入力を待ちます（自分で入力するとカウントが戻ります）。回数はプロンプト上部の帯の「上限」から 1・3・5・10・20・30・50 回を選ぶか、「−」「+」ボタンで1ずつ、または `/autoreply max 10` のように 1〜50 で変えられ、次のセッションにも引き継がれます
- 3秒のあいだに Esc、表示中の「キャンセル」ボタン、またはプロンプト欄への入力でキャンセルできます
- プロンプト上部の帯に常に出ている「autoreply: ON / OFF」ボタンを押すか、`/autoreply on` / `/autoreply off` で切り替えます。`/autoreply` だけなら状態を表示します。初期値は OFF で、切り替えた状態は次のセッションにも引き継がれます
- サブエージェントのターンでは動きません
- 作業が終わっているとき、あなたにしか答えられない質問が出ているとき、危険な操作が続くときは、Haiku が送信せずに止めます

## ⚠️ 使う前に

- **自動送信されるプロンプトは「あなたの発言」として扱われます。** Haiku は直近の会話（読み込んだファイルや Web ページの内容が含まれることもあります）をもとに次のプロンプトを書くため、会話に悪意のある文章が混ざっていると、それに誘導された指示が上限回数まで自動で送られる可能性があります。
- **危険な操作を止める仕組みは、Haiku の判断だけです。** auto モードや bypassPermissions など、確認なしでツールが実行される権限モードと組み合わせると、意図しない操作が続けて実行されるおそれがあります。権限確認が出るモードで使うことをおすすめします。
- 信頼できないリポジトリや Web ページを扱う作業では OFF にしてください。

## インストール

Claude Code で次を実行します:

```sh
claude plugin marketplace add kawa0x0A/ClaudeAutoReply
claude plugin install autoreply@kawa0x0a
```

Claude Code の中から入れる場合は、プロンプトに次を入力します:

```
/plugin marketplace add kawa0x0A/ClaudeAutoReply
/plugin install autoreply@kawa0x0a
```

デスクトップアプリの場合は、プロンプト横の + → Plugins → Add marketplace で `kawa0x0A/ClaudeAutoReply` を追加し、Add plugin から autoreply を入れます。

インストールしたら、プロンプト上部の「autoreply: OFF」ボタンを押すか `/autoreply on` で有効になります。

### 手元で試す・改造する

```sh
git clone https://github.com/kawa0x0A/ClaudeAutoReply.git
claude --plugin-dir ./ClaudeAutoReply
```

ファイルを編集したら `/reload-plugins` で反映されます。

## 補足

- mod（`hooks/hooks.json` の `modules`）に対応した Claude Code が必要です。
- Esc はカウントダウン用の小さなパネルで受け取ります。端末幅がおおむね144列未満だとパネルが出ず、プロンプト上部の帯に表示されます。その場合も「キャンセル」ボタンかプロンプト欄への入力でキャンセルできます。
- Haiku の呼び出しには、普段の Claude Code と同じアカウント・使用量が使われます。
- テストは `tests/autoreply.test.ts` にあります（mod のテスト実行に対応した Claude Code で実行してください）。

## ライセンス

[MIT](LICENSE)
