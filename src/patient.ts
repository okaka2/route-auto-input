import type { GeoLocation, Parking, ParkingType, Patient } from './types';
import { isDateKey } from './visitInfo';

export function createPatient(
  name: string,
  address: string,
  now: Date = new Date(),
  phone = '',
): Patient {
  const timestamp = now.toISOString();
  const trimmedPhone = phone.trim();
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    address: address.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(trimmedPhone ? { phone: trimmedPhone } : {}),
  };
}

/** 位置を付ける/外す(nullで外す)。他の項目は変えず、更新日時だけ進める。 */
export function withLocation(patient: Patient, location: GeoLocation | null, now: Date = new Date()): Patient {
  const { location: _old, ...rest } = patient;
  return {
    ...rest,
    ...(location ? { location } : {}),
    updatedAt: now.toISOString(),
  };
}

/**
 * 駐車情報とメモを付け替える(他の項目・更新日時は変えない)。
 * parkingType が '' なら parking を外す。'street_permit' 以外の駐車場では permitExpires を持たない。
 * note は trim して、空なら持たない。
 */
export function withVisitInfo(
  patient: Patient,
  info: { parkingType: ParkingType | ''; permitExpires: string; note: string },
): Patient {
  const { parking: _oldParking, note: _oldNote, ...rest } = patient;
  const trimmedNote = info.note.trim();
  const trimmedPermit = info.permitExpires.trim();
  const parking: Parking | null =
    info.parkingType === ''
      ? null
      : {
          type: info.parkingType,
          ...(info.parkingType === 'street_permit' && isDateKey(trimmedPermit) ? { permitExpires: trimmedPermit } : {}),
        };
  return {
    ...rest,
    ...(parking ? { parking } : {}),
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };
}

export function updatePatientFields(
  patient: Patient,
  name: string,
  address: string,
  now: Date = new Date(),
  phone = '',
): Patient {
  const { phone: _old, ...rest } = patient;
  const trimmedPhone = phone.trim();
  return {
    ...rest,
    name: name.trim(),
    address: address.trim(),
    updatedAt: now.toISOString(),
    ...(trimmedPhone ? { phone: trimmedPhone } : {}),
  };
}
