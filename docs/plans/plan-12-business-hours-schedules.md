# Plan 12: Configurable Business Hours, Timezone Support & Holiday Calendars

## 1. Summary of What Exists Today

### SLA Engine (Calendar Time Only)
- **`src/lib/sla.ts:263-362`**: `checkTicketSLA()` calculates elapsed time as raw millisecond difference between `createdAt` and `now` (or `firstReplyAt`/`resolvedAt`). No business hours awareness whatsoever. Lines 276, 282, 292, 305, 314, 319 all use `getTime()` arithmetic with no filtering for non-business periods.
- **`src/lib/sla.ts:5-24`**: `SLAPolicy` type has `targets.firstResponse` and `targets.resolution` in minutes, but no reference to a business hours schedule. The `schedules` JSONB column in the DB table is repurposed to store `conditions` and `escalation` data (line 130-139, 204), not actual time schedules.
- **`src/lib/sla.ts:238-255`**: `ticketMatchesPolicy()` matches on priority, tags, source. No group/brand/schedule matching.

### SLA DB Schema
- **`src/db/schema.ts:446-458`**: `sla_policies` table has a `schedules` JSONB column, but it stores conditions/escalation metadata, not business hours schedules. No FK to any schedule table.
- **`src/db/schema.ts:460-474`**: `sla_events` table tracks breach detection with `dueAt` and `breachedAt` timestamps. Due times are calculated against calendar time.

### SLA CLI Command (Hardcoded Policies)
- **`cli/commands/sla.ts:12-17`**: `DEFAULT_SLAS` array hardcodes 4 priority-based policies with hours-based targets. No configurable schedules, no business hours concept.
- **`cli/commands/sla.ts:64-85`**: Elapsed time calculated as `now - createdAt` with no business hours filtering.

### SLA MCP Tool (Hardcoded Policies)
- **`cli/mcp/tools/queue.ts:76-161`**: `sla_report` tool duplicates the CLI's hardcoded `DEFAULT_SLAS` (line 91-96) and uses the same raw elapsed time calculation.

### SLA UI Page
- **`src/app/sla/_content.tsx:1-567`**: Full SLA management page with policy CRUD form, per-ticket SLA check, and policy list. No business hours field in the create form. Targets are specified in raw minutes with no schedule association.
- **`src/app/sla/page.tsx:1-10`**: Wrapped in `FeatureGate` for `sla_management`.

### SLA API Routes
- **`src/app/api/sla/route.ts`**: GET (list) and POST (create) for SLA policies. No business hours parameter accepted.
- **`src/app/api/sla/check/route.ts`**: POST to check a ticket's SLA status. Calls `checkTicketSLA()` which uses calendar time.

### Timezone Handling (Minimal)
- **`src/db/schema.ts:145`**: `workspaces` table has a `timezone` column (default `'UTC'`), but it is not used anywhere in SLA calculations, routing, or scheduling.
- **`src/db/schema.ts:212`**: `customers` table has a `timezone` column for customer locale preferences.
- **`src/db/schema.ts:168`**: `users` table has NO timezone column.

### Groups (No Schedule Association)
- **`src/db/schema.ts:230-236`**: `groups` table has only `id`, `workspaceId`, `name`, and timestamps. No business hours schedule reference.

### Routing (No Schedule Awareness)
- **`src/lib/routing/availability.ts`**: Agent availability is online/away/offline status tracking. `isAvailableForRouting()` (line 78-81) checks status only, not schedule.
- **`src/lib/routing/strategies.ts`**: Four strategies (round_robin, load_balanced, skill_match, priority_weighted). None consider business hours or agent schedules.
- **`src/lib/routing/types.ts`**: `RoutingConfig`, `RoutingQueue`, `RoutingRule` types have no schedule/business hours fields.

### Automation Scheduler
- **`src/lib/automation/scheduler.ts`**: Runs time-based automation rules on a 60-second tick. Enriches tickets with `hoursSinceCreated`/`hoursSinceUpdated` (lines 98-99) using raw calendar time. Could be extended to pass business hours elapsed time.

### Brands (No Schedule Association)
- **`src/db/schema.ts:269-285`**: `brands` table has no business hours reference.

### What's Completely Missing
- No business hours / schedule table
- No holiday calendar
- No business-hours-aware SLA elapsed time calculation
- No "next business day" utility
- No timezone-aware time display in the UI
- No schedule-to-group/brand/SLA-policy association
- No CLI commands for business hours management
- No MCP tools for business hours
- No UI for configuring weekly schedules or holidays

---

## 2. Proposed DB Schema Changes

### New Tables

```sql
-- Business hours schedules: reusable weekly schedule definitions
CREATE TABLE business_hours_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,              -- e.g., "US East Coast", "EMEA Support"
  timezone TEXT NOT NULL DEFAULT 'UTC',  -- IANA timezone, e.g., "America/New_York"
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX bh_schedules_workspace_name_idx
  ON business_hours_schedules(workspace_id, name);
-- At most one default per workspace
CREATE UNIQUE INDEX bh_schedules_workspace_default_idx
  ON business_hours_schedules(workspace_id) WHERE is_default = true;

-- Daily intervals within a schedule (multiple intervals per day allowed)
-- e.g., Mon 09:00-12:00 + Mon 13:00-17:00 (with lunch break)
CREATE TABLE business_hours_intervals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES business_hours_schedules(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  start_time TIME NOT NULL,  -- e.g., '09:00'
  end_time TIME NOT NULL,    -- e.g., '17:00'
  CHECK (end_time > start_time)
);
CREATE INDEX bh_intervals_schedule_idx ON business_hours_intervals(schedule_id);

-- Holiday calendars: named sets of holidays
CREATE TABLE holiday_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,  -- e.g., "US Federal Holidays 2026"
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX holiday_calendars_workspace_name_idx
  ON holiday_calendars(workspace_id, name);

-- Individual holidays within a calendar
CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES holiday_calendars(id) ON DELETE CASCADE,
  name TEXT NOT NULL,         -- e.g., "Christmas Day"
  date DATE NOT NULL,         -- e.g., '2026-12-25'
  recurring BOOLEAN NOT NULL DEFAULT false,  -- true = repeats annually (ignore year)
  start_time TIME,            -- NULL = full day off; set for partial-day holidays
  end_time TIME               -- NULL = full day off
);
CREATE INDEX holidays_calendar_date_idx ON holidays(calendar_id, date);

-- Link schedules to holiday calendars (many-to-many)
CREATE TABLE business_hours_schedule_holidays (
  schedule_id UUID NOT NULL REFERENCES business_hours_schedules(id) ON DELETE CASCADE,
  calendar_id UUID NOT NULL REFERENCES holiday_calendars(id) ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, calendar_id)
);
```

### Modified Tables

```sql
-- groups: associate a business hours schedule
ALTER TABLE groups ADD COLUMN business_hours_schedule_id UUID
  REFERENCES business_hours_schedules(id);

-- brands: associate a business hours schedule
ALTER TABLE brands ADD COLUMN business_hours_schedule_id UUID
  REFERENCES business_hours_schedules(id);

-- sla_policies: associate a business hours schedule for SLA calculation
ALTER TABLE sla_policies ADD COLUMN business_hours_schedule_id UUID
  REFERENCES business_hours_schedules(id);
-- When NULL, SLA uses calendar time (backward compatible).
-- When set, elapsed time counts only business hours.

-- users: add timezone for display preferences
ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'UTC';
```

### Drizzle Schema Additions

New tables in `src/db/schema.ts`:

```typescript
export const businessHoursSchedules = pgTable(
  'business_hours_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    bhSchedulesWorkspaceNameIdx: uniqueIndex('bh_schedules_workspace_name_idx').on(
      table.workspaceId, table.name,
    ),
  }),
);

export const businessHoursIntervals = pgTable(
  'business_hours_intervals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scheduleId: uuid('schedule_id').notNull().references(() => businessHoursSchedules.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('day_of_week').notNull(), // 0=Sunday .. 6=Saturday
    startTime: text('start_time').notNull(),     // 'HH:MM' format
    endTime: text('end_time').notNull(),         // 'HH:MM' format
  },
  table => ({
    bhIntervalsScheduleIdx: index('bh_intervals_schedule_idx').on(table.scheduleId),
  }),
);

export const holidayCalendars = pgTable(
  'holiday_calendars',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    holidayCalendarsWorkspaceNameIdx: uniqueIndex('holiday_calendars_workspace_name_idx').on(
      table.workspaceId, table.name,
    ),
  }),
);

export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    calendarId: uuid('calendar_id').notNull().references(() => holidayCalendars.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    date: text('date').notNull(),        // ISO date 'YYYY-MM-DD'
    recurring: boolean('recurring').notNull().default(false),
    startTime: text('start_time'),       // NULL = full day; 'HH:MM' for partial
    endTime: text('end_time'),           // NULL = full day; 'HH:MM' for partial
  },
  table => ({
    holidaysCalendarDateIdx: index('holidays_calendar_date_idx').on(table.calendarId, table.date),
  }),
);

export const businessHoursScheduleHolidays = pgTable(
  'business_hours_schedule_holidays',
  {
    scheduleId: uuid('schedule_id').notNull().references(() => businessHoursSchedules.id, { onDelete: 'cascade' }),
    calendarId: uuid('calendar_id').notNull().references(() => holidayCalendars.id, { onDelete: 'cascade' }),
  },
  table => ({
    pk: primaryKey({ columns: [table.scheduleId, table.calendarId] }),
  }),
);
```

Column additions to existing tables:

```typescript
// groups table: add businessHoursScheduleId
businessHoursScheduleId: uuid('business_hours_schedule_id')
  .references(() => businessHoursSchedules.id),

// brands table: add businessHoursScheduleId
businessHoursScheduleId: uuid('business_hours_schedule_id')
  .references(() => businessHoursSchedules.id),

// slaPolicies table: add businessHoursScheduleId
businessHoursScheduleId: uuid('business_hours_schedule_id')
  .references(() => businessHoursSchedules.id),

// users table: add timezone
timezone: text('timezone').default('UTC'),
```

---

## 3. New API Routes

### Business Hours Schedules

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/business-hours` | List all schedules for workspace |
| POST | `/api/business-hours` | Create schedule with intervals |
| GET | `/api/business-hours/[id]` | Get schedule with intervals + linked calendars |
| PUT | `/api/business-hours/[id]` | Update schedule name/timezone/intervals |
| DELETE | `/api/business-hours/[id]` | Delete schedule (fail if in use by SLA/group/brand) |
| POST | `/api/business-hours/[id]/check` | Check if a given timestamp is within business hours |
| GET | `/api/business-hours/[id]/next-open` | Get next business hours opening from a given time |

### Holiday Calendars

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/holidays` | List all holiday calendars for workspace |
| POST | `/api/holidays` | Create holiday calendar |
| GET | `/api/holidays/[id]` | Get calendar with all holidays |
| PUT | `/api/holidays/[id]` | Update calendar name + holidays |
| DELETE | `/api/holidays/[id]` | Delete calendar (cascade removes holidays) |
| POST | `/api/holidays/[id]/dates` | Add individual holiday dates |
| DELETE | `/api/holidays/[id]/dates/[dateId]` | Remove a holiday date |

### Schedule Linkage

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/business-hours/[id]/calendars` | Link a holiday calendar to a schedule |
| DELETE | `/api/business-hours/[id]/calendars/[calendarId]` | Unlink a holiday calendar |

### Modified Existing Routes

| Route | Change |
|-------|--------|
| `POST /api/sla` | Accept optional `businessHoursScheduleId` |
| `PUT /api/sla/[id]` | Accept optional `businessHoursScheduleId` (new route) |
| `POST /api/sla/check` | Use business hours calculation when policy has a schedule |

---

## 4. New/Modified UI Pages & Components

### New Page: `/business-hours`

**`src/app/business-hours/page.tsx`** + **`src/app/business-hours/_content.tsx`**

Gated behind `sla_management` feature flag (reuse existing gate since business hours is an SLA-adjacent feature).

#### Weekly Grid Editor Component
- **`src/components/WeeklyScheduleEditor.tsx`**: Interactive grid showing Mon-Sun with draggable time blocks.
  - 7 rows (one per day), each with toggle (open/closed) and start/end time pickers.
  - Support for multiple intervals per day (e.g., 09:00-12:00 + 13:00-17:00).
  - "Copy to all weekdays" shortcut button.
  - Visual timeline bar (24h) showing open periods in green.
  - Timezone selector (IANA timezone list, searchable dropdown).

#### Holiday Calendar Manager Component
- **`src/components/HolidayCalendarEditor.tsx`**:
  - List of holidays with name, date, recurring toggle.
  - "Add Holiday" form with date picker and name input.
  - Bulk import: paste a list of dates or select a preset (US Federal, UK Bank Holidays, etc.).
  - Calendar view showing holidays highlighted on a month grid.

#### Page Sections
1. **Header**: Schedule count, "New Schedule" button.
2. **Schedule List**: Table of all schedules with name, timezone, linked groups/brands, holiday calendar count.
3. **Create/Edit Form**: Name, timezone picker, weekly grid editor, holiday calendar selector (multi-select of existing calendars).
4. **Holiday Calendars Tab**: Separate section for managing holiday calendar definitions.

### Modified Page: `/sla`

**`src/app/sla/_content.tsx`** modifications:

- Add "Business Hours Schedule" dropdown to the SLA policy create form (between targets and escalations sections).
  - Options: "Calendar Time (24/7)" + all workspace business hours schedules.
  - When a schedule is selected, show a note: "SLA targets will be calculated against business hours only."
- Policy list table: add "Schedule" column showing the linked business hours schedule name or "24/7".
- SLA check results: show "Business Hours Elapsed" vs "Calendar Elapsed" when a schedule is active.

### Modified Component: Settings

- **`src/app/settings/_content.tsx`** (or equivalent): Add user timezone preference setting.
- Display timestamps in agent's local timezone throughout the UI when the preference is set.

### New Shared Components

| Component | Purpose |
|-----------|---------|
| `TimezoneSelector.tsx` | Searchable dropdown of IANA timezones with offset display |
| `WeeklyScheduleEditor.tsx` | Visual weekly grid for business hours intervals |
| `HolidayCalendarEditor.tsx` | Holiday date management with recurring support |
| `BusinessHoursIndicator.tsx` | Small badge showing "Open" / "Closed" with next open/close time |

---

## 5. New CLI Commands

### `cliaas business-hours` command group

```
cliaas business-hours list
  List all business hours schedules.

cliaas business-hours show <id|name>
  Show a schedule with its intervals and linked holidays.

cliaas business-hours create --name <name> --timezone <tz>
    --mon "09:00-17:00" --tue "09:00-17:00" ...
    [--holiday-calendar <id>]
  Create a new business hours schedule.
  Days without flags default to closed.
  Multiple intervals per day: --mon "09:00-12:00,13:00-17:00"

cliaas business-hours update <id> [--name <name>] [--timezone <tz>]
    [--mon "09:00-17:00"] ...
  Update an existing schedule.

cliaas business-hours delete <id>
  Delete a schedule (fails if linked to SLA/group/brand).

cliaas business-hours check <id> [--at <ISO timestamp>]
  Check if a given time (default: now) is within business hours.

cliaas business-hours next-open <id> [--from <ISO timestamp>]
  Show the next business hours opening.

cliaas business-hours elapsed <id> --from <ISO timestamp> --to <ISO timestamp>
  Calculate business hours elapsed between two timestamps.
```

### `cliaas holidays` command group

```
cliaas holidays list
  List all holiday calendars.

cliaas holidays show <id|name>
  Show a calendar with all dates.

cliaas holidays create --name <name>
  Create a new holiday calendar.

cliaas holidays add-date <calendar-id> --name <name> --date <YYYY-MM-DD>
    [--recurring] [--start-time HH:MM] [--end-time HH:MM]
  Add a holiday to a calendar.

cliaas holidays remove-date <holiday-id>
  Remove a holiday date.

cliaas holidays delete <calendar-id>
  Delete a holiday calendar.

cliaas holidays presets
  List available holiday presets (US Federal, UK Bank, etc.).

cliaas holidays import-preset <calendar-id> --preset <preset-name> --year <year>
  Import a preset's holidays into a calendar.
```

### Modified CLI Commands

| Command | Change |
|---------|--------|
| `cliaas sla` | Show business hours schedule name alongside SLA targets. Calculate elapsed time using business hours when schedule is linked. |

---

## 6. New MCP Tools

### Business Hours Tools (new module: `cli/mcp/tools/business-hours.ts`)

| Tool | Description | Parameters |
|------|-------------|------------|
| `business_hours_list` | List all business hours schedules | `workspaceId?` |
| `business_hours_show` | Show schedule with intervals and holidays | `id` |
| `business_hours_create` | Create a business hours schedule | `name, timezone, intervals[], holidayCalendarIds?` |
| `business_hours_update` | Update a schedule | `id, name?, timezone?, intervals?` |
| `business_hours_delete` | Delete a schedule | `id, confirm` |
| `business_hours_check` | Check if a time is within business hours | `scheduleId, at?` |
| `business_hours_next_open` | Get next opening time | `scheduleId, from?` |
| `business_hours_elapsed` | Calculate business hours between two times | `scheduleId, from, to` |
| `holiday_calendar_list` | List holiday calendars | `workspaceId?` |
| `holiday_calendar_show` | Show calendar with dates | `id` |
| `holiday_calendar_create` | Create holiday calendar | `name, holidays?[]` |
| `holiday_add_date` | Add holiday to calendar | `calendarId, name, date, recurring?` |
| `holiday_remove_date` | Remove a holiday | `holidayId, confirm` |

### Modified MCP Tools

| Tool | Change |
|------|--------|
| `sla_report` (`cli/mcp/tools/queue.ts`) | Replace hardcoded `DEFAULT_SLAS` with actual policy lookup. Use business hours calculation when schedule is linked. Add `scheduleId` to output. |
| `rule_create` (`cli/mcp/tools/actions.ts`) | Accept `businessHoursScheduleId` for SLA-type rules. |

---

## 7. New Library Modules

### `src/lib/business-hours.ts` (Core Engine)

The heart of the feature. Pure functions, no DB dependency (operates on loaded schedule data).

```typescript
// Core types
interface BusinessHoursSchedule {
  id: string;
  name: string;
  timezone: string;
  intervals: BusinessHoursInterval[];
  holidays: Holiday[];
}

interface BusinessHoursInterval {
  dayOfWeek: number;    // 0=Sunday
  startTime: string;    // 'HH:MM'
  endTime: string;      // 'HH:MM'
}

interface Holiday {
  name: string;
  date: string;         // 'YYYY-MM-DD'
  recurring: boolean;
  startTime?: string;   // partial day
  endTime?: string;
}

// Core functions
function isWithinBusinessHours(schedule: BusinessHoursSchedule, at: Date): boolean;
function nextBusinessHoursOpen(schedule: BusinessHoursSchedule, from: Date): Date;
function nextBusinessHoursClose(schedule: BusinessHoursSchedule, from: Date): Date;
function calculateBusinessMinutes(schedule: BusinessHoursSchedule, from: Date, to: Date): number;
function nextBusinessDay(schedule: BusinessHoursSchedule, from: Date): Date;
function addBusinessMinutes(schedule: BusinessHoursSchedule, from: Date, minutes: number): Date;
function isHoliday(schedule: BusinessHoursSchedule, date: Date): boolean;
```

Key implementation notes:
- All calculations convert to the schedule's timezone using `Intl.DateTimeFormat` with `timeZone` option (no external dependency needed; Node.js has full IANA tz support).
- `calculateBusinessMinutes()` iterates day-by-day from `from` to `to`, summing only intervals that overlap with business hours and are not holidays. Optimized with early exits for same-day calculations.
- `addBusinessMinutes()` is the inverse: given a start time and a number of business minutes, returns the calendar timestamp when those minutes would have elapsed. Used for SLA `dueAt` calculation.

### `src/lib/business-hours-store.ts` (Persistence Layer)

- JSONL store for demo mode (pattern: `global.__cliaasBusinessHours`).
- DB operations for Postgres mode.
- CRUD functions: `listSchedules()`, `getSchedule()`, `createSchedule()`, `updateSchedule()`, `deleteSchedule()`.
- Holiday CRUD: `listCalendars()`, `getCalendar()`, `createCalendar()`, `addHoliday()`, `removeHoliday()`.
- Link management: `linkCalendar()`, `unlinkCalendar()`.

### Modified Library: `src/lib/sla.ts`

Key changes to `checkTicketSLA()`:

1. When an `SLAPolicy` has a `businessHoursScheduleId`, load the schedule.
2. Replace raw `getTime()` arithmetic (lines 276, 282, etc.) with `calculateBusinessMinutes(schedule, createdAt, now)`.
3. Calculate `dueAt` using `addBusinessMinutes(schedule, createdAt, targetMinutes)` instead of `createdAt + targetMs`.
4. Add `businessHoursElapsed` and `calendarElapsed` to `SLACheckResult` for transparency.

### Holiday Presets: `src/lib/business-hours-presets.ts`

Built-in holiday lists for common locales:
- US Federal Holidays
- UK Bank Holidays
- EU (Germany, France as examples)
- Canada Statutory Holidays
- Australia Public Holidays

Each preset is a function that accepts a year and returns `Holiday[]`. Recurring holidays use fixed dates; floating holidays (e.g., Thanksgiving = 4th Thursday of November) are calculated.

---

## 8. Migration & Rollout Plan

### Phase 1: Schema + Core Library (S)
1. Write migration `0006_business_hours.sql` with all new tables and column additions.
2. Add Drizzle schema definitions for new tables.
3. Add columns to existing `groups`, `brands`, `slaPolicies`, `users` tables.
4. Implement `src/lib/business-hours.ts` (pure calculation engine).
5. Implement `src/lib/business-hours-store.ts` (JSONL + DB persistence).
6. Write comprehensive unit tests for the calculation engine (edge cases: midnight crossings, DST transitions, multi-day spans, holidays overlapping weekends, partial-day holidays).

### Phase 2: SLA Integration (M)
1. Modify `src/lib/sla.ts` to use business hours calculation when schedule is linked.
2. Update `SLAPolicy` type to include `businessHoursScheduleId`.
3. Update `SLACheckResult` to include business vs. calendar elapsed times.
4. Update `sla_events` `dueAt` calculation to use business hours.
5. Modify `src/lib/automation/scheduler.ts` to optionally enrich tickets with business-hours-adjusted `hoursSinceCreated`/`hoursSinceUpdated`.
6. Tests: SLA with business hours, SLA spanning holidays, SLA spanning weekends.

### Phase 3: API Routes (S)
1. Implement business hours CRUD routes under `/api/business-hours/`.
2. Implement holiday calendar CRUD routes under `/api/holidays/`.
3. Modify `/api/sla` POST/PUT to accept `businessHoursScheduleId`.
4. Modify `/api/sla/check` to return business hours elapsed.
5. Tests: API integration tests for all new endpoints.

### Phase 4: UI (M)
1. Build `WeeklyScheduleEditor` component.
2. Build `HolidayCalendarEditor` component.
3. Build `TimezoneSelector` component.
4. Build `/business-hours` page with schedule + holiday management.
5. Modify `/sla` page to include business hours schedule selector.
6. Add user timezone preference to settings.
7. Add `BusinessHoursIndicator` badge to relevant surfaces (ticket detail, queue dashboard).

### Phase 5: CLI + MCP (S)
1. Implement `cliaas business-hours` command group.
2. Implement `cliaas holidays` command group.
3. Implement `registerBusinessHoursTools()` MCP module.
4. Modify `sla_report` MCP tool to use actual policies with business hours.
5. Modify `cliaas sla` CLI command similarly.
6. Register new tools in `cli/mcp/server.ts`.

### Phase 6: Routing Integration (S)
1. Modify `src/lib/routing/availability.ts`: `isAvailableForRouting()` checks if agent's group has active business hours.
2. Add `isWithinBusinessHours()` check to routing strategies.
3. Add `BusinessHoursIndicator` to routing dashboard/queue views.

### Rollout Strategy
- **Backward compatible**: All existing SLA policies continue to work with calendar time (NULL `businessHoursScheduleId` = 24/7).
- **No data migration needed**: New columns are nullable, new tables are empty.
- **Feature flag**: Reuse `sla_management` gate for the business hours page.
- **JSONL fallback**: Business hours store follows the existing `global.__cliaas*` singleton pattern for demo mode.

---

## 9. Effort Estimate

| Phase | Effort | Estimate |
|-------|--------|----------|
| Phase 1: Schema + Core Library | S | 1-2 days |
| Phase 2: SLA Integration | M | 2-3 days |
| Phase 3: API Routes | S | 1 day |
| Phase 4: UI | M | 2-3 days |
| Phase 5: CLI + MCP | S | 1-2 days |
| Phase 6: Routing Integration | S | 1 day |
| **Total** | **M** | **8-12 days** |

### Complexity Notes
- The business hours elapsed time calculation is the trickiest part. DST transitions, partial-day holidays, and midnight-crossing intervals require careful handling. Investing in thorough unit tests for `calculateBusinessMinutes()` and `addBusinessMinutes()` is essential.
- No external timezone library needed: Node.js `Intl.DateTimeFormat` with `timeZone` option handles IANA timezone conversions natively. The `Temporal` API would be ideal but is not yet stable; stick with `Date` + `Intl` for now.
- The `WeeklyScheduleEditor` component is the most complex UI piece. Consider a simplified version first (time inputs per day) and iterate toward a draggable grid later.

### Dependencies
- None. No new npm packages required. IANA timezone support is built into Node.js. Date arithmetic uses native `Date` objects with `Intl.DateTimeFormat` for timezone conversion.

### Risk Areas
- **DST transitions**: A 1-hour shift can cause a business day to be 9 or 7 hours instead of 8. Must test with "spring forward" and "fall back" scenarios.
- **Midnight-crossing intervals**: Some businesses operate overnight (e.g., 22:00-06:00). The interval model must handle `endTime < startTime` by treating it as spanning midnight.
- **Performance**: For SLA checks on large ticket volumes, `calculateBusinessMinutes()` should cache schedule lookups. Consider a schedule-to-minute-bitmap optimization for frequently-checked schedules.

---

## 10. Competitive Comparison

| Capability | Zendesk | Freshdesk | CLIaaS (After) |
|------------|---------|-----------|-----------------|
| Multiple business schedules | Yes | Yes (per group) | Yes (per group/brand/SLA) |
| Holiday calendars | Yes (per schedule) | Yes (per schedule) | Yes (many-to-many with schedules) |
| Recurring holidays | Yes | Yes | Yes |
| Partial-day holidays | No | No | Yes (start/end time) |
| SLA against business hours | Yes | Yes | Yes |
| Per-agent timezone | Yes | Yes | Yes |
| Timezone display preference | Yes | Yes | Yes |
| Schedule-aware routing | Limited | Yes | Yes |
| CLI management | No | No | Yes (unique to CLIaaS) |
| MCP/AI tool access | No | No | Yes (unique to CLIaaS) |
| Holiday presets | No | Manual | Yes (US, UK, CA, AU, EU) |
| Next-business-day utility | Internal only | Internal only | Exposed as API + CLI + MCP tool |

**CLIaaS advantages over competitors:**
1. Business hours are fully programmable via CLI and MCP -- AI agents can query "is it business hours?", calculate business-hours elapsed, and find next-open times directly.
2. Holiday calendar presets reduce setup time vs. Zendesk/Freshdesk which require manual entry.
3. Partial-day holidays (e.g., Christmas Eve half-day) -- neither Zendesk nor Freshdesk supports this.
4. Many-to-many calendar linkage: one holiday calendar can be shared across multiple schedules, reducing duplication for multi-region setups.
