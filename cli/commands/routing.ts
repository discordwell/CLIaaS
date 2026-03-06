import type { Command } from 'commander';
import chalk from 'chalk';
import { output, isJsonMode } from '../output.js';
import {
  getRoutingConfig,
  getRoutingQueues,
  createRoutingQueue,
  getRoutingRules,
  createRoutingRule,
  getRoutingLog,
  getAgentSkills,
  setAgentSkills,
  getAgentCapacity,
  setAgentCapacity,
} from '@/lib/routing/store.js';
import { availability } from '@/lib/routing/availability.js';
import { routeTicket } from '@/lib/routing/engine.js';
import { getDataProvider } from '@/lib/data-provider/index.js';
import type { RoutingStrategy } from '@/lib/routing/types.js';

export function registerRoutingCommands(program: Command): void {
  const routing = program
    .command('routing')
    .description('Manage real-time ticket routing');

  // ---- status ----
  routing
    .command('status')
    .description('Show routing engine status, queue depths, agent availability')
    .action(() => {
      const config = getRoutingConfig();
      const queues = getRoutingQueues();
      const allAvail = availability.getAllAvailability();
      const log = getRoutingLog(undefined, 10);

      const data = {
        config,
        queues: queues.map(q => ({ id: q.id, name: q.name, strategy: q.strategy, enabled: q.enabled })),
        agentAvailability: {
          online: allAvail.filter(a => a.status === 'online').length,
          away: allAvail.filter(a => a.status === 'away').length,
          offline: allAvail.filter(a => a.status === 'offline').length,
        },
        recentRouting: log.length,
      };

      output(data, () => {
        console.log(chalk.bold('\nRouting Engine Status'));
        console.log('─'.repeat(40));
        console.log(`  Enabled:    ${config.enabled ? chalk.green('Yes') : chalk.red('No')}`);
        console.log(`  Strategy:   ${chalk.cyan(config.defaultStrategy)}`);
        console.log(`  Auto-route: ${config.autoRouteOnCreate ? chalk.green('Yes') : chalk.yellow('No')}`);
        console.log(`  Queues:     ${queues.length}`);
        console.log(`  Agents:     ${chalk.green(`${data.agentAvailability.online} online`)} / ${chalk.yellow(`${data.agentAvailability.away} away`)} / ${chalk.gray(`${data.agentAvailability.offline} offline`)}`);
        console.log(`  Recent:     ${log.length} routing events\n`);
      });
    });

  // ---- route ----
  routing
    .command('route')
    .description('Manually route a ticket')
    .argument('<ticketId>', 'Ticket ID to route')
    .option('--dir <dir>', 'Export directory override')
    .action(async (ticketId: string, opts: { dir?: string }) => {
      const provider = await getDataProvider(opts.dir);
      const tickets = await provider.loadTickets();
      const ticket = tickets.find(t => t.id === ticketId || t.externalId === ticketId);

      if (!ticket) {
        console.error(chalk.red(`Ticket "${ticketId}" not found.`));
        return;
      }

      const messages = await provider.loadMessages(ticket.id);
      const allAvail = availability.getAllAvailability();
      const allAgents = allAvail.map(a => ({ userId: a.userId, userName: a.userName }));

      const result = await routeTicket(ticket, { allAgents, messages });

      output(result, () => {
        if (result.suggestedAgentId) {
          console.log(chalk.green(`\nRouted to: ${result.suggestedAgentName} (${result.suggestedAgentId})`));
          console.log(`  Strategy:  ${result.strategy}`);
          console.log(`  Skills:    ${result.matchedSkills.join(', ') || 'none'}`);
          console.log(`  Confidence: ${(result.confidence * 100).toFixed(0)}%`);
          if (result.queueId) console.log(`  Queue:     ${result.queueId}`);
          if (result.ruleId) console.log(`  Rule:      ${result.ruleId}`);
        } else {
          console.log(chalk.yellow('\nNo eligible agent found. Ticket remains unassigned.'));
        }
        console.log(`  Reasoning: ${result.reasoning}\n`);
      });
    });

  // ---- queues ----
  routing
    .command('queues')
    .description('List routing queues')
    .action(() => {
      const queues = getRoutingQueues();
      output({ queues, total: queues.length }, () => {
        if (queues.length === 0) {
          console.log(chalk.yellow('No routing queues configured.'));
          return;
        }
        console.log(chalk.bold('\nRouting Queues'));
        for (const q of queues) {
          const status = q.enabled ? chalk.green('enabled') : chalk.red('disabled');
          console.log(`  ${q.name.padEnd(25)} ${q.strategy.padEnd(20)} ${status}  (${q.id})`);
        }
        console.log();
      });
    });

  // ---- queues create ----
  routing
    .command('queues-create')
    .description('Create a routing queue')
    .requiredOption('--name <name>', 'Queue name')
    .option('--strategy <strategy>', 'Strategy: round_robin, load_balanced, skill_match, priority_weighted', 'skill_match')
    .option('--priority <n>', 'Queue priority (higher = checked first)', '0')
    .option('--group-id <id>', 'Restrict to group')
    .action((opts: { name: string; strategy: string; priority: string; groupId?: string }) => {
      const queue = createRoutingQueue({
        workspaceId: '',
        name: opts.name,
        priority: parseInt(opts.priority, 10),
        conditions: {},
        strategy: opts.strategy as RoutingStrategy,
        groupId: opts.groupId,
        enabled: true,
      });
      output(queue, () => {
        console.log(chalk.green(`Created queue: ${queue.name} (${queue.id})`));
      });
    });

  // ---- rules ----
  routing
    .command('rules')
    .description('List routing rules')
    .action(() => {
      const rules = getRoutingRules();
      output({ rules, total: rules.length }, () => {
        if (rules.length === 0) {
          console.log(chalk.yellow('No routing rules configured.'));
          return;
        }
        console.log(chalk.bold('\nRouting Rules'));
        for (const r of rules) {
          const status = r.enabled ? chalk.green('enabled') : chalk.red('disabled');
          console.log(`  ${r.name.padEnd(25)} → ${r.targetType}:${r.targetId.slice(0, 8)}  ${status}  (${r.id})`);
        }
        console.log();
      });
    });

  // ---- log ----
  routing
    .command('log')
    .description('Show recent routing log')
    .option('--limit <n>', 'Number of entries', '20')
    .action((opts: { limit: string }) => {
      const log = getRoutingLog(undefined, parseInt(opts.limit, 10));
      output({ log, total: log.length }, () => {
        if (log.length === 0) {
          console.log(chalk.yellow('No routing log entries.'));
          return;
        }
        console.log(chalk.bold('\nRouting Log (most recent)'));
        for (const entry of log.slice(-10)) {
          const agent = entry.assignedUserId?.slice(0, 8) ?? 'unassigned';
          console.log(`  ${entry.createdAt.slice(0, 19)}  ${entry.ticketId.slice(0, 8)}  → ${agent}  [${entry.strategy}]  ${entry.durationMs}ms`);
        }
        console.log();
      });
    });

  // ---- analytics ----
  routing
    .command('analytics')
    .description('Show routing analytics summary')
    .action(() => {
      const log = getRoutingLog(undefined, 1000);
      const allAvail = availability.getAllAvailability();

      const totalRouted = log.length;
      const avgMs = totalRouted > 0
        ? Math.round(log.reduce((s, l) => s + (l.durationMs ?? 0), 0) / totalRouted)
        : 0;

      const data = {
        totalRouted,
        avgAssignmentMs: avgMs,
        agentCount: allAvail.length,
        online: allAvail.filter(a => a.status === 'online').length,
      };

      output(data, () => {
        console.log(chalk.bold('\nRouting Analytics'));
        console.log(`  Total routed:     ${totalRouted}`);
        console.log(`  Avg assignment:   ${avgMs}ms`);
        console.log(`  Agents tracked:   ${allAvail.length}`);
        console.log(`  Currently online: ${data.online}\n`);
      });
    });

  // ---- agents skills ----
  const agents = program.command('agents').description('Manage agent profiles');

  agents
    .command('skills')
    .description('List or set agent skills')
    .argument('[userId]', 'Agent user ID')
    .option('--set <skills>', 'Comma-separated skill names to set')
    .action((userId: string | undefined, opts: { set?: string }) => {
      if (userId && opts.set) {
        const skillNames = opts.set.split(',').map(s => s.trim()).filter(Boolean);
        const skills = setAgentSkills(userId, '', skillNames.map(s => ({ skillName: s })));
        output(skills, () => console.log(chalk.green(`Set ${skills.length} skills for ${userId}`)));
      } else {
        const skills = getAgentSkills(userId);
        output(skills, () => {
          if (skills.length === 0) {
            console.log(chalk.yellow('No skills found.'));
          } else {
            for (const s of skills) {
              console.log(`  ${s.userId.slice(0, 8)}  ${s.skillName}  (${s.proficiency})`);
            }
          }
        });
      }
    });

  agents
    .command('capacity')
    .description('List or set agent capacity')
    .argument('[userId]', 'Agent user ID')
    .option('--channel <type>', 'Channel type (email, chat, etc.)')
    .option('--max <n>', 'Max concurrent tickets')
    .action((userId: string | undefined, opts: { channel?: string; max?: string }) => {
      if (userId && opts.channel && opts.max) {
        const caps = setAgentCapacity(userId, '', [{ channelType: opts.channel, maxConcurrent: parseInt(opts.max, 10) }]);
        output(caps, () => console.log(chalk.green(`Set capacity for ${userId}: ${opts.channel} = ${opts.max}`)));
      } else {
        const caps = getAgentCapacity(userId);
        output(caps, () => {
          if (caps.length === 0) {
            console.log(chalk.yellow('No capacity rules found.'));
          } else {
            for (const c of caps) {
              console.log(`  ${c.userId.slice(0, 8)}  ${c.channelType}  max=${c.maxConcurrent}`);
            }
          }
        });
      }
    });

  agents
    .command('availability')
    .description('Show agent availability')
    .action(() => {
      const allAvail = availability.getAllAvailability();
      output(allAvail, () => {
        if (allAvail.length === 0) {
          console.log(chalk.yellow('No agents tracked.'));
          return;
        }
        for (const a of allAvail) {
          const color = a.status === 'online' ? chalk.green : a.status === 'away' ? chalk.yellow : chalk.gray;
          console.log(`  ${a.userName.padEnd(20)} ${color(a.status)}`);
        }
      });
    });
}
