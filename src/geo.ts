import { GOOD_ACCURACY_M } from './geoPoint';

export type Reading = { lat: number; lng: number; accuracy: number };
export type MeasureUpdate =
  | { kind: 'reading'; best: Reading }          // より良い値が来るたび
  | { kind: 'done'; best: Reading | null }      // 10秒たった / 20m 以内になった
  | { kind: 'error'; message: string };

export const MEASURE_TIMEOUT_MS = 10_000;

const PERMISSION_DENIED_MESSAGE =
  '位置情報の使用が許可されていません。端末やブラウザの設定で、このサイトの位置情報を許可してください。';
const OTHER_ERROR_MESSAGE = '位置を取得できませんでした。車の外や屋外で、もう一度試してください。';
const NO_GEOLOCATION_MESSAGE = 'この端末では位置情報を使えません。';

/** 測り始める。戻り値の関数で止める。geolocation が無ければすぐ error。 */
export function startMeasuring(
  geolocation: Geolocation | undefined,
  onUpdate: (update: MeasureUpdate) => void,
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = { setTimeout, clearTimeout },
): () => void {
  if (!geolocation) {
    onUpdate({ kind: 'error', message: NO_GEOLOCATION_MESSAGE });
    return () => {};
  }

  let stopped = false;
  let best: Reading | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    geolocation.clearWatch(watchId);
    timers.clearTimeout(timeoutId);
  };

  const finish = () => {
    if (stopped) return;
    stop();
    onUpdate({ kind: 'done', best });
  };

  const handleSuccess: PositionCallback = (position) => {
    if (stopped) return;
    const reading: Reading = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
    if (best !== null && reading.accuracy >= best.accuracy) return;
    best = reading;
    onUpdate({ kind: 'reading', best });
    if (reading.accuracy <= GOOD_ACCURACY_M) {
      finish();
    }
  };

  const handleError: PositionErrorCallback = (error) => {
    if (stopped) return;
    // すでに良い値を持っているなら、一時的な失敗(車が少し動いた、電波が瞬間途切れたなど)で
    // それまでの結果を無駄にしない。エラーにせず、その値のままdoneにして読み終わる。
    if (best !== null) {
      finish();
      return;
    }
    stop();
    const message = error.code === error.PERMISSION_DENIED ? PERMISSION_DENIED_MESSAGE : OTHER_ERROR_MESSAGE;
    onUpdate({ kind: 'error', message });
  };

  const watchId = geolocation.watchPosition(handleSuccess, handleError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: MEASURE_TIMEOUT_MS,
  });
  const timeoutId = timers.setTimeout(finish, MEASURE_TIMEOUT_MS);

  return stop;
}
