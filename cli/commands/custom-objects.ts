import type { Command } from 'commander';
import chalk from 'chalk';
import { output } from '../output.js';
import {
  listObjectTypes,
  getObjectType,
  getObjectTypeByKey,
  createObjectType,
  deleteObjectType,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  listRelationships,
  createRelationship,
  type CustomObjectFieldDef,
} from '@/lib/custom-objects.js';

export function registerCustomObjectCommands(program: Command): void {
  const objects = program.command('objects').description('Custom objects management');

  objects
    .command('types')
    .description('List custom object types')
    .action(() => {
      const types = listObjectTypes();
      output(types, () => {
        if (!types.length) { console.log('No custom object types defined.'); return; }
        console.log(chalk.bold(`\nCustom Object Types (${types.length})`));
        for (const t of types) {
          console.log(`  ${chalk.cyan(t.key)} — ${t.name} (${t.fields.length} fields)`);
        }
      });
    });

  objects
    .command('create-type')
    .description('Create a custom object type')
    .requiredOption('--key <key>', 'Machine-readable key (e.g. subscription)')
    .requiredOption('--name <name>', 'Display name')
    .option('--name-plural <plural>', 'Plural name')
    .option('--description <desc>', 'Description')
    .option('--fields <json>', 'Fields JSON array')
    .action((opts: { key: string; name: string; namePlural?: string; description?: string; fields?: string }) => {
      try {
        let fields: CustomObjectFieldDef[] = [];
        if (opts.fields) {
          fields = JSON.parse(opts.fields);
        }
        const type = createObjectType({
          workspaceId: 'default',
          key: opts.key,
          name: opts.name,
          namePlural: opts.namePlural ?? `${opts.name}s`,
          description: opts.description,
          fields,
        });
        output(type, () => {
          console.log(chalk.green(`Created type: ${type.key} (${type.fields.length} fields)`));
        });
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  objects
    .command('records')
    .description('List records for a type')
    .requiredOption('--type <key>', 'Object type key')
    .action((opts: { type: string }) => {
      const typeDef = getObjectTypeByKey('default', opts.type);
      if (!typeDef) { console.error(chalk.red(`Type '${opts.type}' not found`)); process.exitCode = 1; return; }

      const records = listRecords(typeDef.id);
      output(records, () => {
        if (!records.length) { console.log(`No ${typeDef.namePlural} found.`); return; }
        console.log(chalk.bold(`\n${typeDef.namePlural} (${records.length})`));
        for (const r of records) {
          const preview = Object.entries(r.data).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(', ');
          console.log(`  ${r.id.slice(0, 8)} — ${preview}`);
        }
      });
    });

  objects
    .command('create')
    .description('Create a custom object record')
    .requiredOption('--type <key>', 'Object type key')
    .requiredOption('--data <json>', 'Record data as JSON')
    .action((opts: { type: string; data: string }) => {
      try {
        const typeDef = getObjectTypeByKey('default', opts.type);
        if (!typeDef) { console.error(chalk.red(`Type '${opts.type}' not found`)); process.exitCode = 1; return; }
        const data = JSON.parse(opts.data);
        const record = createRecord({ workspaceId: 'default', typeId: typeDef.id, data });
        output(record, () => { console.log(chalk.green(`Created record: ${record.id}`)); });
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  objects
    .command('show')
    .description('Show a record')
    .requiredOption('--id <id>', 'Record ID')
    .action((opts: { id: string }) => {
      const record = getRecord(opts.id);
      if (!record) { console.error(chalk.red('Record not found')); process.exitCode = 1; return; }
      output(record, () => {
        console.log(chalk.bold('\nRecord'));
        for (const [k, v] of Object.entries(record.data)) {
          console.log(`  ${k}: ${JSON.stringify(v)}`);
        }
      });
    });

  objects
    .command('update')
    .description('Update a record')
    .requiredOption('--id <id>', 'Record ID')
    .requiredOption('--data <json>', 'Fields to update as JSON')
    .action((opts: { id: string; data: string }) => {
      try {
        const data = JSON.parse(opts.data);
        const record = getRecord(opts.id);
        if (!record) { console.error(chalk.red('Record not found')); process.exitCode = 1; return; }
        const updated = updateRecord(opts.id, { data: { ...record.data, ...data } });
        output(updated, () => { console.log(chalk.green(`Updated record: ${opts.id}`)); });
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  objects
    .command('delete')
    .description('Delete a record')
    .requiredOption('--id <id>', 'Record ID')
    .action((opts: { id: string }) => {
      const deleted = deleteRecord(opts.id);
      if (!deleted) { console.error(chalk.red('Record not found')); process.exitCode = 1; return; }
      console.log(chalk.green('Deleted.'));
    });

  objects
    .command('link')
    .description('Create a relationship between entities')
    .requiredOption('--source <type:id>', 'Source entity (e.g. ticket:abc-123)')
    .requiredOption('--target <type:id>', 'Target entity (e.g. subscription:def-456)')
    .option('--relationship <type>', 'Relationship type', 'related')
    .action((opts: { source: string; target: string; relationship: string }) => {
      try {
        const [sourceType, sourceId] = opts.source.split(':');
        const [targetType, targetId] = opts.target.split(':');
        if (!sourceType || !sourceId || !targetType || !targetId) {
          console.error(chalk.red('Format: --source type:id --target type:id'));
          process.exitCode = 1;
          return;
        }
        const rel = createRelationship({
          workspaceId: 'default',
          sourceType,
          sourceId,
          targetType,
          targetId,
          relationshipType: opts.relationship,
          metadata: {},
        });
        output(rel, () => { console.log(chalk.green(`Linked ${opts.source} → ${opts.target}`)); });
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });
}
