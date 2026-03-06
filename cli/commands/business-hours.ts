import type { Command } from 'commander';
import chalk from 'chalk';
import { output } from '../output.js';

export function registerBusinessHoursCommands(program: Command): void {
  const bh = program
    .command('business-hours')
    .alias('bh')
    .description('Business hours & holiday calendar management');

  // ---- Schedule commands ----

  bh.command('list')
    .description('List business hours schedules')
    .action(async () => {
      const { getBusinessHours } = await import('@/lib/wfm/business-hours');
      const configs = getBusinessHours();
      output(
        { businessHours: configs, total: configs.length },
        () => {
          console.log(chalk.bold.cyan('\nBusiness Hours Schedules\n'));
          if (configs.length === 0) {
            console.log(chalk.gray('  No schedules found.'));
            return;
          }
          const header = `  ${'NAME'.padEnd(25)} ${'TIMEZONE'.padEnd(20)} ${'DEFAULT'.padEnd(8)} DAYS`;
          console.log(chalk.gray(header));
          for (const c of configs) {
            const dayCount = Object.keys(c.schedule).filter(k => {
              const wins = (c.schedule as Record<string, unknown[]>)[k];
              return Array.isArray(wins) && wins.length > 0;
            }).length;
            console.log(
              `  ${c.name.padEnd(25)} ${c.timezone.padEnd(20)} ${(c.isDefault ? 'Yes' : '').padEnd(8)} ${dayCount}`,
            );
          }
        },
      );
    });

  bh.command('show')
    .description('Show a business hours schedule')
    .argument('<id>', 'Schedule ID')
    .action(async (id: string) => {
      const { getBusinessHours } = await import('@/lib/wfm/business-hours');
      const configs = getBusinessHours(id);
      if (configs.length === 0) {
        console.log(chalk.red('Schedule not found.'));
        return;
      }
      const c = configs[0];
      output(
        { businessHours: c },
        () => {
          console.log(chalk.bold.cyan(`\n${c.name}`));
          console.log(chalk.gray(`  ID:       ${c.id}`));
          console.log(chalk.gray(`  Timezone: ${c.timezone}`));
          console.log(chalk.gray(`  Default:  ${c.isDefault}`));
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          for (let d = 0; d < 7; d++) {
            const wins = (c.schedule as Record<string, Array<{ start: string; end: string }>>)[String(d)] || [];
            const winStr = wins.length > 0 ? wins.map(w => `${w.start}-${w.end}`).join(', ') : 'Closed';
            console.log(`  ${dayNames[d].padEnd(5)} ${winStr}`);
          }
        },
      );
    });

  bh.command('create')
    .description('Create a business hours schedule')
    .argument('<name>', 'Schedule name')
    .option('--timezone <tz>', 'Timezone', 'UTC')
    .option('--default', 'Set as default schedule')
    .action(async (name: string, opts: { timezone: string; default?: boolean }) => {
      const { createBusinessHours } = await import('@/lib/wfm/business-hours');
      const config = createBusinessHours({
        name,
        timezone: opts.timezone,
        schedule: {
          '1': [{ start: '09:00', end: '17:00' }],
          '2': [{ start: '09:00', end: '17:00' }],
          '3': [{ start: '09:00', end: '17:00' }],
          '4': [{ start: '09:00', end: '17:00' }],
          '5': [{ start: '09:00', end: '17:00' }],
        },
        holidays: [],
        isDefault: opts.default ?? false,
      });
      output(
        { businessHours: config },
        () => console.log(chalk.green(`Created schedule "${config.name}" (${config.id})`)),
      );
    });

  bh.command('delete')
    .description('Delete a business hours schedule')
    .argument('<id>', 'Schedule ID')
    .action(async (id: string) => {
      const { deleteBusinessHours } = await import('@/lib/wfm/business-hours');
      const deleted = deleteBusinessHours(id);
      output(
        { deleted },
        () => console.log(deleted ? chalk.green('Deleted.') : chalk.red('Not found.')),
      );
    });

  bh.command('check')
    .description('Check if a timestamp falls within business hours')
    .argument('<id>', 'Schedule ID')
    .option('--at <timestamp>', 'ISO timestamp (default: now)')
    .action(async (id: string, opts: { at?: string }) => {
      const { getBusinessHours, isWithinBusinessHours, nextBusinessHourStart, nextBusinessHourClose } = await import('@/lib/wfm/business-hours');
      const configs = getBusinessHours(id);
      if (configs.length === 0) {
        console.log(chalk.red('Schedule not found.'));
        return;
      }
      const config = configs[0];
      const ts = opts.at ? new Date(opts.at) : new Date();
      const open = isWithinBusinessHours(config, ts);
      const result: Record<string, unknown> = {
        schedule: config.name,
        timezone: config.timezone,
        checkedAt: ts.toISOString(),
        isOpen: open,
        nextOpen: nextBusinessHourStart(config, ts).toISOString(),
      };
      if (open) result.nextClose = nextBusinessHourClose(config, ts).toISOString();
      output(
        result,
        () => {
          console.log(chalk.bold(open ? chalk.green('OPEN') : chalk.red('CLOSED')));
          console.log(chalk.gray(`  Schedule: ${config.name} (${config.timezone})`));
          console.log(chalk.gray(`  Checked:  ${ts.toISOString()}`));
          console.log(chalk.gray(`  Next open: ${result.nextOpen}`));
          if (result.nextClose) console.log(chalk.gray(`  Closes at: ${result.nextClose}`));
        },
      );
    });

  bh.command('next-open')
    .description('Find when business hours next open')
    .argument('<id>', 'Schedule ID')
    .option('--from <timestamp>', 'Start from (default: now)')
    .action(async (id: string, opts: { from?: string }) => {
      const { getBusinessHours, nextBusinessHourStart } = await import('@/lib/wfm/business-hours');
      const configs = getBusinessHours(id);
      if (configs.length === 0) {
        console.log(chalk.red('Schedule not found.'));
        return;
      }
      const from = opts.from ? new Date(opts.from) : new Date();
      const next = nextBusinessHourStart(configs[0], from);
      output({ nextOpen: next.toISOString() }, () => console.log(next.toISOString()));
    });

  bh.command('elapsed')
    .description('Calculate elapsed business minutes between two times')
    .argument('<id>', 'Schedule ID')
    .argument('<from>', 'Start ISO timestamp')
    .argument('<to>', 'End ISO timestamp')
    .action(async (id: string, from: string, to: string) => {
      const { getBusinessHours, getElapsedBusinessMinutes } = await import('@/lib/wfm/business-hours');
      const configs = getBusinessHours(id);
      if (configs.length === 0) {
        console.log(chalk.red('Schedule not found.'));
        return;
      }
      const minutes = getElapsedBusinessMinutes(configs[0], new Date(from), new Date(to));
      output({ elapsedBusinessMinutes: minutes }, () => console.log(`${minutes} business minutes`));
    });

  // ---- Holiday sub-commands ----

  const holidays = bh.command('holidays').description('Manage holiday calendars');

  holidays.command('list')
    .description('List holiday calendars')
    .action(async () => {
      const { listHolidayCalendars } = await import('@/lib/wfm/holidays');
      const calendars = listHolidayCalendars();
      output(
        { calendars, total: calendars.length },
        () => {
          console.log(chalk.bold.cyan('\nHoliday Calendars\n'));
          if (calendars.length === 0) {
            console.log(chalk.gray('  No calendars found.'));
            return;
          }
          for (const c of calendars) {
            console.log(`  ${chalk.bold(c.name)} (${c.id}) — ${c.entries.length} entries`);
          }
        },
      );
    });

  holidays.command('show')
    .description('Show a holiday calendar')
    .argument('<id>', 'Calendar ID')
    .action(async (id: string) => {
      const { listHolidayCalendars } = await import('@/lib/wfm/holidays');
      const cals = listHolidayCalendars(id);
      if (cals.length === 0) {
        console.log(chalk.red('Calendar not found.'));
        return;
      }
      const cal = cals[0];
      output(
        { calendar: cal },
        () => {
          console.log(chalk.bold.cyan(`\n${cal.name}`));
          if (cal.description) console.log(chalk.gray(`  ${cal.description}`));
          for (const e of cal.entries) {
            const label = e.recurring ? `${e.date} (recurring)` : e.date;
            console.log(`  ${e.name.padEnd(30)} ${label}`);
          }
        },
      );
    });

  holidays.command('create')
    .description('Create a holiday calendar')
    .argument('<name>', 'Calendar name')
    .option('--description <desc>', 'Description')
    .action(async (name: string, opts: { description?: string }) => {
      const { createHolidayCalendar } = await import('@/lib/wfm/holidays');
      const cal = createHolidayCalendar({ name, description: opts.description });
      output(
        { calendar: cal },
        () => console.log(chalk.green(`Created calendar "${cal.name}" (${cal.id})`)),
      );
    });

  holidays.command('add-date')
    .description('Add a holiday date to a calendar')
    .argument('<calendarId>', 'Calendar ID')
    .argument('<name>', 'Holiday name')
    .argument('<date>', 'Date (YYYY-MM-DD)')
    .option('--recurring', 'Repeat every year')
    .action(async (calendarId: string, name: string, date: string, opts: { recurring?: boolean }) => {
      const { addEntryToCalendar } = await import('@/lib/wfm/holidays');
      const cal = addEntryToCalendar(calendarId, { name, date, recurring: opts.recurring });
      if (!cal) {
        console.log(chalk.red('Calendar not found.'));
        return;
      }
      output(
        { calendar: cal },
        () => console.log(chalk.green(`Added "${name}" (${date}) to ${cal.name}`)),
      );
    });

  holidays.command('remove-date')
    .description('Remove a holiday entry from a calendar')
    .argument('<calendarId>', 'Calendar ID')
    .argument('<entryId>', 'Entry ID')
    .action(async (calendarId: string, entryId: string) => {
      const { removeEntryFromCalendar } = await import('@/lib/wfm/holidays');
      const cal = removeEntryFromCalendar(calendarId, entryId);
      output(
        { calendar: cal },
        () => console.log(cal ? chalk.green('Removed.') : chalk.red('Not found.')),
      );
    });

  holidays.command('delete')
    .description('Delete a holiday calendar')
    .argument('<id>', 'Calendar ID')
    .action(async (id: string) => {
      const { deleteHolidayCalendar } = await import('@/lib/wfm/holidays');
      const deleted = deleteHolidayCalendar(id);
      output(
        { deleted },
        () => console.log(deleted ? chalk.green('Deleted.') : chalk.red('Not found.')),
      );
    });

  holidays.command('presets')
    .description('List available holiday presets')
    .action(async () => {
      const { listPresets } = await import('@/lib/wfm/presets');
      const presets = listPresets();
      output(
        { presets },
        () => {
          console.log(chalk.bold.cyan('\nHoliday Presets\n'));
          for (const p of presets) {
            console.log(`  ${chalk.bold(p.id.padEnd(16))} ${p.name.padEnd(30)} ${p.country}`);
          }
        },
      );
    });

  holidays.command('import-preset')
    .description('Import a holiday preset as a new calendar')
    .argument('<presetId>', 'Preset ID (e.g., us-federal)')
    .option('--year <year>', 'Year to generate', String(new Date().getFullYear()))
    .option('--name <name>', 'Custom calendar name')
    .action(async (presetId: string, opts: { year: string; name?: string }) => {
      const { getPresetById, generatePresetEntries } = await import('@/lib/wfm/presets');
      const preset = getPresetById(presetId);
      if (!preset) {
        console.log(chalk.red(`Unknown preset: ${presetId}`));
        return;
      }
      const entries = generatePresetEntries(presetId, parseInt(opts.year, 10));
      const { createHolidayCalendar } = await import('@/lib/wfm/holidays');
      const cal = createHolidayCalendar({
        name: opts.name ?? preset.name,
        description: preset.description,
        entries,
      });
      output(
        { calendar: cal },
        () => {
          console.log(chalk.green(`Imported "${cal.name}" with ${cal.entries.length} holidays`));
          for (const e of cal.entries) {
            console.log(chalk.gray(`  ${e.date}  ${e.name}`));
          }
        },
      );
    });
}
