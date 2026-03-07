/**
 * Mock HubSpot API responses for parity tests.
 * Shapes match HSTicket, HSContact, HSCompany, etc. in cli/connectors/hubspot.ts
 */

export const hubspotTickets = [
  {
    id: 'hs-1001',
    properties: {
      subject: 'CRM integration failing',
      content: 'Our CRM sync stopped working after the latest update.',
      hs_pipeline_stage: 'open',
      hs_ticket_priority: 'HIGH',
      hubspot_owner_id: 'owner-1',
      createdate: '2026-01-05T12:00:00Z',
      hs_lastmodifieddate: '2026-01-06T14:00:00Z',
      hs_ticket_category: 'integration',
    },
  },
  {
    id: 'hs-1002',
    properties: {
      subject: 'Billing question',
      content: 'I need to update my payment method.',
      hs_pipeline_stage: 'waiting',
      hs_ticket_priority: 'low',
      hubspot_owner_id: undefined,
      createdate: '2026-01-10T09:00:00Z',
      hs_lastmodifieddate: '2026-01-11T10:00:00Z',
      hs_ticket_category: undefined,
    },
  },
  {
    id: 'hs-1003',
    properties: {
      subject: undefined, // null subject test
      content: undefined,
      hs_pipeline_stage: 'closed',
      hs_ticket_priority: undefined,
      hubspot_owner_id: 'owner-2',
      createdate: '2026-02-01T08:00:00Z',
      hs_lastmodifieddate: '2026-02-03T16:00:00Z',
      hs_ticket_category: undefined,
    },
  },
];

export const hubspotContacts = [
  {
    id: 'contact-1',
    properties: {
      firstname: 'Maria',
      lastname: 'Garcia',
      email: 'maria@example.com',
      phone: '+15553334444',
      company: 'TechStartup',
      associatedcompanyid: 'comp-100',
    },
  },
  {
    id: 'contact-2',
    properties: {
      firstname: undefined,
      lastname: undefined,
      email: 'unknown@example.com',
      phone: undefined,
      company: undefined,
      associatedcompanyid: undefined,
    },
  },
];

export const hubspotCompanies = [
  {
    id: 'comp-100',
    properties: {
      name: 'TechStartup LLC',
      domain: 'techstartup.com',
      website: 'https://www.techstartup.com',
      industry: 'Technology',
    },
  },
];

export const hubspotOwners = [
  { id: 'owner-1', email: 'agent1@company.com', firstName: 'Tom', lastName: 'Agent' },
  { id: 'owner-2', email: 'agent2@company.com', firstName: 'Lisa', lastName: 'Support' },
];

export const hubspotNotes = [
  {
    id: 'note-1',
    properties: {
      hs_note_body: 'Followed up with customer about the integration issue.',
      hs_timestamp: '2026-01-06T10:00:00Z',
      hubspot_owner_id: 'owner-1',
    },
  },
];

export const hubspotWorkflows = [
  {
    id: 'wf-1',
    name: 'Auto-assign new tickets',
    type: 'WORKFLOW',
    enabled: true,
    actions: [{ type: 'SET_PROPERTY', propertyName: 'hubspot_owner_id' }],
    enrollmentCriteria: { type: 'ALL', filters: [] },
  },
];
