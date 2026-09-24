import type { Patient } from './types';

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
