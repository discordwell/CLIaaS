import type { Command } from 'commander';
import chalk from 'chalk';
import { output, isJsonMode } from '../output.js';

export function registerWfmCommands(program: Command): void {
  const wfm = program
    .command('wfm')
    .description('Workforce management — schedules, status, forecasting, adherence');

  // ---- Schedules ----
  const schedule = wfm.command('schedule').description('Manage agent schedules');

  schedule
    .command('list')
    .description('List agent schedules')
    .option('--user <userId>', 'Filter by user ID')
    .action(async (opts: { user?: string }) => {
      const { getSchedules } = await import('@/lib/wfm/schedules');
      const schedules = getSchedules(opts.user);

      output(
        { schedules, total: schedules.length },
        () => {
          console.log(chalk.bold.cyan('\nAgent Schedules\n'));
          if (schedules.length === 0) {
            console.log(chalk.gray('  No schedules found.'));
            return;
          }
          const header = `  ${'USER'.padEnd(20)} ${'FROM'.padEnd(12)} ${'TO'.padEnd(12)} ${'TZ'.padEnd(16)} SHIFTS`;
          console.log(chalk.gray(header));
          for (const s of schedules) {
            console.log(
              `  ${s.userName.padEnd(20)} ${s.effectiveFrom.padEnd(12)} ${(s.effectiveTo ?? '—').padEnd(12)} ${s.timezone.padEnd(16)} ${s.shifts.length}`,
            );
          }
        },
      );
    });

  schedule
    .command('create')
    .description('Create an agent schedule')
    .argument('<userId>', 'User ID')
    .argument('<userName>', 'User display name')
    .argument('<effectiveFrom>', 'Effective from date (YYYY-MM-DD)')
    .option('--template <templateId>', 'Apply a schedule template')
    .option('--timezone <tz>', 'Timezone', 'UTC')
    .option('--to <effectiveTo>', 'Effective to date (YYYY-MM-DD)')
    .action(async (userId: string, userName: string, effectiveFrom: string, opts: {
      template?: string;
      timezone: string;
      to?: string;
    }) => {
      const { createSchedule, applyTemplate } = await import('@/lib/wfm/schedules');

      const schedule = createSchedule({
        userId,
        userName,
        templateId: opts.template,
        effectiveFrom,
        effectiveTo: opts.to,
        timezone: opts.timezone,
        shifts: [],
      });

      if (opts.template) {
        applyTemplate(schedule.id, opts.template);
      }

      output(
        { schedule },
        () => {
          console.log(chalk.green(`Created schedule ${schedule.id} for ${userName}`));
          console.log(chalk.gray(`  From:     ${effectiveFrom}`));
          console.log(chalk.gray(`  Timezone: ${opts.timezone}`));
          if (opts.template) console.log(chalk.gray(`  Template: ${opts.template}`));
        },
      );
    });

  schedule
    .command('delete')
    .description('Delete an agent schedule')
    .argument('<id>', 'Schedule ID')
    .action(async (id: string) => {
      const { deleteSchedule } = await import('@/lib/wfm/schedules');
      const deleted = deleteSchedule(id);

      if (!deleted) {
        console.error(chalk.red(`Schedule ${id} not found.`));
        process.exit(1);
      }

      output({ deleted: true }, () => {
        console.log(chalk.green(`Deleted schedule ${id}`));
      });
    });

  // ---- Templates ----
  const template = wfm.command('template').description('Manage schedule templates');

  template
    .command('list')
    .description('List schedule templates')
    .action(async () => {
      const { getTemplates } = await import('@/lib/wfm/schedules');
      const templates = getTemplates();

      output(
        { templates, total: templates.length },
        () => {
          console.log(chalk.bold.cyan('\nSchedule Templates\n'));
          if (templates.length === 0) {
            console.log(chalk.gray('  No templates found.'));
            return;
          }
          for (const t of templates) {
            console.log(`  ${chalk.bold(t.name)} (${t.id})`);
            console.log(chalk.gray(`    ${t.shifts.length} shift blocks`));
          }
        },
      );
    });

  template
    .command('create')
    .description('Create a schedule template')
    .argument('<name>', 'Template name')
    .action(async (name: string) => {
      const { createTemplate } = await import('@/lib/wfm/schedules');
      const template = createTemplate({
        name,
        shifts: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' },
          { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', activity: 'work' },
          { dayOfWeek: 3, startTime: '09:00', endTime: '17:00', activity: 'work' },
          { dayOfWeek: 4, startTime: '09:00', endTime: '17:00', activity: 'work' },
          { dayOfWeek: 5, startTime: '09:00', endTime: '17:00', activity: 'work' },
        ],
      });

      output({ template }, () => {
        console.log(chalk.green(`Created template "${name}" (${template.id})`));
      });
    });

  template
    .command('delete')
    .description('Delete a schedule template')
    .argument('<id>', 'Template ID')
    .action(async (id: string) => {
      const { deleteTemplate } = await import('@/lib/wfm/schedules');
      const deleted = deleteTemplate(id);

      if (!deleted) {
        console.error(chalk.red(`Template ${id} not found.`));
        process.exit(1);
      }

      output({ deleted: true }, () => {
        console.log(chalk.green(`Deleted template ${id}`));
      });
    });

  // ---- Status ----
  wfm
    .command('status')
    .description('View or set agent status')
    .option('--user <userId>', 'Filter by user ID')
    .action(async (opts: { user?: string }) => {
      const { agentStatusTracker } = await import('@/lib/wfm/agent-status');

      if (opts.user) {
        const status = agentStatusTracker.getStatus(opts.user);
        output({ status }, () => {
          if (!status) {
            console.log(chalk.gray(`No status found for ${opts.user}`));
            return;
          }
          console.log(`${chalk.bold(status.userName)}: ${statusColor(status.status)}`);
          if (status.reason) console.log(chalk.gray(`  Reason: ${status.reason}`));
          console.log(chalk.gray(`  Since:  ${status.since}`));
        });
      } else {
        const statuses = agentStatusTracker.getAllStatuses();
        output({ statuses, total: statuses.length }, () => {
          console.log(chalk.bold.cyan('\nAgent Statuses\n'));
          if (statuses.length === 0) {
            console.log(chalk.gray('  No agents tracked.'));
            return;
          }
          for (const s of statuses) {
            console.log(`  ${s.userName.padEnd(20)} ${statusColor(s.status)}`);
          }
        });
      }
    });

  const statusSet = wfm.command('status-set').description('Set agent status');
  statusSet
    .argument('<userId>', 'User ID')
    .argument('<status>', 'Status: online, away, offline, on_break')
    .option('--name <userName>', 'User display name', 'CLI User')
    .option('--reason <reason>', 'Reason for status change')
    .action(async (userId: string, status: string, opts: { name: string; reason?: string }) => {
      const valid = ['online', 'away', 'offline', 'on_break'];
      if (!valid.includes(status)) {
        console.error(chalk.red(`Status must be one of: ${valid.join(', ')}`));
        process.exit(1);
      }

      const { agentStatusTracker } = await import('@/lib/wfm/agent-status');
      agentStatusTracker.setStatus(userId, opts.name, status as 'online' | 'away' | 'offline' | 'on_break', opts.reason);

      output({ updated: true }, () => {
        console.log(chalk.green(`Set ${opts.name} status to ${status}`));
      });
    });

  // ---- Time Off ----
  const timeOff = wfm.command('time-off').description('Manage time-off requests');

  timeOff
    .command('list')
    .description('List time-off requests')
    .option('--user <userId>', 'Filter by user')
    .option('--status <status>', 'Filter by status: pending, approved, denied')
    .action(async (opts: { user?: string; status?: string }) => {
      const { getTimeOffRequests } = await import('@/lib/wfm/time-off');
      const requests = getTimeOffRequests(opts.user, opts.status as 'pending' | 'approved' | 'denied' | undefined);

      output({ requests, total: requests.length }, () => {
        console.log(chalk.bold.cyan('\nTime-Off Requests\n'));
        if (requests.length === 0) {
          console.log(chalk.gray('  No requests found.'));
          return;
        }
        const header = `  ${'USER'.padEnd(20)} ${'FROM'.padEnd(12)} ${'TO'.padEnd(12)} STATUS`;
        console.log(chalk.gray(header));
        for (const r of requests) {
          const statusStr = r.status === 'approved' ? chalk.green(r.status) : r.status === 'denied' ? chalk.red(r.status) : chalk.yellow(r.status);
          console.log(`  ${r.userName.padEnd(20)} ${r.startDate.padEnd(12)} ${r.endDate.padEnd(12)} ${statusStr}`);
        }
      });
    });

  timeOff
    .command('request')
    .description('Submit a time-off request')
    .argument('<userId>', 'User ID')
    .argument('<startDate>', 'Start date (YYYY-MM-DD)')
    .argument('<endDate>', 'End date (YYYY-MM-DD)')
    .option('--name <userName>', 'User display name', 'CLI User')
    .option('--reason <reason>', 'Reason for time off')
    .action(async (userId: string, startDate: string, endDate: string, opts: { name: string; reason?: string }) => {
      const { requestTimeOff } = await import('@/lib/wfm/time-off');
      const req = requestTimeOff({ userId, userName: opts.name, startDate, endDate, reason: opts.reason });

      output({ request: req }, () => {
        console.log(chalk.green(`Time-off request created (${req.id})`));
        console.log(chalk.gray(`  ${startDate} to ${endDate}`));
      });
    });

  timeOff
    .command('approve')
    .description('Approve a time-off request')
    .argument('<id>', 'Request ID')
    .action(async (id: string) => {
      const { decideTimeOff } = await import('@/lib/wfm/time-off');
      const result = decideTimeOff(id, 'approved', 'cli-user');

      if (!result) {
        console.error(chalk.red(`Request ${id} not found.`));
        process.exit(1);
      }

      output({ request: result }, () => {
        console.log(chalk.green(`Approved time-off request ${id}`));
      });
    });

  timeOff
    .command('deny')
    .description('Deny a time-off request')
    .argument('<id>', 'Request ID')
    .action(async (id: string) => {
      const { decideTimeOff } = await import('@/lib/wfm/time-off');
      const result = decideTimeOff(id, 'denied', 'cli-user');

      if (!result) {
        console.error(chalk.red(`Request ${id} not found.`));
        process.exit(1);
      }

      output({ request: result }, () => {
        console.log(chalk.green(`Denied time-off request ${id}`));
      });
    });

  // ---- Forecast ----
  wfm
    .command('forecast')
    .description('Show volume forecast and staffing recommendations')
    .option('--days <n>', 'Days ahead to forecast', '7')
    .option('--channel <channel>', 'Filter by channel')
    .action(async (opts: { days: string; channel?: string }) => {
      const { getVolumeSnapshots } = await import('@/lib/wfm/store');
      const { generateForecast, calculateStaffing } = await import('@/lib/wfm/forecast');
      const { getSchedules } = await import('@/lib/wfm/schedules');

      let snapshots = getVolumeSnapshots();
      if (opts.channel) {
        snapshots = snapshots.filter(s => s.channel === opts.channel);
      }

      const forecast = generateForecast(snapshots, { daysAhead: parseInt(opts.days, 10) || 7 });
      const staffing = calculateStaffing(forecast, getSchedules());

      output({ forecast, staffing }, () => {
        console.log(chalk.bold.cyan('\nVolume Forecast\n'));
        if (forecast.length === 0) {
          console.log(chalk.gray('  No forecast data available.'));
          return;
        }
        const header = `  ${'HOUR'.padEnd(22)} ${'PREDICTED'.padEnd(12)} CONFIDENCE`;
        console.log(chalk.gray(header));
        for (const f of forecast.slice(0, 24)) {
          console.log(
            `  ${f.hour.padEnd(22)} ${String(f.predictedVolume).padEnd(12)} ${f.confidence.low}–${f.confidence.high}`,
          );
        }
        console.log(chalk.gray(`  ... ${forecast.length} total forecast points`));

        if (staffing.length > 0) {
          console.log(chalk.bold.cyan('\nStaffing Recommendations\n'));
          const sHeader = `  ${'HOUR'.padEnd(22)} ${'NEED'.padEnd(8)} ${'SCHEDULED'.padEnd(12)} GAP`;
          console.log(chalk.gray(sHeader));
          for (const s of staffing.filter(r => r.gap !== 0).slice(0, 10)) {
            const gapStr = s.gap > 0 ? chalk.red(`+${s.gap}`) : chalk.green(`${s.gap}`);
            console.log(
              `  ${s.hour.padEnd(22)} ${String(s.requiredAgents).padEnd(8)} ${String(s.scheduledAgents).padEnd(12)} ${gapStr}`,
            );
          }
        }
      });
    });

  // ---- Adherence ----
  wfm
    .command('adherence')
    .description('Show real-time schedule adherence')
    .action(async () => {
      const { getSchedules } = await import('@/lib/wfm/schedules');
      const { agentStatusTracker } = await import('@/lib/wfm/agent-status');
      const { getCurrentAdherence } = await import('@/lib/wfm/adherence');

      const adherence = getCurrentAdherence(getSchedules(), agentStatusTracker.getAllStatuses());

      output({ adherence, total: adherence.length }, () => {
        console.log(chalk.bold.cyan('\nSchedule Adherence\n'));
        if (adherence.length === 0) {
          console.log(chalk.gray('  No on-shift agents.'));
          return;
        }
        const header = `  ${'AGENT'.padEnd(20)} ${'SCHEDULED'.padEnd(12)} ${'ACTUAL'.padEnd(12)} ADHERENT`;
        console.log(chalk.gray(header));
        for (const a of adherence) {
          const adherentStr = a.adherent ? chalk.green('YES') : chalk.red('NO');
          console.log(
            `  ${a.userName.padEnd(20)} ${a.scheduledActivity.padEnd(12)} ${a.actualStatus.padEnd(12)} ${adherentStr}`,
          );
        }
      });
    });

  // ---- Utilization ----
  wfm
    .command('utilization')
    .description('Show agent utilization metrics')
    .option('--user <userId>', 'Filter by user')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .action(async (opts: { user?: string; from?: string; to?: string }) => {
      const { getTimeEntries } = await import('@/lib/time-tracking');
      const { getStatusLog } = await import('@/lib/wfm/store');
      const { getSchedules } = await import('@/lib/wfm/schedules');
      const { calculateUtilization } = await import('@/lib/wfm/utilization');

      const utilization = calculateUtilization(
        getTimeEntries({ userId: opts.user, from: opts.from, to: opts.to }),
        getStatusLog(),
        getSchedules(opts.user),
        { userId: opts.user, from: opts.from, to: opts.to },
      );

      output({ utilization, total: utilization.length }, () => {
        console.log(chalk.bold.cyan('\nAgent Utilization\n'));
        if (utilization.length === 0) {
          console.log(chalk.gray('  No utilization data.'));
          return;
        }
        const header = `  ${'AGENT'.padEnd(20)} ${'HANDLE'.padEnd(10)} ${'AVAILABLE'.padEnd(12)} OCCUPANCY`;
        console.log(chalk.gray(header));
        for (const u of utilization) {
          console.log(
            `  ${u.userName.padEnd(20)} ${formatMinutes(u.handleMinutes).padEnd(10)} ${formatMinutes(u.availableMinutes).padEnd(12)} ${u.occupancy.toFixed(1)}%`,
          );
        }
      });
    });

  // ---- Business Hours ----
  const bh = wfm.command('business-hours').description('Manage business hours');

  bh
    .command('list')
    .description('List business hours configurations')
    .action(async () => {
      const { getBusinessHours } = await import('@/lib/wfm/business-hours');
      const configs = getBusinessHours();

      output({ businessHours: configs, total: configs.length }, () => {
        console.log(chalk.bold.cyan('\nBusiness Hours\n'));
        if (configs.length === 0) {
          console.log(chalk.gray('  No configurations found.'));
          return;
        }
        for (const c of configs) {
          console.log(`  ${chalk.bold(c.name)} (${c.id}) ${c.isDefault ? chalk.green('[DEFAULT]') : ''}`);
          console.log(chalk.gray(`    Timezone: ${c.timezone}`));
          const days = Object.keys(c.schedule).length;
          console.log(chalk.gray(`    ${days} active days, ${c.holidays.length} holidays`));
        }
      });
    });

  bh
    .command('create')
    .description('Create a business hours configuration')
    .argument('<name>', 'Configuration name')
    .option('--timezone <tz>', 'Timezone', 'UTC')
    .option('--default', 'Set as default')
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

      output({ businessHours: config }, () => {
        console.log(chalk.green(`Created business hours "${name}" (${config.id})`));
      });
    });

  bh
    .command('delete')
    .description('Delete a business hours configuration')
    .argument('<id>', 'Configuration ID')
    .action(async (id: string) => {
      const { deleteBusinessHours } = await import('@/lib/wfm/business-hours');
      const deleted = deleteBusinessHours(id);

      if (!deleted) {
        console.error(chalk.red(`Business hours ${id} not found.`));
        process.exit(1);
      }

      output({ deleted: true }, () => {
        console.log(chalk.green(`Deleted business hours ${id}`));
      });
    });
}

function statusColor(status: string): string {
  switch (status) {
    case 'online': return chalk.green(status);
    case 'away': return chalk.yellow(status);
    case 'on_break': return chalk.blue(status);
    case 'offline': return chalk.gray(status);
    default: return status;
  }
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
