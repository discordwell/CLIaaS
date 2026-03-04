/**
 * Shared output utility for CLIaaS CLI.
 *
 * Provides a unified interface for command output that respects the global
 * --json flag. When --json is active, structured data is emitted as JSON
 * and all decorative output (chalk colors, ora spinners, log messages) is
 * suppressed. When --json is not active, the normal human-friendly output
 * is produced.
 */

import chalk from 'chalk';

let _jsonMode = false;

/** Enable or disable JSON output mode. Called once from the CLI entry point. */
export function setJsonMode(enabled: boolean): void {
  _jsonMode = enabled;
  if (enabled) {
    // Disable chalk colors so any stray chalk usage doesn't pollute JSON
    chalk.level = 0;
  }
}

/** Returns true when the global --json flag is active. */
export function isJsonMode(): boolean {
  return _jsonMode;
}

/**
 * Print structured output. In JSON mode, emits the data as a single JSON
 * line to stdout. In normal mode, calls the provided `humanFn` formatter
 * to produce human-readable output.
 *
 * @param data     - The structured data to output (will be JSON.stringify'd in --json mode)
 * @param humanFn  - A function that prints human-formatted output (only called in normal mode)
 */
export function output<T>(data: T, humanFn: (data: T) => void): void {
  if (_jsonMode) {
    // In JSON mode: emit structured data
    process.stdout.write(JSON.stringify(data) + '\n');
  } else {
    // In normal mode: call the human-friendly formatter
    humanFn(data);
  }
}

/**
 * Print an informational message. Suppressed in JSON mode.
 */
export function info(msg: string): void {
  if (!_jsonMode) {
    console.log(msg);
  }
}

/**
 * Print an error message. In JSON mode, emits a JSON error object to stderr.
 * In normal mode, prints with chalk.red.
 */
export function outputError(msg: string): void {
  if (_jsonMode) {
    process.stderr.write(JSON.stringify({ error: msg }) + '\n');
  } else {
    console.error(chalk.red(msg));
  }
}

/**
 * Create a spinner-like wrapper. In JSON mode, returns a no-op object.
 * In normal mode, returns a real ora spinner.
 */
export function createSpinner(text: string): {
  start(): { succeed(msg?: string): void; fail(msg?: string): void; stop(): void };
  succeed(msg?: string): void;
  fail(msg?: string): void;
  stop(): void;
} {
  if (_jsonMode) {
    const noop = {
      start() { return noop; },
      succeed() {},
      fail() {},
      stop() {},
    };
    return noop;
  }

  // Lazy import ora to avoid loading it in JSON mode
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ora = require('ora');
  return ora(text);
}
