import type { GeoLocation, Patient } from './types';

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
