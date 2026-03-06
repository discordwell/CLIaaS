import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Gap 1: MacroButton integration into TicketActions ──────────

describe('Gap 1: MacroButton integrated into TicketActions', () => {
  const ticketActionsPath = path.resolve(__dirname, '../components/TicketActions.tsx');
  const content = fs.readFileSync(ticketActionsPath, 'utf-8');

  it('imports MacroButton component', () => {
    expect(content).toContain('import MacroButton from "./MacroButton"');
  });

  it('renders MacroButton with ticketId prop', () => {
    expect(content).toContain('<MacroButton ticketId={ticketId}');
  });

  it('places MacroButton in the Update Ticket section header', () => {
    const macroIdx = content.indexOf('<MacroButton');
    const updateTicketIdx = content.indexOf('Update Ticket');
    // MacroButton should be near the "Update Ticket" heading
    expect(macroIdx).toBeGreaterThan(0);
    expect(updateTicketIdx).toBeGreaterThan(0);
    expect(Math.abs(macroIdx - updateTicketIdx)).toBeLessThan(300);
  });
});

// ── Gap 2: connector_capabilities table in schema ──────────────

describe('Gap 2: connector_capabilities table in schema', () => {
  const schemaPath = path.resolve(__dirname, '../db/schema.ts');
  const content = fs.readFileSync(schemaPath, 'utf-8');

  it('defines connectorCapabilities table', () => {
    expect(content).toContain("export const connectorCapabilities = pgTable(");
  });

  it('has supports_read column', () => {
    expect(content).toContain("supportsRead: boolean('supports_read')");
  });

  it('has supports_incremental_sync column', () => {
    expect(content).toContain("supportsIncrementalSync: boolean('supports_incremental_sync')");
  });

  it('has supports_update column', () => {
    expect(content).toContain("supportsUpdate: boolean('supports_update')");
  });

  it('has supports_reply column', () => {
    expect(content).toContain("supportsReply: boolean('supports_reply')");
  });

  it('has supports_note column', () => {
    expect(content).toContain("supportsNote: boolean('supports_note')");
  });

  it('has supports_create column', () => {
    expect(content).toContain("supportsCreate: boolean('supports_create')");
  });

  it('has unique index on workspace_id + connector', () => {
    expect(content).toContain('connector_capabilities_unique_idx');
  });

  it('has last_verified_at timestamp column', () => {
    expect(content).toContain("lastVerifiedAt: timestamp('last_verified_at'");
  });
});

// ── Gap 2b: migration file exists ──────────────────────────────

describe('Gap 2b: connector_capabilities migration', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../db/migrations/0027_connector_capabilities.sql',
  );

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('creates connector_capabilities table', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS connector_capabilities');
  });

  it('creates unique index', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('connector_capabilities_unique_idx');
  });
});
