import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';
function authHeader(email: string) {
  return { 'x-user-email': email };
}

type CustomField = {
  id: string;
  name: string;
  fieldType: string;
  options: unknown;
  isRequired: boolean;
  teamId: string | null;
  categoryId: string | null;
  sortOrder: number;
};

type ListResponse = { data: CustomField[] };

type CustomFieldValueRow = {
  ticketId: string;
  customFieldId: string;
  value: string | null;
  customField: CustomField;
};

type TicketResponse = {
  id: string;
  customFieldValues: CustomFieldValueRow[];
};

describe('Custom fields', () => {
  let app: INestApplication;
  let server: SupertestApp;
  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });
  afterAll(async () => {
    await app.close();
  });

  it('lets the owner create a global custom field', async () => {
    const response = await request(server)
      .post('/api/custom-fields')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: 'Asset Tag',
        fieldType: 'TEXT',
        isRequired: false,
        sortOrder: 1,
      })
      .expect(201);

    const body = response.body as CustomField;
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Asset Tag');
    expect(body.fieldType).toBe('TEXT');
    // Global field: no team scope.
    expect(body.teamId).toBeNull();
    expect(body.isRequired).toBe(false);
  });

  it('lists the created field via GET /api/custom-fields', async () => {
    const response = await request(server)
      .get('/api/custom-fields')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const body = response.body as ListResponse;
    expect(Array.isArray(body.data)).toBe(true);
    const field = body.data.find((f) => f.name === 'Asset Tag');
    expect(field).toBeDefined();
    expect(field?.fieldType).toBe('TEXT');
  });

  it('denies custom-field creation to non-admin personas (403)', async () => {
    // EMPLOYEE requester -> global field requires OWNER.
    await request(server)
      .post('/api/custom-fields')
      .set(authHeader(fixtureEmails.requester))
      .send({ name: 'Sneaky Field', fieldType: 'TEXT' })
      .expect(403);

    // AGENT cannot create either.
    await request(server)
      .post('/api/custom-fields')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Agent Field', fieldType: 'TEXT' })
      .expect(403);

    // LEAD cannot create either.
    await request(server)
      .post('/api/custom-fields')
      .set(authHeader(fixtureEmails.lead))
      .send({ name: 'Lead Field', fieldType: 'TEXT' })
      .expect(403);
  });

  it('lets a TEAM_ADMIN create a team-scoped custom field', async () => {
    // admin persona is TEAM_ADMIN with primaryTeamId = IT.
    const response = await request(server)
      .post('/api/custom-fields')
      .set(authHeader(fixtureEmails.admin))
      .send({
        name: 'IT Severity Note',
        fieldType: 'TEXTAREA',
        teamId: fixtureTeamIds.it,
      })
      .expect(201);

    const body = response.body as CustomField;
    expect(body.teamId).toBe(fixtureTeamIds.it);
    expect(body.fieldType).toBe('TEXTAREA');
  });

  it('blocks a TEAM_ADMIN from creating a field for another team (403)', async () => {
    await request(server)
      .post('/api/custom-fields')
      .set(authHeader(fixtureEmails.admin))
      .send({
        name: 'HR Field By IT Admin',
        fieldType: 'TEXT',
        teamId: fixtureTeamIds.hr,
      })
      .expect(403);
  });

  it('rejects an invalid fieldType (400)', async () => {
    await request(server)
      .post('/api/custom-fields')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: 'Bad Type', fieldType: 'NOT_A_TYPE' })
      .expect(400);
  });

  it('rejects a DROPDOWN field created without options (400)', async () => {
    await request(server)
      .post('/api/custom-fields')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: 'Bad Dropdown', fieldType: 'DROPDOWN' })
      .expect(400);
  });

  it('updates an existing field via PATCH /api/custom-fields/:id', async () => {
    const created = await request(server)
      .post('/api/custom-fields')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: 'Renamable', fieldType: 'TEXT', isRequired: false })
      .expect(201);
    const field = created.body as CustomField;

    const updated = await request(server)
      .patch(`/api/custom-fields/${field.id}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ name: 'Renamed Field', isRequired: true, sortOrder: 5 })
      .expect(200);

    const body = updated.body as CustomField;
    expect(body.id).toBe(field.id);
    expect(body.name).toBe('Renamed Field');
    expect(body.isRequired).toBe(true);
    expect(body.sortOrder).toBe(5);

    // Clean up: this is now a global *required* field, which would otherwise
    // make every later ticket-create fail requireAllRequired validation (the
    // specs share one DB reset across `it` blocks). Remove it.
    await request(server)
      .delete(`/api/custom-fields/${field.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
  });

  it('persists custom-field values on a ticket and removes them when the field is deleted', async () => {
    // 1. Owner creates a global field we will attach to a ticket.
    const createdField = await request(server)
      .post('/api/custom-fields')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: 'Cost Center', fieldType: 'TEXT' })
      .expect(201);
    const field = createdField.body as CustomField;

    // 2. Requester creates a ticket assigned to IT.
    const createdTicket = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `Custom field values ${Date.now()}`,
        description: 'Ticket used to verify custom field value persistence.',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    const ticket = createdTicket.body as TicketResponse;

    // 3. Set the custom field value on the ticket.
    const setResponse = await request(server)
      .patch(`/api/custom-fields/tickets/${ticket.id}/values`)
      .set(authHeader(fixtureEmails.requester))
      .send({ values: [{ customFieldId: field.id, value: '  CC-4080  ' }] })
      .expect(200);

    const setBody = setResponse.body as CustomFieldValueRow[];
    expect(Array.isArray(setBody)).toBe(true);
    const setRow = setBody.find((row) => row.customFieldId === field.id);
    expect(setRow).toBeDefined();
    // Service trims the stored value.
    expect(setRow?.value).toBe('CC-4080');

    // 4. Verify the value persists when fetching the ticket detail.
    const detail = await request(server)
      .get(`/api/tickets/${ticket.id}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);
    const detailBody = detail.body as TicketResponse;
    const persisted = detailBody.customFieldValues.find(
      (row) => row.customFieldId === field.id,
    );
    expect(persisted).toBeDefined();
    expect(persisted?.value).toBe('CC-4080');
    expect(persisted?.customField.name).toBe('Cost Center');

    // 5. Delete the field; expect a deletion ack.
    const deleted = await request(server)
      .delete(`/api/custom-fields/${field.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect((deleted.body as { deleted: boolean }).deleted).toBe(true);

    // 6. The field no longer lists.
    const list = await request(server)
      .get('/api/custom-fields')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const stillThere = (list.body as ListResponse).data.find(
      (f) => f.id === field.id,
    );
    expect(stillThere).toBeUndefined();

    // 7. Deleting the field cascades: the ticket no longer carries the value.
    const detailAfter = await request(server)
      .get(`/api/tickets/${ticket.id}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);
    const goneRow = (
      detailAfter.body as TicketResponse
    ).customFieldValues.find((row) => row.customFieldId === field.id);
    expect(goneRow).toBeUndefined();
  });

  it('returns 404 when deleting a non-existent field', async () => {
    await request(server)
      .delete('/api/custom-fields/99999999-9999-4999-8999-999999999999')
      .set(authHeader(fixtureEmails.owner))
      .expect(404);
  });
});
