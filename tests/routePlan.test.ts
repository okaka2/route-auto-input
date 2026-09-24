import { describe, expect, it } from 'vitest';
import { buildRoutePlans, officeStopCount, stopsPerRoute, type Office, type RouteEnds } from '../src/routePlan';

const office: Office = { name: '事業所', address: '東京都中央区0-0-0' };
const stops = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, address: `住所${i + 1}` }));
const ends = (start: RouteEnds['start'], end: RouteEnds['end']): RouteEnds => ({ start, end });

describe('officeStopCount / stopsPerRoute', () => {
  it('事業所を出発と帰着に使えば2地点ぶん減る', () => {
    expect(officeStopCount(ends('office', 'office'), office)).toBe(2);
    expect(stopsPerRoute(ends('office', 'office'), office, 10)).toBe(8);
  });
  it('現在地から/最後の訪問先で終わるなら減らない', () => {
    expect(stopsPerRoute(ends('current', 'last'), office, 10)).toBe(10);
    expect(stopsPerRoute(ends('first', 'last'), null, 10)).toBe(10);
  });
  it('事業所が未登録なら office の指定は無視する', () => {
    expect(officeStopCount(ends('office', 'office'), null)).toBe(0);
  });
});

describe('buildRoutePlans', () => {
  it('事業所から出て事業所へ戻る1本のルート', () => {
    const [plan] = buildRoutePlans(stops(3), ends('office', 'office'), office, 10);
    expect(plan!.addresses).toEqual([office.address, '住所1', '住所2', '住所3', office.address]);
    expect(plan!.fromCurrentLocation).toBe(false);
    expect(plan!.startLabel).toBe('事業所から');
    expect(plan!.endLabel).toBe('事業所へ戻る');
  });
  it('現在地から出発なら1本目だけ fromCurrentLocation で、事業所の住所は先頭に足さない', () => {
    const plans = buildRoutePlans(stops(12), ends('current', 'office'), office, 10);
    expect(plans).toHaveLength(2);
    expect(plans[0]!.fromCurrentLocation).toBe(true);
    expect(plans[0]!.addresses[0]).toBe('住所1');
    expect(plans[1]!.fromCurrentLocation).toBe(false);
    expect(plans[1]!.addresses.at(-1)).toBe(office.address);
    expect(plans[0]!.addresses.at(-1)).not.toBe(office.address);
  });
  it('分割の境目は前後のルートに重なり、事業所ぶんだけ訪問先が減る', () => {
    const plans = buildRoutePlans(stops(9), ends('office', 'office'), office, 10);
    expect(plans).toHaveLength(2);
    expect(plans[0]!.stops.map((s) => s.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    expect(plans[1]!.stops.map((s) => s.id)).toEqual(['p8', 'p9']);
    expect(plans[0]!.addresses).toHaveLength(9);
    expect(plans[1]!.addresses).toEqual(['住所8', '住所9', office.address]);
  });
  it('1件目の訪問先から/最後の訪問先で終わるなら住所だけ', () => {
    const [plan] = buildRoutePlans(stops(2), ends('first', 'last'), office, 10);
    expect(plan!.addresses).toEqual(['住所1', '住所2']);
    expect(plan!.startLabel).toBe('');
    expect(plan!.endLabel).toBe('');
  });
  it('事業所が未登録なら office の指定を無視する', () => {
    const [plan] = buildRoutePlans(stops(2), ends('office', 'office'), null, 10);
    expect(plan!.addresses).toEqual(['住所1', '住所2']);
  });
  it('0件なら空', () => {
    expect(buildRoutePlans([], ends('office', 'office'), office, 10)).toEqual([]);
  });
  it('現在地から出発し事業所へ戻る1本のルートなら、fromCurrentLocationと事業所の住所の両方が付く', () => {
    const [plan] = buildRoutePlans(stops(2), ends('current', 'office'), office, 10);
    expect(plan!.fromCurrentLocation).toBe(true);
    expect(plan!.addresses).toEqual(['住所1', '住所2', office.address]);
  });
});
