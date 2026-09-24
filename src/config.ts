/**
 * 1本のルートに含められる地点数の上限。
 *
 * Google Maps URLs の公式の waypoints 上限は、モバイルブラウザで3件、それ以外で9件。
 * 当初は確実に動く5件にしていたが、実機のスマホ版Googleマップで経由地6件以上が
 * 出せることを確認できたため、10件(出発地1 + 経由地8 + 到着地1)にした。
 * 1ルートの上限(MAX_STOPS_PER_ROUTE)を超えた分は、routeSplitter が自動で複数のルートに分ける。
 * 実機で経由地が出ない場合は5に戻す。ここ以外に上限を書かないこと。
 */
export const MAX_STOPS_PER_ROUTE = 10;

/** 一度に選択できる患者の上限。 */
export const MAX_SELECTION = 30;
