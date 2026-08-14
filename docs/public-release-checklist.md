# 公開チェックリスト

## 現在のツリー

- `npm run public:check` が成功する
- `npm test` と `npm run build` が成功する
- PDF／抽出データ／実運用設定が追跡されていない
- WorkerにPDF配信用ルートとR2バインディングがなく、公式HTTPS URLだけを保存する
- 有効な資料リンクを実ブラウザで確認し、埋め込み不可の資料は `external_only` にする
- `page_start` / `page_end` が元PDF全体の参照位置として正しいことを確認する
- KnowledgeGraphの固定commit、第三者ライセンス、インポート監査情報を確認する
- GitHub Actionsの本番値はSecrets／Variablesから生成される
- Private vulnerability reportingを有効にする

## Git履歴

現在のツリーから削除したファイルも、過去のcommitには残ります。Publicへ変更する直前に、バックアップを作成したうえで `git filter-repo` などを使い、少なくとも次を全履歴から除去してください。

- `data/crawl/`
- `data/agent-review/`
- `data/open-inshi/`
- `data/crawler-targets.json`
- `wrangler.production.jsonc`
- `wrangler.noema.jsonc`

履歴書き換えはcommit IDを変更し、強制pushが必要です。共同作業者とデプロイへの影響を確認し、明示的な承認を得てから実施します。

## 公開後

- GitHub上でリポジトリのVisibility、License、Security設定を確認する
- 古いcloneやforkに内部データが残っていないか確認する
- 本番URLが公開されても、未認証APIがデータを返さないことを確認する
- 定期的に公式PDFリンクの到達性と公開条件を確認し、失効時は `unavailable` にする
- 旧R2バケットを削除する場合は、公開リンクへの移行とバックアップを確認してから別作業で実施する
