# 院試知識基盤

大学院入試の学習を、大学別のファイル置き場ではなく、分野・類題・学習履歴から辿れるようにするCloudflareベースの演習アプリです。

## リポジトリ構成

このプロジェクトは、公開ソースと本番運用を明確に分けています。

- [`graduate-exam-knowledge-base`](https://github.com/mani1261790/graduate-exam-knowledge-base): 公開ソースコードの正本
- `graduate-exam-knowledge-base-production`（Private）: Cloudflareへの本番デプロイとGitHub Secretsの管理

両リポジトリの `main` には同じ公開可能なコミットを同期します。本番デプロイはPrivate側へのpushで実行され、Secretsや本番データがPublic側へ入ることはありません。

## 主な機能

- 分野・キーワードからの問題探索
- 学習履歴、苦手分野、所属に応じた問題推薦
- 解答記録と復習タイミングの管理
- 問題ごとの手書きキャンバスとAIチャット
- 編集者・レビュー担当者向けの問題／資料管理
- PBKDF2パスワードとHttpOnly Cookieによるログイン

## 技術構成

- React + Vite
- Cloudflare Workers Static Assets
- D1: ユーザー、問題メタデータ、Knowledge Graph、学習履歴、セッション
- R2: PDF／画像アセット（任意）
- Workers AI: 問題コンテキスト付きチャット

## ローカル開発

```bash
npm install
npm run cf-types
npm run db:migrate:local
npm run db:seed:local
npm run dev:worker
```

ローカル設定では `admin@example.com` のサンプル管理者として認証されます。公開リポジトリには実運用ユーザー、パスワードハッシュ、セッション、PDF、抽出済み過去問データは含まれません。

## データの扱い

追跡される `migrations/0002_seed.sql` は、架空の大学・独自に作成したサンプル問題だけを含みます。実在大学の過去問に関する次のデータはGit管理対象外です。

- PDF、画像、OCR／抽出テキスト
- 問題レビュー、ページ範囲、インポートSQL
- 制限付きソースのメタデータ
- 本番D1/R2に保存されたユーザー・学習データ

詳しくは [データポリシー](docs/data-policy.md) を参照してください。

クローラーを使う場合は、次のファイルをローカルで作成します。

```bash
cp data/crawler-targets.example.json data/crawler-targets.json
npm run crawl:sources
```

対象サイトの利用条件・著作権・robotsポリシーを確認し、アクセス制限を回避しないでください。

## 本番設定

本番のアカウントID、D1 ID、ドメイン、管理者メールは追跡しません。テンプレートからローカル設定を生成します。

```bash
cp wrangler.production.example.jsonc wrangler.production.jsonc
# wrangler.production.jsonc のプレースホルダーを自分の環境に合わせて設定
npm run deploy:production
```

CIでは `scripts/render-wrangler-config.mjs` がGitHub ActionsのSecrets／Variablesから一時的に設定を生成します。

## 公開前チェック

```bash
npm run public:check
npm test
npm run build
```

公開へ切り替える前には、現在のツリーだけでなくGit履歴からも内部データを除去する必要があります。手順は [公開チェックリスト](docs/public-release-checklist.md) にまとめています。

## ライセンス

ソースコードと、このリポジトリに明示的に含まれる架空サンプルは [MIT License](LICENSE) です。実在大学の問題・PDF・第三者データには適用されません。
