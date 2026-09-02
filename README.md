# ルート自動入力

登録した患者の住所を訪問順に並べ、Googleマップの経路画面へ渡すWebアプリ(PWA)です。
iPadのSafariで開き、ホーム画面に追加して使います。

## データの扱い

- 患者データはiPadのブラウザ内(IndexedDB)にのみ保存されます。サーバーへは送信しません。
- GitHubに公開されるのはアプリの画面だけで、患者データは含まれません。
- Safariの「Webサイトデータを消去」を行うとデータは消えます。設定画面から定期的にエクスポートしてください。

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm run test       # テスト
npm run typecheck  # 型チェック
npm run build      # 本番ビルド
npm run icons      # assets/icon.svg から PWA アイコンを生成
```

## 公開の手順(初回のみ)

1. github.com で `route-auto-input` という名前のリポジトリを作る。
   **無料アカウントでGitHub Pagesを使うにはPublic(公開)にする必要がある。**
   公開されるのはアプリのコードだけで、患者データは含まれない。
2. 手元のリポジトリを繋いで push する。

   ```bash
   git branch -M main
   git remote add origin https://github.com/<GitHubユーザー名>/route-auto-input.git
   git push -u origin main
   ```

3. GitHubのリポジトリ → Settings → Pages → Build and deployment → Source を
   **GitHub Actions** に変更する。
4. Actions タブでデプロイの完了を待つ。
5. `https://<GitHubユーザー名>.github.io/route-auto-input/` が公開URL。

以降は `main` に push するたびに自動で公開される。

## iPadへの導入

1. SafariでREADMEの公開URLを開く。
2. 共有ボタン → 「ホーム画面に追加」。
3. ホーム画面のアイコンから起動する。

## 経由地の上限について

Googleマップの公式仕様では、経路URLの経由地の上限は
「モバイルブラウザで3件、それ以外で9件」と、リンクを開く環境によって変わる。

本アプリは確実に動く 5地点(出発地1 + 経由地3 + 到着地1)を1ルートの上限とし、
それを超える人数を選んだ場合はルートを自動で分割する。

上限は `src/config.ts` の `MAX_STOPS_PER_ROUTE` だけで決まる。
下の実機テストで経由地9件が通ることを確認できたら、この値を `10` に変えると
10人が1本のルートで開くようになる。

## 実機テスト(iPadで一度行う)

- [ ] Safariで公開URLを開き、「ホーム画面に追加」ができる
- [ ] ホーム画面のアイコンから起動し、氏名・住所を登録できる
- [ ] Safariを完全に終了して再起動してもデータが残っている
- [ ] 2人を選び、順番を入れ替えて、Googleマップが正しい経路で開く
- [ ] **10人を選び、分割されたルートがそれぞれ正しく開く**(本数は`MAX_STOPS_PER_ROUTE`により変わる)
- [ ] **経由地9件のURLを直接Safariに貼り付け、11地点の経路が表示できるか確認する**
      (表示できたら `MAX_STOPS_PER_ROUTE` を10に変更し、10人が1本で開くことを再確認する)
- [ ] Googleマップアプリを削除した状態でもWeb版が開く
- [ ] エクスポートしたファイルをインポートし直すと同じ一覧に戻る
- [ ] 機内モードでもアプリの画面自体は開く

## ドキュメント

- 設計: `docs/superpowers/specs/2026-09-02-route-auto-input-design.md`
- 実装計画: `docs/superpowers/plans/2026-09-02-route-auto-input.md`
