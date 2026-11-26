// OpenAPI description of the parts of the API a bot may use with a key, for
// tools that take one (ChatGPT GPT Actions, Make, Zapier, n8n's HTTP node).
// Public: it describes the shape of the API, never any data.
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

const ok = (schema: Record<string, unknown> = { type: 'object' }) => ({
  description: 'OK',
  content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, data: schema } } } },
});

const json = (properties: Record<string, unknown>, required: string[] = []) => ({
  required: true,
  content: { 'application/json': { schema: { type: 'object', properties, ...(required.length ? { required } : {}) } } },
});

const id = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string' } });

const extra = { type: 'object', additionalProperties: { type: 'string' }, description: 'Fields added in Settings, by field key (GET /api/config)' };

const clientProps = {
  fullName: { type: 'string' },
  phone: { type: 'string' },
  idNumber: { type: 'string' },
  email: { type: 'string' },
  address: { type: 'string' },
  city: { type: 'string' },
  notes: { type: 'string' },
  extra,
};

const caseProps = {
  title: { type: 'string' },
  company: { type: 'string', description: 'A value from config.companies' },
  caseKind: { type: 'string', enum: ['new', 'renewal'] },
  office: { type: 'string', description: 'A value from config.offices' },
  fee: { type: 'number' },
  referenceNumber: { type: 'string' },
  description: { type: 'string' },
  extra,
};

function spec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'CRM API',
      version: '1.0.0',
      description:
        'Rent-assistance office CRM (data in Hebrew). Authenticate with an API key from Settings → חיבור בוט: "Authorization: Bearer crmye_…". A key acts as one team account, is read-only unless created with write access, and can never delete. Stage codes, fields and option values come from GET /api/config. AI tools that speak MCP can use POST /api/mcp instead.',
    },
    servers: [{ url: env.appBaseUrl }],
    components: { securitySchemes: { apiKey: { type: 'http', scheme: 'bearer' } } },
    security: [{ apiKey: [] }],
    paths: {
      '/api/config': { get: { operationId: 'getSetup', summary: 'Stages, client and case fields, companies, offices, document templates', responses: { 200: ok() } } },
      '/api/clients': {
        get: { operationId: 'listClients', summary: 'All clients you can see, with case counts and balances', responses: { 200: ok({ type: 'array', items: { type: 'object' } }) } },
        post: {
          operationId: 'createClient',
          summary: 'Add a client (opens a case too, unless createCase is false)',
          requestBody: json({ ...clientProps, createCase: { type: 'boolean' }, case: { type: 'object', properties: caseProps } }, ['fullName']),
          responses: { 201: ok() },
        },
      },
      '/api/clients/{clientId}': {
        get: { operationId: 'getClient', summary: 'A client with cases, documents, payments and activity', parameters: [id('clientId')], responses: { 200: ok() } },
        patch: { operationId: 'updateClient', summary: "Change a client's details (send only what changes)", parameters: [id('clientId')], requestBody: json(clientProps), responses: { 200: ok() } },
      },
      '/api/clients/{clientId}/documents': {
        get: { operationId: 'listClientDocuments', summary: "A client's documents", parameters: [id('clientId')], responses: { 200: ok({ type: 'array', items: { type: 'object' } }) } },
        post: {
          operationId: 'uploadDocuments',
          summary: 'Upload files (multipart): file (repeatable), optional caseId, checklistCode, label',
          parameters: [id('clientId')],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: { file: { type: 'string', format: 'binary' }, caseId: { type: 'string' }, checklistCode: { type: 'string' }, label: { type: 'string' } },
                  required: ['file'],
                },
              },
            },
          },
          responses: { 201: ok({ type: 'array', items: { type: 'object' } }) },
        },
      },
      '/api/cases': {
        get: { operationId: 'listCases', summary: 'All cases you can see, with client name, missing documents and balance', responses: { 200: ok({ type: 'array', items: { type: 'object' } }) } },
        post: { operationId: 'createCase', summary: 'Open a case for a client', requestBody: json({ clientId: { type: 'string' }, ...caseProps, nextAction: { type: 'string' } }, ['clientId', 'title']), responses: { 201: ok() } },
      },
      '/api/cases/{caseId}': {
        get: { operationId: 'getCase', summary: 'A case with its checklist, documents, payments and activity', parameters: [id('caseId')], responses: { 200: ok() } },
        patch: {
          operationId: 'updateCase',
          summary: 'Change a case: stage (code from config.stages), next action, notes, decision, flag, transfer',
          parameters: [id('caseId')],
          requestBody: json({
            stage: { type: 'string' },
            nextAction: { type: 'string' },
            notes: { type: 'string' },
            decision: { type: 'string' },
            decisionStatus: { type: 'string', enum: ['approved', 'investigation'] },
            investigationOutcome: { type: 'string', enum: ['approved', 'rejected', ''] },
            troubleFlag: { type: 'boolean' },
            troubleNote: { type: 'string' },
            assignedTo: { type: 'string' },
            ...caseProps,
          }),
          responses: { 200: ok() },
        },
      },
      '/api/cases/{caseId}/checklist': {
        post: { operationId: 'addChecklistItem', summary: 'Require another document (template code or free-text label)', parameters: [id('caseId')], requestBody: json({ code: { type: 'string' }, label: { type: 'string' } }), responses: { 201: ok() } },
        patch: {
          operationId: 'updateChecklistItem',
          summary: 'Set the status or note of a required document',
          parameters: [id('caseId')],
          requestBody: json({ code: { type: 'string' }, status: { type: 'string', enum: ['missing', 'received', 'in-review', 'approved', 'resubmit-needed', 'not-applicable'] }, note: { type: 'string' } }, ['code']),
          responses: { 200: ok() },
        },
      },
      '/api/documents/{documentId}': {
        get: {
          operationId: 'getDocument',
          summary: 'The file itself; with ?meta=1 its details as JSON',
          parameters: [id('documentId'), { name: 'meta', in: 'query', schema: { type: 'string', enum: ['1'] } }],
          responses: { 200: { description: 'The file, or its details' } },
        },
      },
      '/api/documents/send': {
        post: {
          operationId: 'sendDocuments',
          summary: 'Send documents to their client: by email as attachments (a link above ~18 MB), by WhatsApp as a link',
          requestBody: json({ documentIds: { type: 'array', items: { type: 'string' } }, channel: { type: 'string', enum: ['email', 'whatsapp'] } }, ['documentIds', 'channel']),
          responses: { 200: ok() },
        },
      },
      '/api/tasks': {
        get: {
          operationId: 'listTasks',
          summary: 'Tasks and reminders you can see',
          parameters: [
            { name: 'open', in: 'query', schema: { type: 'string', enum: ['1'] } },
            { name: 'clientId', in: 'query', schema: { type: 'string' } },
            { name: 'caseId', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: ok({ type: 'array', items: { type: 'object' } }) },
        },
        post: {
          operationId: 'createTask',
          summary: 'Add a task or reminder',
          requestBody: json(
            {
              title: { type: 'string' },
              notes: { type: 'string' },
              dueAt: { type: 'string', format: 'date-time' },
              remindAt: { type: 'string', format: 'date-time' },
              priority: { type: 'string', enum: ['normal', 'high', 'urgent'] },
              clientId: { type: 'string' },
              caseId: { type: 'string' },
              assigneeId: { type: 'string' },
            },
            ['title'],
          ),
          responses: { 201: ok() },
        },
      },
      '/api/tasks/{taskId}': {
        patch: {
          operationId: 'updateTask',
          summary: 'Mark done / reopen, or change a task',
          parameters: [id('taskId')],
          requestBody: json({ status: { type: 'string', enum: ['open', 'done'] }, title: { type: 'string' }, notes: { type: 'string' }, dueAt: { type: 'string' }, priority: { type: 'string' } }),
          responses: { 200: ok() },
        },
      },
      '/api/payments': {
        get: { operationId: 'listPayments', summary: 'Payments (managers only)', responses: { 200: ok({ type: 'array', items: { type: 'object' } }) } },
        post: {
          operationId: 'addPayment',
          summary: 'Record a payment (managers only)',
          requestBody: json({ clientId: { type: 'string' }, caseId: { type: 'string' }, amount: { type: 'number' }, method: { type: 'string' }, paidAt: { type: 'string' }, note: { type: 'string' } }, ['clientId', 'amount']),
          responses: { 201: ok() },
        },
      },
      '/api/activity': {
        get: { operationId: 'recentActivity', summary: 'The activity log, newest first (managers only); ?q= filters', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }], responses: { 200: ok({ type: 'array', items: { type: 'object' } }) } },
      },
    },
  };
}

export function GET() {
  return NextResponse.json(spec());
}
