/**
 * MCP tour tools: tour_list, tour_show, tour_create, tour_step_add, tour_toggle, tour_delete.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';
import {
  getTours,
  getTour,
  createTour,
  deleteTour,
  toggleTour,
  getTourSteps,
  addTourStep,
} from '@/lib/tours/tour-store.js';

export function registerTourTools(server: McpServer): void {
  server.tool(
    'tour_list',
    'List product tours',
    {},
    async () => {
      try {
        const tours = getTours();
        return textResult({
          total: tours.length,
          tours: tours.map(t => ({
            id: t.id,
            name: t.name,
            isActive: t.isActive,
            targetUrlPattern: t.targetUrlPattern,
            priority: t.priority,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list tours');
      }
    },
  );

  server.tool(
    'tour_show',
    'Show tour details including steps',
    { tourId: z.string().describe('Tour ID') },
    async ({ tourId }) => {
      const tour = getTour(tourId);
      if (!tour) return errorResult(`Tour "${tourId}" not found`);
      const steps = getTourSteps(tourId);
      return textResult({ tour, steps });
    },
  );

  server.tool(
    'tour_create',
    'Create a new product tour (requires confirm=true)',
    {
      name: z.string().describe('Tour name'),
      description: z.string().optional().describe('Tour description'),
      targetUrlPattern: z.string().optional().describe('URL pattern where tour appears'),
      priority: z.number().optional().describe('Priority (higher = shown first)'),
      confirm: z.boolean().optional().describe('Must be true to create'),
    },
    async ({ name, description, targetUrlPattern, priority, confirm }) => {
      const guard = scopeGuard('tour_create');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Create tour: "${name}"`,
        preview: { name, description, targetUrlPattern, priority },
        execute: () => {
          const tour = createTour({ name, description, targetUrlPattern, priority });
          recordMCPAction({
            tool: 'tour_create', action: 'create',
            params: { name }, timestamp: new Date().toISOString(), result: 'success',
          });
          return { created: true, tour: { id: tour.id, name: tour.name } };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  server.tool(
    'tour_step_add',
    'Add a step to a product tour (requires confirm=true)',
    {
      tourId: z.string().describe('Tour ID'),
      targetSelector: z.string().describe('CSS selector for target element'),
      title: z.string().describe('Step title'),
      body: z.string().optional().describe('Step body text'),
      placement: z.enum(['top', 'bottom', 'left', 'right', 'center']).optional().describe('Tooltip placement'),
      actionLabel: z.string().optional().describe('Action button label'),
      confirm: z.boolean().optional().describe('Must be true to add'),
    },
    async ({ tourId, targetSelector, title, body, placement, actionLabel, confirm }) => {
      const guard = scopeGuard('tour_step_add');
      if (guard) return guard;

      const tour = getTour(tourId);
      if (!tour) return errorResult(`Tour "${tourId}" not found`);

      const result = withConfirmation(confirm, {
        description: `Add step "${title}" to tour "${tour.name}"`,
        preview: { tourId, targetSelector, title },
        execute: () => {
          const step = addTourStep({ tourId, targetSelector, title, body, placement, actionLabel });
          recordMCPAction({
            tool: 'tour_step_add', action: 'add_step',
            params: { tourId, title }, timestamp: new Date().toISOString(), result: 'success',
          });
          return { added: true, step: { id: step.id, position: step.position, title: step.title } };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  server.tool(
    'tour_toggle',
    'Toggle a tour active/inactive (requires confirm=true)',
    {
      tourId: z.string().describe('Tour ID'),
      confirm: z.boolean().optional().describe('Must be true to toggle'),
    },
    async ({ tourId, confirm }) => {
      const guard = scopeGuard('tour_toggle');
      if (guard) return guard;

      const tour = getTour(tourId);
      if (!tour) return errorResult(`Tour "${tourId}" not found`);

      const result = withConfirmation(confirm, {
        description: `Toggle tour "${tour.name}" (currently ${tour.isActive ? 'active' : 'inactive'})`,
        preview: { tourId, currentlyActive: tour.isActive },
        execute: () => {
          const toggled = toggleTour(tourId);
          return { toggled: true, isActive: toggled!.isActive };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  server.tool(
    'tour_delete',
    'Delete a product tour (requires confirm=true)',
    {
      tourId: z.string().describe('Tour ID'),
      confirm: z.boolean().optional().describe('Must be true to delete'),
    },
    async ({ tourId, confirm }) => {
      const guard = scopeGuard('tour_delete');
      if (guard) return guard;

      const tour = getTour(tourId);
      if (!tour) return errorResult(`Tour "${tourId}" not found`);

      const result = withConfirmation(confirm, {
        description: `Delete tour "${tour.name}" and all its steps`,
        preview: { tourId, tourName: tour.name },
        execute: () => {
          deleteTour(tourId);
          return { deleted: true };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );
}
