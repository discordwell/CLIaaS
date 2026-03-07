import type { Command } from 'commander';
import chalk from 'chalk';
import {
  getInstallations,
  getInstallation,
  getInstallationByPluginId,
  installPlugin,
  uninstallPlugin,
  togglePlugin,
  updateInstallation,
} from '../../src/lib/plugins/store';
import { getListings, getListing, upsertListing } from '../../src/lib/plugins/marketplace-store';
import { getExecutionLogs } from '../../src/lib/plugins/execution-log';
import type { PluginManifestV2 } from '../../src/lib/plugins/types';
import { readFileSync } from 'fs';

export function registerPluginCommands(program: Command): void {
  const plugins = program
    .command('plugins')
    .description('Plugin management & marketplace');

  plugins
    .command('list')
    .description('List installed plugins')
    .option('--enabled', 'Show only enabled plugins')
    .option('--json', 'Output as JSON')
    .action(async (opts: { enabled?: boolean; json?: boolean }) => {
      try {
        let list = await getInstallations();
        if (opts.enabled) {
          list = list.filter(p => p.enabled);
        }

        if (opts.json) {
          console.log(JSON.stringify({ plugins: list }, null, 2));
          return;
        }

        console.log(chalk.bold.cyan(`\n${list.length} plugin(s) installed\n`));

        for (const p of list) {
          const statusColor = p.enabled ? chalk.green : chalk.gray;
          console.log(
            `  ${statusColor(`[${p.enabled ? 'ENABLED' : 'DISABLED'}]`)} ${p.pluginId} v${p.version}`,
          );
          console.log(`    ${chalk.dim(`ID: ${p.id} | Installed: ${p.createdAt}`)}`);
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed to list plugins: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  plugins
    .command('show <pluginId>')
    .description('Show plugin details')
    .option('--json', 'Output as JSON')
    .action(async (pluginId: string, opts: { json?: boolean }) => {
      try {
        const installation = await getInstallationByPluginId(pluginId);
        const listing = await getListing(pluginId);

        if (opts.json) {
          console.log(JSON.stringify({ installation, listing }, null, 2));
          return;
        }

        if (listing) {
          const m = listing.manifest;
          console.log(chalk.bold(`\n${m.name} v${m.version}`));
          console.log(`  ${m.description}`);
          console.log(`  Author: ${m.author}`);
          console.log(`  Runtime: ${m.runtime}`);
          console.log(`  Hooks: ${m.hooks.join(', ')}`);
          console.log(`  Permissions: ${m.permissions.join(', ')}`);
          console.log(`  Installs: ${listing.installCount} | Rating: ${listing.averageRating ?? 'N/A'}`);
        }

        if (installation) {
          console.log(chalk.bold('\n  Installation:'));
          console.log(`    Status: ${installation.enabled ? chalk.green('ENABLED') : chalk.gray('DISABLED')}`);
          console.log(`    Config: ${JSON.stringify(installation.config)}`);
          console.log(`    Installed: ${installation.createdAt}`);
        } else {
          console.log(chalk.gray('\n  Not installed'));
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  plugins
    .command('install <pluginId>')
    .description('Install a plugin from the marketplace')
    .option('--config <json>', 'Configuration JSON')
    .action(async (pluginId: string, opts: { config?: string }) => {
      try {
        const listing = await getListing(pluginId);
        if (!listing) {
          throw new Error(`Plugin "${pluginId}" not found in marketplace`);
        }

        const config = opts.config ? JSON.parse(opts.config) : {};
        const installation = await installPlugin({
          pluginId,
          version: listing.manifest.version,
          config,
          hooks: listing.manifest.hooks,
          dependencies: listing.manifest.dependencies,
        });

        console.log(chalk.bold.green(`\nPlugin installed: ${pluginId}`));
        console.log(`  ID: ${installation.id}`);
        console.log(`  Version: ${installation.version}`);
        console.log(`  Status: ${chalk.gray('DISABLED')} (use 'cliaas plugins enable ${pluginId}' to activate)`);
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  plugins
    .command('uninstall <pluginId>')
    .description('Uninstall a plugin')
    .action(async (pluginId: string) => {
      try {
        const installation = await getInstallationByPluginId(pluginId);
        if (!installation) {
          throw new Error(`Plugin "${pluginId}" is not installed`);
        }

        const result = await uninstallPlugin(installation.id);
        console.log(chalk.bold.green(`\nPlugin uninstalled: ${pluginId}\n`));
        if (result.dependents.length) {
          console.log(chalk.yellow(`  Warning: The following installed plugins depend on "${pluginId}": ${result.dependents.join(', ')}`));
          console.log(chalk.yellow('  They may not function correctly.\n'));
        }
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  plugins
    .command('enable <pluginId>')
    .description('Enable an installed plugin')
    .action(async (pluginId: string) => {
      try {
        const installation = await getInstallationByPluginId(pluginId);
        if (!installation) throw new Error(`Plugin "${pluginId}" is not installed`);

        await togglePlugin(installation.id, true);
        console.log(chalk.bold.green(`\nPlugin enabled: ${pluginId}\n`));
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  plugins
    .command('disable <pluginId>')
    .description('Disable an installed plugin')
    .action(async (pluginId: string) => {
      try {
        const installation = await getInstallationByPluginId(pluginId);
        if (!installation) throw new Error(`Plugin "${pluginId}" is not installed`);

        await togglePlugin(installation.id, false);
        console.log(chalk.bold.green(`\nPlugin disabled: ${pluginId}\n`));
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  plugins
    .command('config <pluginId>')
    .description('View or update plugin configuration')
    .option('--set <pairs...>', 'Set key=value pairs')
    .action(async (pluginId: string, opts: { set?: string[] }) => {
      try {
        const installation = await getInstallationByPluginId(pluginId);
        if (!installation) throw new Error(`Plugin "${pluginId}" is not installed`);

        if (!opts.set?.length) {
          console.log(JSON.stringify(installation.config, null, 2));
          return;
        }

        const newConfig = { ...installation.config };
        for (const pair of opts.set) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx < 0) throw new Error(`Invalid format: ${pair} (expected key=value)`);
          const key = pair.slice(0, eqIdx);
          const value = pair.slice(eqIdx + 1);
          try {
            newConfig[key] = JSON.parse(value);
          } catch {
            newConfig[key] = value;
          }
        }

        await updateInstallation(installation.id, { config: newConfig });
        console.log(chalk.bold.green(`\nConfig updated for ${pluginId}\n`));
        console.log(JSON.stringify(newConfig, null, 2));
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  plugins
    .command('logs <pluginId>')
    .description('View plugin execution logs')
    .option('--limit <n>', 'Number of log entries', '20')
    .action(async (pluginId: string, opts: { limit: string }) => {
      try {
        const installation = await getInstallationByPluginId(pluginId);
        if (!installation) throw new Error(`Plugin "${pluginId}" is not installed`);

        const logs = await getExecutionLogs(installation.id, { limit: parseInt(opts.limit, 10) });

        console.log(chalk.bold.cyan(`\n${logs.length} execution log(s) for ${pluginId}\n`));

        for (const log of logs) {
          const statusColor = log.status === 'success' ? chalk.green : chalk.red;
          console.log(
            `  ${statusColor(`[${log.status.toUpperCase()}]`)} ${log.hookName} ${chalk.dim(`(${log.durationMs}ms)`)}`,
          );
          console.log(`    ${chalk.dim(log.createdAt)}`);
          if (log.error) console.log(`    ${chalk.red(log.error)}`);
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  plugins
    .command('marketplace')
    .description('Browse the plugin marketplace')
    .option('--category <category>', 'Filter by category')
    .option('--search <query>', 'Search plugins')
    .option('--json', 'Output as JSON')
    .action(async (opts: { category?: string; search?: string; json?: boolean }) => {
      try {
        const listings = await getListings({
          category: opts.category,
          search: opts.search,
        });

        if (opts.json) {
          console.log(JSON.stringify({ listings }, null, 2));
          return;
        }

        console.log(chalk.bold.cyan(`\n${listings.length} plugin(s) available\n`));

        for (const l of listings) {
          const m = l.manifest;
          const rating = l.averageRating ? `${l.averageRating}/5` : 'No ratings';
          console.log(`  ${chalk.bold(m.name)} v${m.version} ${chalk.dim(`by ${m.author}`)}`);
          console.log(`    ${m.description}`);
          console.log(`    ${chalk.dim(`Installs: ${l.installCount} | Rating: ${rating} | ${l.featured ? chalk.yellow('FEATURED') : ''}`)}`);
          console.log('');
        }
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  plugins
    .command('publish <manifestPath>')
    .description('Publish a plugin manifest to the marketplace')
    .action(async (manifestPath: string) => {
      try {
        const raw = readFileSync(manifestPath, 'utf-8');
        const manifest: PluginManifestV2 = JSON.parse(raw);

        if (!manifest.id || !manifest.name || !manifest.version) {
          throw new Error('Manifest must include id, name, and version');
        }

        const listing = await upsertListing({
          pluginId: manifest.id,
          manifest,
          status: 'published',
        });

        console.log(chalk.bold.green(`\nPlugin published: ${manifest.name} v${manifest.version}`));
        console.log(`  ID: ${listing.pluginId}`);
        console.log(`  Status: ${listing.status}`);
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });
}
