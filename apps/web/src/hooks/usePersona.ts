import { useEffect, useMemo, useState } from 'react';
import { getDemoUserEmail, setDemoUserEmail } from '../api/client';
import type { Role } from '../types';

export type Persona = { label: string; email: string; role: Role };

const defaultPersonas: Persona[] = [
  { label: 'Employee (Jane)', email: 'jane.doe@company.com', role: 'EMPLOYEE' },
  { label: 'Agent (Alex)', email: 'alex.park@company.com', role: 'AGENT' },
  { label: 'Lead (Maria)', email: 'maria.chen@company.com', role: 'LEAD' },
  { label: 'Team Admin (Sam)', email: 'sam.rivera@company.com', role: 'TEAM_ADMIN' },
  { label: 'Owner', email: 'owner@company.com', role: 'OWNER' },
];

const e2ePersonas: Persona[] = [
  { label: 'Requester (Test)', email: 'requester@company.com', role: 'EMPLOYEE' },
  { label: 'Agent (Test)', email: 'agent@company.com', role: 'AGENT' },
  { label: 'Lead (Test)', email: 'lead@company.com', role: 'LEAD' },
  { label: 'Team Admin (Test)', email: 'admin@company.com', role: 'TEAM_ADMIN' },
  { label: 'Owner (Test)', email: 'owner@company.com', role: 'OWNER' },
];

const personas: Persona[] =
  import.meta.env.VITE_E2E_MODE === 'true' ? e2ePersonas : defaultPersonas;

export function usePersona() {
  const [currentEmail, setCurrentEmail] = useState(
    () => getDemoUserEmail() || personas[0].email,
  );

  const currentPersona = useMemo(
    () => personas.find((p) => p.email === currentEmail) ?? personas[0],
    [currentEmail],
  );

  useEffect(() => {
    const isValid = personas.some((p) => p.email === currentEmail);
    if (!isValid) setCurrentEmail(personas[0].email);
  }, [currentEmail]);

  useEffect(() => {
    setDemoUserEmail(currentEmail);
  }, [currentEmail]);

  return { personas, currentEmail, setCurrentEmail, currentPersona } as const;
}
