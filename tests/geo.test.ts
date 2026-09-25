import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEASURE_TIMEOUT_MS, startMeasuring, type MeasureUpdate } from '../src/geo';

function fakeGeo() {
  let success: PositionCallback = () => {};
  let failure: PositionErrorCallback | null | undefined;
  const geo = {
    watchPosition: vi.fn((s: PositionCallback, e?: PositionErrorCallback | null) => { success = s; failure = e; return 7; }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  } as unknown as Geolocation;
  const emit = (lat: number, lng: number, accuracy: number) =>
    success({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition);
  const fail = (code: number) => failure?.({ code, PERMISSION_DENIED: 1 } as GeolocationPositionError);
  return { geo, emit, fail };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startMeasuring', () => {
  it('良くなったときだけ reading を出し、20m 以内で done にして止める', () => {
    const { geo, emit } = fakeGeo();
    const updates: MeasureUpdate[] = [];
    startMeasuring(geo, (u) => updates.push(u));
    emit(35, 139, 60);
    emit(35, 139, 80);
    emit(35.1, 139.1, 15);
    expect(updates.map((u) => u.kind)).toEqual(['reading', 'reading', 'done']);
    expect(updates.at(-1)).toEqual({ kind: 'done', best: { lat: 35.1, lng: 139.1, accuracy: 15 } });
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
  });
  it('10秒たったら、その時点の一番よい値で done', () => {
    const { geo, emit } = fakeGeo();
    const updates: MeasureUpdate[] = [];
    startMeasuring(geo, (u) => updates.push(u));
    emit(35, 139, 40);
    vi.advanceTimersByTime(MEASURE_TIMEOUT_MS);
    expect(updates.at(-1)).toEqual({ kind: 'done', best: { lat: 35, lng: 139, accuracy: 40 } });
  });
  it('許可されていなければ、設定を促す error', () => {
    const { geo, fail } = fakeGeo();
    const updates: MeasureUpdate[] = [];
    startMeasuring(geo, (u) => updates.push(u));
    fail(1);
    expect(updates).toEqual([{ kind: 'error', message: expect.stringContaining('許可') }]);
  });
  it('geolocation が無ければすぐ error', () => {
    const updates: MeasureUpdate[] = [];
    startMeasuring(undefined, (u) => updates.push(u));
    expect(updates[0]).toEqual({ kind: 'error', message: 'この端末では位置情報を使えません。' });
  });
  it('止めた後は何も出さない', () => {
    const { geo, emit } = fakeGeo();
    const updates: MeasureUpdate[] = [];
    const stop = startMeasuring(geo, (u) => updates.push(u));
    stop();
    emit(35, 139, 10);
    vi.advanceTimersByTime(MEASURE_TIMEOUT_MS);
    expect(updates).toEqual([]);
  });
});
