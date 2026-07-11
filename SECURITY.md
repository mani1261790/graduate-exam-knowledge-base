# Security Policy

## Reporting a vulnerability

認証回避、権限昇格、セッション漏えい、秘密情報の露出などを発見した場合は、公開Issueへ詳細を書かず、GitHubのPrivate vulnerability reportingから報告してください。

報告には、影響範囲、再現手順、確認した環境を含めてください。修正と公開が完了するまで、脆弱性の詳細は非公開にしてください。

## Secrets

本番のCloudflare認証情報、データベースID、ユーザー認証情報をリポジトリへcommitしないでください。GitHub ActionsではSecretsを使用し、ローカル設定は `.gitignore` 対象のファイルへ保存します。
