import { describe, expect, it } from 'vitest';
import { accuracyLevel, distanceMeters, isShortMapsUrl, parseLocationText, pointOf } from '../src/geoPoint';

describe('parseLocationText', () => {
  it.each([
    ['35.681240, 139.767120', { lat: 35.68124, lng: 139.76712 }],
    ['35.68124,139.76712', { lat: 35.68124, lng: 139.76712 }],
    [' 35.68124 , 139.76712 ', { lat: 35.68124, lng: 139.76712 }],
    ['https://www.google.com/maps/place/Tokyo/@35.6812405,139.7671248,17z/data=!3m1', { lat: 35.6812405, lng: 139.7671248 }],
    ['https://www.google.com/maps/place/X/data=!4m6!3m5!1s0x0:0x0!8m2!3d35.681!4d139.767', { lat: 35.681, lng: 139.767 }],
    ['https://www.google.com/maps?q=35.1,136.9', { lat: 35.1, lng: 136.9 }],
    ['https://www.google.com/maps/search/?api=1&query=35.1%2C136.9', { lat: 35.1, lng: 136.9 }],
  ])('%s', (text, expected) => {
    expect(parseLocationText(text)).toEqual(expected);
  });
  it('!3d!4d があれば @ より優先する(建物の位置のほうが正確)', () => {
    expect(parseLocationText('https://www.google.com/maps/place/X/@35.0,139.0,17z/data=!3d35.5!4d139.5')).toEqual({ lat: 35.5, lng: 139.5 });
  });
  it.each(['東京都千代田区', 'https://maps.app.goo.gl/AbCd', '999, 999', '', '35.1'])('読めない: %s', (text) => {
    expect(parseLocationText(text)).toBeNull();
  });
  it('短いURLを見分ける', () => {
    expect(isShortMapsUrl('https://maps.app.goo.gl/AbCd')).toBe(true);
    expect(isShortMapsUrl('https://goo.gl/maps/AbCd')).toBe(true);
    expect(isShortMapsUrl('https://www.google.com/maps/@35,139,17z')).toBe(false);
  });
});

describe('distanceMeters', () => {
  it('同じ点は0、東京駅〜有楽町駅はおよそ800m', () => {
    const tokyo = { lat: 35.681236, lng: 139.767125 };
    expect(distanceMeters(tokyo, tokyo)).toBe(0);
    const d = distanceMeters(tokyo, { lat: 35.675069, lng: 139.763328 });
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(900);
  });
});

describe('pointOf', () => {
  it('位置があれば小数6桁の座標、なければ住所', () => {
    expect(pointOf({ address: '東京都1', location: { lat: 35.6812405, lng: 139.7671248 } })).toBe('35.681241,139.767125');
    expect(pointOf({ address: '東京都1' })).toBe('東京都1');
  });
});

describe('accuracyLevel', () => {
  it('20m以内は good、50m以上は poor、その間は fair', () => {
    expect(accuracyLevel(20)).toBe('good');
    expect(accuracyLevel(35)).toBe('fair');
    expect(accuracyLevel(50)).toBe('poor');
  });
});
