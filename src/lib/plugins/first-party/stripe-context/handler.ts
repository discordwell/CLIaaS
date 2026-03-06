/**
 * Stripe Context plugin handler.
 * In production, this would use the Stripe API.
 */

import type { PluginHookContext, PluginHandlerResult } from '../../types';

export async function handle(context: PluginHookContext): Promise<PluginHandlerResult> {
  const { data, config } = context;
  const cfg = config ?? {};

  const lookupBy = (cfg.lookupBy as string) || 'email';
  const lookupValue = lookupBy === 'email'
    ? (data.requesterEmail as string) || 'unknown@example.com'
    : (data.customerId as string) || 'unknown';

  // In production: GET from Stripe API
  return {
    ok: true,
    data: {
      action: 'customer_lookup',
      lookupBy,
      lookupValue,
      showMRR: cfg.showMRR !== false,
      invoiceLimit: (cfg.invoiceLimit as number) || 5,
    },
  };
}
