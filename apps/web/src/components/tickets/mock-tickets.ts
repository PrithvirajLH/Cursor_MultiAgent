import type { PrioLevel, AvatarTone, PillTone, SlaState } from '../atoms';

export interface MockTicket {
  id: string;
  subject: string;
  customer: string;
  customerId: string;
  priority: PrioLevel;
  status: string;
  statusTone: PillTone;
  team: string;
  assigneeInitials: string;
  assigneeTone: AvatarTone;
  sla: { pct: number; state: SlaState; text: string };
  age: string;
  updated: string;
  tags: string[];
  channel: string;
}

export const MOCK_TICKETS: MockTicket[] = [
  { id: 'TCK-48201', subject: 'Production API returning 503 on /v2/orders endpoint', customer: 'Northwind Logistics', customerId: 'ENT-0021', priority: 'SEV1', status: 'open',        statusTone: 'red',   team: 'Platform',    assigneeInitials: 'AK', assigneeTone: 'e', sla: { pct: 92, state: 'breach', text: '−14m'  }, age: '2h 14m', updated: '4m',  tags: ['outage', 'tier-1'],  channel: 'email'  },
  { id: 'TCK-48199', subject: 'SSO login failing for new Azure AD tenant migration', customer: 'Globex Industries',  customerId: 'ENT-0044', priority: 'SEV1', status: 'in progress', statusTone: 'amber', team: 'Identity',    assigneeInitials: 'MR', assigneeTone: 'b', sla: { pct: 76, state: 'warn',   text: '47m'   }, age: '5h 02m', updated: '11m', tags: ['sso', 'auth'],       channel: 'portal' },
  { id: 'TCK-48197', subject: 'Bulk export job stuck at 84% for 6+ hours',           customer: 'Initech Corp',       customerId: 'ENT-0102', priority: 'SEV2', status: 'in progress', statusTone: 'amber', team: 'Data',        assigneeInitials: 'JC', assigneeTone: 'c', sla: { pct: 58, state: 'ok',     text: '3h 12m'}, age: '8h 41m', updated: '32m', tags: ['exports', 'jobs'],   channel: 'email'  },
  { id: 'TCK-48195', subject: 'Webhook signature verification fails after key rotation', customer: 'Stark Industries', customerId: 'ENT-0007', priority: 'SEV2', status: 'pending',     statusTone: 'blue',  team: 'Platform',    assigneeInitials: 'AK', assigneeTone: 'e', sla: { pct: 42, state: 'ok',     text: '6h 50m'}, age: '12h 18m',updated: '1h',  tags: ['webhooks'],          channel: 'api'    },
  { id: 'TCK-48192', subject: 'Permission inheritance not propagating to nested folders', customer: 'Wayne Enterprises',customerId: 'ENT-0019', priority: 'SEV3', status: 'open',        statusTone: 'red',   team: 'Permissions', assigneeInitials: 'SP', assigneeTone: 'd', sla: { pct: 28, state: 'ok',     text: '1d 2h' }, age: '1d 4h',  updated: '2h',  tags: ['permissions','rbac'],channel: 'portal' },
  { id: 'TCK-48190', subject: 'Reporting dashboard shows incorrect MRR for January', customer: 'Acme Co.',           customerId: 'ENT-0033', priority: 'SEV3', status: 'in progress', statusTone: 'amber', team: 'Analytics',   assigneeInitials: 'TL', assigneeTone: 'a', sla: { pct: 35, state: 'ok',     text: '18h'   }, age: '1d 1h',  updated: '3h',  tags: ['reporting'],         channel: 'email'  },
  { id: 'TCK-48188', subject: 'CSV import truncates rows over 50k entries',          customer: 'Umbrella LLC',       customerId: 'ENT-0091', priority: 'SEV3', status: 'pending',     statusTone: 'blue',  team: 'Data',        assigneeInitials: 'JC', assigneeTone: 'c', sla: { pct: 22, state: 'ok',     text: '1d 8h' }, age: '1d 8h',  updated: '5h',  tags: ['imports'],           channel: 'portal' },
  { id: 'TCK-48184', subject: 'Mobile app crashes on contacts screen — iOS 17.3',    customer: 'Cyberdyne Systems',  customerId: 'ENT-0058', priority: 'SEV2', status: 'open',        statusTone: 'red',   team: 'Mobile',      assigneeInitials: 'RG', assigneeTone: 'b', sla: { pct: 88, state: 'warn',   text: '12m'   }, age: '4h 30m', updated: '8m',  tags: ['ios', 'crash'],      channel: 'app'    },
  { id: 'TCK-48180', subject: 'Two-factor recovery codes not delivering via SMS',    customer: 'Tyrell Corp',        customerId: 'ENT-0066', priority: 'SEV2', status: 'in progress', statusTone: 'amber', team: 'Identity',    assigneeInitials: 'MR', assigneeTone: 'b', sla: { pct: 64, state: 'ok',     text: '2h 40m'}, age: '6h 12m', updated: '22m', tags: ['2fa', 'sms'],        channel: 'email'  },
  { id: 'TCK-48177', subject: 'Custom field "Account Tier" not appearing in API response', customer: 'Soylent Corp', customerId: 'ENT-0118', priority: 'SEV3', status: 'open',        statusTone: 'red',   team: 'Platform',    assigneeInitials: 'AK', assigneeTone: 'e', sla: { pct: 18, state: 'ok',     text: '2d 1h' }, age: '2d 3h',  updated: '6h',  tags: ['api', 'fields'],     channel: 'api'    },
  { id: 'TCK-48171', subject: 'Slack integration disconnected after workspace rename', customer: 'Pied Piper',       customerId: 'ENT-0077', priority: 'SEV3', status: 'pending',     statusTone: 'blue',  team: 'Integrations',assigneeInitials: 'NB', assigneeTone: 'a', sla: { pct: 14, state: 'ok',     text: '2d 8h' }, age: '2d 11h', updated: '14h', tags: ['slack'],             channel: 'portal' },
  { id: 'TCK-48168', subject: 'Audit log retention policy not honoring 7-year setting', customer: 'Massive Dynamic',  customerId: 'ENT-0009', priority: 'SEV2', status: 'in progress', statusTone: 'amber', team: 'Compliance',  assigneeInitials: 'EH', assigneeTone: 'd', sla: { pct: 71, state: 'warn',   text: '1h 45m'}, age: '7h',     updated: '30m', tags: ['audit','compliance'],channel: 'email'  },
];
