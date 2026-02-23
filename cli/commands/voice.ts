import type { Command } from 'commander';
import chalk from 'chalk';

const BASE_URL = () => process.env.CLIAAS_API_URL || 'http://localhost:3000';

export function registerVoiceCommands(program: Command): void {
  const voice = program
    .command('voice')
    .description('Voice/phone channel management');

  voice
    .command('status')
    .description('Show voice channel status and recent calls')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const baseUrl = BASE_URL();
        const res = await fetch(`${baseUrl}/api/channels/voice`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log(chalk.bold.cyan('\nVoice Channel Status\n'));

        // Mode
        console.log(
          chalk.bold('Mode: ') +
            (data.demo
              ? chalk.yellow('Demo (no Twilio credentials)')
              : chalk.green('Live')),
        );

        // Stats
        console.log(chalk.bold('\nStats:'));
        console.log(`  Total calls:  ${data.stats?.total ?? 0}`);
        console.log(`  Completed:    ${data.stats?.completed ?? 0}`);
        console.log(`  Voicemails:   ${data.stats?.voicemails ?? 0}`);
        console.log(
          `  Active now:   ${chalk.bold(String(data.stats?.active ?? 0))}`,
        );

        // Agents
        const agents = data.agents ?? [];
        if (agents.length > 0) {
          console.log(chalk.bold('\nAgents:'));
          for (const a of agents) {
            const statusIcon =
              a.status === 'available'
                ? chalk.green('●')
                : a.status === 'busy'
                ? chalk.yellow('●')
                : chalk.gray('●');
            console.log(
              `  ${statusIcon} ${a.name} (ext. ${a.extension}) — ${a.status}`,
            );
          }
        }

        // Recent calls
        const calls = (data.calls ?? []).slice(0, 10);
        if (calls.length > 0) {
          console.log(chalk.bold('\nRecent Calls:'));
          for (const c of calls) {
            const dur = c.duration
              ? `${Math.floor(c.duration / 60)}:${(c.duration % 60)
                  .toString()
                  .padStart(2, '0')}`
              : '—';
            const status =
              c.status === 'completed'
                ? chalk.green(c.status)
                : c.status === 'in-progress'
                ? chalk.cyan(c.status)
                : c.status === 'voicemail'
                ? chalk.blue(c.status)
                : chalk.red(c.status);
            console.log(
              `  ${c.direction === 'inbound' ? '←' : '→'} ${c.from} [${status}] ${dur}`,
            );
          }
        }

        console.log('');
      } catch (err) {
        console.error(
          chalk.red(
            `Failed to fetch voice status: ${err instanceof Error ? err.message : 'Unknown error'}`,
          ),
        );
        process.exitCode = 1;
      }
    });

  voice
    .command('calls')
    .description('List all voice calls')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const baseUrl = BASE_URL();
        const res = await fetch(`${baseUrl}/api/channels/voice/calls`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log(chalk.bold.cyan(`\n${data.total} voice call(s) (${data.active} active)\n`));

        for (const c of data.calls ?? []) {
          const dur = c.duration
            ? `${Math.floor(c.duration / 60)}:${(c.duration % 60).toString().padStart(2, '0')}`
            : '—';
          console.log(
            `  ${c.direction === 'inbound' ? '←' : '→'} ${c.from} → ${c.to} [${c.status}] ${dur}`,
          );
        }
        console.log('');
      } catch (err) {
        console.error(
          chalk.red(
            `Failed to fetch calls: ${err instanceof Error ? err.message : 'Unknown error'}`,
          ),
        );
        process.exitCode = 1;
      }
    });
}
