import type { Patient } from './types';

export function createPatient(name: string, address: string, now: Date = new Date()): Patient {
  const timestamp = now.toISOString();
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    address: address.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updatePatientFields(
  patient: Patient,
  name: string,
  address: string,
  now: Date = new Date(),
): Patient {
  return {
    ...patient,
    name: name.trim(),
    address: address.trim(),
    updatedAt: now.toISOString(),
  };
}
