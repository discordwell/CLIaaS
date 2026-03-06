/**
 * CLI commands for chatbot management.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import {
  getChatbots,
  getChatbot,
  upsertChatbot,
  deleteChatbot,
} from '@/lib/chatbot/store.js';
import { publishChatbot, rollbackChatbot, getChatbotVersions } from '@/lib/chatbot/versions.js';
import { evaluateBotResponse, initBotSession } from '@/lib/chatbot/runtime.js';
import { getFlowSummary } from '@/lib/chatbot/analytics.js';
import { CHATBOT_TEMPLATES } from '@/lib/chatbot/templates.js';
import type { ChatbotFlow } from '@/lib/chatbot/types.js';
import { randomUUID } from 'crypto';
import * as readline from 'readline';

export function registerChatbotCommands(program: Command): void {
  const chatbot = program
    .command('chatbot')
    .description('Chatbot flow management');

  chatbot
    .command('list')
    .description('List all chatbot flows')
    .action(async () => {
      const flows = await getChatbots();
      if (flows.length === 0) {
        console.log(chalk.dim('No chatbot flows found.'));
        return;
      }
      console.log(chalk.bold(`${flows.length} chatbot flow(s):\n`));
      for (const f of flows) {
        const status = f.enabled ? chalk.green('active') : chalk.dim('inactive');
        const version = f.version ? `v${f.version}` : '';
        console.log(`  ${status} ${chalk.bold(f.name)} ${chalk.dim(f.id.slice(0, 8))} ${chalk.dim(version)} — ${Object.keys(f.nodes).length} nodes`);
      }
    });

  chatbot
    .command('show')
    .description('Show chatbot flow details')
    .argument('<id>', 'Chatbot flow ID')
    .action(async (id: string) => {
      const flow = await getChatbot(id);
      if (!flow) {
        console.log(chalk.red('Chatbot not found'));
        return;
      }
      console.log(chalk.bold(flow.name));
      console.log(`  ID: ${flow.id}`);
      console.log(`  Status: ${flow.status ?? 'unknown'}`);
      console.log(`  Enabled: ${flow.enabled}`);
      console.log(`  Version: ${flow.version ?? 1}`);
      console.log(`  Nodes: ${Object.keys(flow.nodes).length}`);
      console.log(`  Root: ${flow.rootNodeId}`);
      console.log(`  Description: ${flow.description ?? 'none'}`);
      console.log(`  Created: ${flow.createdAt}`);
    });

  chatbot
    .command('create')
    .description('Create a new chatbot flow')
    .requiredOption('--name <name>', 'Flow name')
    .option('--template <key>', `Template: ${CHATBOT_TEMPLATES.map((t) => t.key).join(', ')}`)
    .action(async (opts: { name: string; template?: string }) => {
      const id = randomUUID();

      if (opts.template) {
        const tpl = CHATBOT_TEMPLATES.find((t) => t.key === opts.template);
        if (!tpl) {
          console.log(chalk.red(`Unknown template: ${opts.template}`));
          console.log(`Available: ${CHATBOT_TEMPLATES.map((t) => t.key).join(', ')}`);
          return;
        }
        const flow = tpl.createFlow(id);
        flow.name = opts.name;
        await upsertChatbot(flow);
        console.log(chalk.green(`Created "${opts.name}" from template "${opts.template}"`));
        console.log(`  ID: ${id}`);
        console.log(`  Nodes: ${Object.keys(flow.nodes).length}`);
      } else {
        const rootId = randomUUID();
        const flow: ChatbotFlow = {
          id,
          name: opts.name,
          nodes: {
            [rootId]: { id: rootId, type: 'message', data: { text: 'Hello! How can I help?' }, children: [] },
          },
          rootNodeId: rootId,
          enabled: false,
          version: 1,
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await upsertChatbot(flow);
        console.log(chalk.green(`Created "${opts.name}"`));
        console.log(`  ID: ${id}`);
      }
    });

  chatbot
    .command('publish')
    .description('Publish a chatbot flow')
    .argument('<id>', 'Chatbot flow ID')
    .action(async (id: string) => {
      const result = await publishChatbot(id);
      if (!result) {
        console.log(chalk.red('Chatbot not found'));
        return;
      }
      console.log(chalk.green(`Published version ${result.version}`));
    });

  chatbot
    .command('rollback')
    .description('Rollback to a specific version')
    .argument('<id>', 'Chatbot flow ID')
    .requiredOption('--version <n>', 'Target version number')
    .action(async (id: string, opts: { version: string }) => {
      const flow = await rollbackChatbot(id, parseInt(opts.version));
      if (!flow) {
        console.log(chalk.red('Version not found'));
        return;
      }
      console.log(chalk.green(`Rolled back to version ${opts.version}`));
    });

  chatbot
    .command('test')
    .description('Interactive CLI chat test')
    .argument('<id>', 'Chatbot flow ID')
    .action(async (id: string) => {
      const flow = await getChatbot(id);
      if (!flow) {
        console.log(chalk.red('Chatbot not found'));
        return;
      }

      console.log(chalk.bold(`Testing: ${flow.name}\n`));

      let state = initBotSession(flow);
      const resp = evaluateBotResponse(flow, state, '');
      if (resp.text) console.log(chalk.cyan(`Bot: ${resp.text}`));
      if (resp.buttons) {
        console.log(chalk.dim(`  Options: ${resp.buttons.map((b) => b.label).join(', ')}`));
      }
      state = resp.newState;

      if (resp.handoff || !state.currentNodeId) {
        console.log(chalk.dim('\n[Chat ended]'));
        return;
      }

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const prompt = () => {
        rl.question(chalk.yellow('You: '), (answer) => {
          if (answer === '/quit') {
            rl.close();
            return;
          }
          const r = evaluateBotResponse(flow, state, answer);
          if (r.text) console.log(chalk.cyan(`Bot: ${r.text}`));
          if (r.buttons) {
            console.log(chalk.dim(`  Options: ${r.buttons.map((b) => b.label).join(', ')}`));
          }
          if (r.delay) console.log(chalk.dim(`  [Delay: ${r.delay}s]`));
          if (r.aiRequest) console.log(chalk.dim('  [AI response would be generated]'));
          if (r.articleRequest) console.log(chalk.dim(`  [Articles: "${r.articleRequest.query}"]`));
          if (r.webhookRequest) console.log(chalk.dim(`  [Webhook: ${r.webhookRequest.method} ${r.webhookRequest.url}]`));
          for (const a of r.actions) {
            console.log(chalk.dim(`  [Action: ${a.actionType}${a.value ? ` = ${a.value}` : ''}]`));
          }
          if (r.handoff) {
            console.log(chalk.dim('\n[Handoff to agent — chat ended]'));
            rl.close();
            return;
          }
          state = r.newState;
          if (!state.currentNodeId) {
            console.log(chalk.dim('\n[Chat ended]'));
            rl.close();
            return;
          }
          prompt();
        });
      };
      prompt();
    });

  chatbot
    .command('analytics')
    .description('Show chatbot analytics summary')
    .argument('<id>', 'Chatbot flow ID')
    .option('--days <n>', 'Number of days', '30')
    .action(async (id: string, opts: { days: string }) => {
      const summary = await getFlowSummary(id, parseInt(opts.days));
      console.log(chalk.bold('Analytics Summary:'));
      console.log(`  Total sessions: ${summary.totalSessions}`);
      console.log(`  Completed: ${summary.completedSessions}`);
      console.log(`  Abandoned: ${summary.abandonedSessions}`);
      if (summary.topDropOffNodes.length > 0) {
        console.log('  Top drop-off nodes:');
        for (const n of summary.topDropOffNodes) {
          console.log(`    ${n.nodeId.slice(0, 8)}: ${n.dropOffs} drop-offs`);
        }
      }
    });

  chatbot
    .command('export')
    .description('Export chatbot flow as JSON')
    .argument('<id>', 'Chatbot flow ID')
    .action(async (id: string) => {
      const flow = await getChatbot(id);
      if (!flow) {
        console.log(chalk.red('Chatbot not found'));
        return;
      }
      console.log(JSON.stringify(flow, null, 2));
    });

  chatbot
    .command('import')
    .description('Import chatbot flow from JSON (stdin)')
    .action(async () => {
      let data = '';
      process.stdin.setEncoding('utf8');
      for await (const chunk of process.stdin) {
        data += chunk;
      }
      try {
        const flow = JSON.parse(data) as ChatbotFlow;
        if (!flow.id) flow.id = randomUUID();
        await upsertChatbot(flow);
        console.log(chalk.green(`Imported "${flow.name}" (${flow.id})`));
      } catch {
        console.log(chalk.red('Invalid JSON'));
      }
    });

  chatbot
    .command('delete')
    .description('Delete a chatbot flow')
    .argument('<id>', 'Chatbot flow ID')
    .action(async (id: string) => {
      const deleted = await deleteChatbot(id);
      if (!deleted) {
        console.log(chalk.red('Chatbot not found'));
        return;
      }
      console.log(chalk.green(`Deleted chatbot ${id}`));
    });

  chatbot
    .command('versions')
    .description('List version history')
    .argument('<id>', 'Chatbot flow ID')
    .action(async (id: string) => {
      const versions = await getChatbotVersions(id);
      if (versions.length === 0) {
        console.log(chalk.dim('No versions found (JSONL mode or never published)'));
        return;
      }
      for (const v of versions) {
        console.log(`  v${v.version} — ${v.createdAt}${v.summary ? ` (${v.summary})` : ''}`);
      }
    });
}
