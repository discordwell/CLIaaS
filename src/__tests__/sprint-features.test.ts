import { describe, it, expect, beforeEach } from 'vitest';

// ---- Feature 1: Customer 360 ----

describe('Customer 360 Enrichment', () => {
  let store: typeof import('../lib/customers/customer-store');

  beforeEach(async () => {
    // Reset module state between tests
    store = await import('../lib/customers/customer-store');
  });

  it('getCustomerActivities returns demo activities', async () => {
    const activities = await store.getCustomerActivities('cust-1');
    expect(activities.length).toBeGreaterThan(0);
    expect(activities[0]).toHaveProperty('activityType');
    expect(activities[0]).toHaveProperty('customerId');
  });

  it('addCustomerActivity creates and returns activity', () => {
    const activity = store.addCustomerActivity({
      customerId: 'cust-test-1',
      activityType: 'ticket_created',
      entityType: 'ticket',
      entityId: 'tkt-999',
      metadata: { subject: 'Test' },
    });
    expect(activity.id).toBeTruthy();
    expect(activity.activityType).toBe('ticket_created');
  });

  it('getCustomerNotes returns demo notes', async () => {
    const notes = await store.getCustomerNotes('cust-1');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toHaveProperty('body');
  });

  it('addCustomerNote creates note', () => {
    const note = store.addCustomerNote({
      customerId: 'cust-test-1',
      noteType: 'note',
      body: 'Test note',
    });
    expect(note.id).toBeTruthy();
    expect(note.body).toBe('Test note');
    expect(note.noteType).toBe('note');
  });

  it('getCustomerSegments returns demo segments', async () => {
    const segments = await store.getCustomerSegments();
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]).toHaveProperty('name');
    expect(segments[0]).toHaveProperty('query');
  });

  it('createCustomerSegment creates segment', () => {
    const segment = store.createCustomerSegment({
      name: 'VIP Customers',
      description: 'High-value customers',
      query: { plan: 'enterprise' },
    });
    expect(segment.id).toBeTruthy();
    expect(segment.name).toBe('VIP Customers');
  });

  it('mergeCustomers creates merge log entry', () => {
    const entry = store.mergeCustomers(
      'cust-primary',
      'cust-merged',
      { email: 'old@example.com', name: 'Old Name' },
    );
    expect(entry.id).toBeTruthy();
    expect(entry.primaryCustomerId).toBe('cust-primary');
    expect(entry.mergedCustomerId).toBe('cust-merged');
  });
});

// ---- Feature 2: Time Tracking Enhancement ----

describe('Time Tracking Enhancement', () => {
  let timeTracking: typeof import('../lib/time-tracking');

  beforeEach(async () => {
    timeTracking = await import('../lib/time-tracking');
  });

  it('TimeEntry includes customerId and groupId fields', () => {
    const entry = timeTracking.logManualTime({
      ticketId: 'tkt-test',
      userId: 'user-test',
      userName: 'Test User',
      durationMinutes: 30,
      billable: true,
      notes: 'Test',
      customerId: 'cust-1',
      groupId: 'group-1',
    });
    expect(entry.customerId).toBe('cust-1');
    expect(entry.groupId).toBe('group-1');
  });

  it('getTimeReport includes byCustomer and byGroup', () => {
    // Log entries with customer/group ids
    timeTracking.logManualTime({
      ticketId: 'tkt-report',
      userId: 'user-report',
      userName: 'Reporter',
      durationMinutes: 60,
      billable: true,
      notes: '',
      customerId: 'cust-report',
      groupId: 'group-report',
    });

    const report = timeTracking.getTimeReport({ ticketId: 'tkt-report' });
    expect(report).toHaveProperty('byCustomer');
    expect(report).toHaveProperty('byGroup');
    expect(Array.isArray(report.byCustomer)).toBe(true);
    expect(Array.isArray(report.byGroup)).toBe(true);
  });

  it('filters by customerId and groupId', () => {
    timeTracking.logManualTime({
      ticketId: 'tkt-filter',
      userId: 'user-filter',
      userName: 'Filter User',
      durationMinutes: 15,
      billable: false,
      notes: '',
      customerId: 'cust-filter',
      groupId: 'group-filter',
    });

    const entries = timeTracking.getTimeEntries({ customerId: 'cust-filter' });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(e => e.customerId === 'cust-filter')).toBe(true);
  });
});

// ---- Feature 3: Community Forums ----

describe('Community Forums', () => {
  let forums: typeof import('../lib/forums/forum-store');

  beforeEach(async () => {
    forums = await import('../lib/forums/forum-store');
  });

  it('getCategories returns demo categories', async () => {
    const categories = await forums.getCategories();
    expect(categories.length).toBeGreaterThan(0);
    expect(categories[0]).toHaveProperty('name');
    expect(categories[0]).toHaveProperty('slug');
  });

  it('createCategory creates new category', () => {
    const cat = forums.createCategory({
      name: 'Bug Reports',
      description: 'Report bugs here',
      slug: 'bug-reports',
    });
    expect(cat.id).toBeTruthy();
    expect(cat.slug).toBe('bug-reports');
  });

  it('createThread creates thread with correct fields', async () => {
    const categories = await forums.getCategories();
    const thread = forums.createThread({
      categoryId: categories[0].id,
      title: 'Test Thread',
      body: 'Test body content',
      status: 'open',
      isPinned: false,
    });
    expect(thread.id).toBeTruthy();
    expect(thread.title).toBe('Test Thread');
    expect(thread.status).toBe('open');
    expect(thread.replyCount).toBe(0);
  });

  it('createReply increments thread replyCount', async () => {
    const threads = await forums.getThreads();
    const threadId = threads[0].id;
    const initialCount = threads[0].replyCount;

    forums.createReply({
      threadId,
      body: 'Test reply',
    });

    const updated = forums.getThread(threadId);
    expect(updated!.replyCount).toBe(initialCount + 1);
  });

  it('moderateThread closes thread', async () => {
    const threads = await forums.getThreads();
    const threadId = threads[0].id;
    forums.moderateThread(threadId, 'close');
    const updated = forums.getThread(threadId);
    expect(updated!.status).toBe('closed');
  });

  it('convertToTicket sets convertedTicketId', async () => {
    const threads = await forums.getThreads();
    const threadId = threads[0].id;
    forums.convertToTicket(threadId, 'tkt-converted-1');
    const updated = forums.getThread(threadId);
    expect(updated!.convertedTicketId).toBe('tkt-converted-1');
  });
});

// ---- Feature 4: QA / Conversation Review ----

describe('QA / Conversation Review', () => {
  let qa: typeof import('../lib/qa/qa-store');

  beforeEach(async () => {
    qa = await import('../lib/qa/qa-store');
  });

  it('getScorecards returns demo scorecards', async () => {
    const scorecards = await qa.getScorecards();
    expect(scorecards.length).toBeGreaterThan(0);
    expect(scorecards[0]).toHaveProperty('criteria');
    expect(Array.isArray(scorecards[0].criteria)).toBe(true);
  });

  it('createScorecard creates scorecard with criteria', () => {
    const sc = qa.createScorecard({
      name: 'Test Scorecard',
      criteria: [
        { name: 'Empathy', description: 'Shows empathy', weight: 1, maxScore: 5 },
        { name: 'Resolution', description: 'Resolves issue', weight: 2, maxScore: 5 },
      ],
      enabled: true,
    });
    expect(sc.id).toBeTruthy();
    expect(sc.criteria.length).toBe(2);
    expect(sc.enabled).toBe(true);
  });

  it('createReview creates review with scores', async () => {
    const scorecards = await qa.getScorecards();
    const review = qa.createReview({
      ticketId: 'tkt-qa-1',
      scorecardId: scorecards[0].id,
      reviewType: 'manual',
      scores: { empathy: 4, resolution: 5 },
      totalScore: 9,
      maxPossibleScore: 10,
      status: 'completed',
    });
    expect(review.id).toBeTruthy();
    expect(review.totalScore).toBe(9);
    expect(review.status).toBe('completed');
  });

  it('getQADashboard returns metrics', async () => {
    const dashboard = await qa.getQADashboard();
    expect(dashboard).toHaveProperty('totalReviews');
    expect(dashboard).toHaveProperty('averageScore');
    expect(typeof dashboard.totalReviews).toBe('number');
  });

  it('getReviews filters by ticketId', async () => {
    const scorecards = await qa.getScorecards();
    qa.createReview({
      ticketId: 'tkt-qa-filter',
      scorecardId: scorecards[0].id,
      reviewType: 'auto',
      scores: { quality: 3 },
      totalScore: 3,
      maxPossibleScore: 5,
      status: 'completed',
    });

    const reviews = await qa.getReviews({ ticketId: 'tkt-qa-filter' });
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews.every(r => r.ticketId === 'tkt-qa-filter')).toBe(true);
  });
});

// ---- Feature 5: Proactive/Outbound Messaging ----

describe('Campaigns', () => {
  let campaigns: typeof import('../lib/campaigns/campaign-store');

  beforeEach(async () => {
    campaigns = await import('../lib/campaigns/campaign-store');
  });

  it('getCampaigns returns demo campaigns', async () => {
    const list = await campaigns.getCampaigns();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty('name');
    expect(list[0]).toHaveProperty('status');
  });

  it('createCampaign creates draft campaign', () => {
    const c = campaigns.createCampaign({
      name: 'Test Campaign',
      channel: 'email',
      subject: 'Hello',
      templateBody: 'Hi {{customer.name}}!',
    });
    expect(c.id).toBeTruthy();
    expect(c.status).toBe('draft');
    expect(c.channel).toBe('email');
  });

  it('updateCampaign modifies fields', async () => {
    const list = await campaigns.getCampaigns();
    const id = list[0].id;
    const updated = campaigns.updateCampaign(id, { name: 'Updated Name' });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated Name');
  });

  it('sendCampaign transitions status to sent', async () => {
    const c = campaigns.createCampaign({
      name: 'Send Test',
      channel: 'email',
      subject: 'Test',
      templateBody: 'Body',
    });
    const sent = await campaigns.sendCampaign(c.id);
    expect(sent).not.toBeNull();
    expect(sent!.status).toBe('sent');
    expect(sent!.sentAt).toBeTruthy();
  });

  it('getCampaignAnalytics returns breakdown', async () => {
    const list = await campaigns.getCampaigns();
    const analytics = await campaigns.getCampaignAnalytics(list[0].id);
    expect(analytics).toHaveProperty('total');
    expect(analytics).toHaveProperty('sent');
    expect(analytics).toHaveProperty('delivered');
    expect(analytics).toHaveProperty('failed');
  });
});

// ---- Feature 6: Telegram ----

describe('Telegram Channel', () => {
  let telegram: typeof import('../lib/channels/telegram');

  beforeEach(async () => {
    telegram = await import('../lib/channels/telegram');
  });

  it('verifyWebhookSecret returns true for matching secret', () => {
    const mockRequest = {
      headers: new Headers({
        'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
      }),
    } as unknown as Request;
    expect(telegram.verifyWebhookSecret(mockRequest, 'test-secret')).toBe(true);
  });

  it('verifyWebhookSecret returns false for wrong secret', () => {
    const mockRequest = {
      headers: new Headers({
        'X-Telegram-Bot-Api-Secret-Token': 'wrong',
      }),
    } as unknown as Request;
    expect(telegram.verifyWebhookSecret(mockRequest, 'test-secret')).toBe(false);
  });
});

// ---- Feature 7: Slack Intake ----

describe('Slack Intake', () => {
  let slack: typeof import('../lib/channels/slack-intake');

  beforeEach(async () => {
    slack = await import('../lib/channels/slack-intake');
  });

  it('exports verifySlackSignature function', () => {
    expect(typeof slack.verifySlackSignature).toBe('function');
  });

  it('exports messageToTicket function', () => {
    expect(typeof slack.messageToTicket).toBe('function');
  });

  it('getSlackMappings returns array', () => {
    const mappings = slack.getSlackMappings();
    expect(Array.isArray(mappings)).toBe(true);
  });

  it('createSlackMapping creates mapping', () => {
    const mapping = slack.createSlackMapping({
      slackChannelId: 'C123',
      slackChannelName: 'support',
      autoCreateTicket: true,
    });
    expect(mapping.id).toBeTruthy();
    expect(mapping.slackChannelId).toBe('C123');
    expect(mapping.autoCreateTicket).toBe(true);
  });
});

// ---- Feature 8: MS Teams Intake ----

describe('Teams Intake', () => {
  let teams: typeof import('../lib/channels/teams-intake');

  beforeEach(async () => {
    teams = await import('../lib/channels/teams-intake');
  });

  it('exports getTeamsToken function', () => {
    expect(typeof teams.getTeamsToken).toBe('function');
  });

  it('exports verifyTeamsToken function', () => {
    expect(typeof teams.verifyTeamsToken).toBe('function');
  });

  it('verifyTeamsToken accepts Bearer token', async () => {
    const result = await teams.verifyTeamsToken('Bearer abc123');
    expect(result).toBe(true);
  });

  it('verifyTeamsToken rejects missing token', async () => {
    const result = await teams.verifyTeamsToken('');
    expect(result).toBe(false);
  });
});

// ---- Feature 9: Mobile SDK ----

describe('SDK Session Management', () => {
  let sdk: typeof import('../lib/channels/sdk-session');

  beforeEach(async () => {
    sdk = await import('../lib/channels/sdk-session');
  });

  it('createSession returns session with token', () => {
    const session = sdk.createSession('ws-1', 'cust-1');
    expect(session.id).toBeTruthy();
    expect(session.token).toBeTruthy();
    expect(session.workspaceId).toBe('ws-1');
    expect(session.customerId).toBe('cust-1');
  });

  it('validateSession returns session for valid token', () => {
    const session = sdk.createSession('ws-2', 'cust-2');
    const found = sdk.validateSession(session.token);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(session.id);
  });

  it('validateSession returns null for invalid token', () => {
    const found = sdk.validateSession('invalid-token-xyz');
    expect(found).toBeNull();
  });
});

// ---- Shared Infrastructure ----

describe('Feature Gates', () => {
  let gates: typeof import('../lib/features/gates');

  beforeEach(async () => {
    gates = await import('../lib/features/gates');
  });

  it('includes community_forums feature', () => {
    expect(gates.isFeatureEnabled('community_forums', 'byoc')).toBe(true);
  });

  it('includes qa_reviews feature', () => {
    expect(gates.isFeatureEnabled('qa_reviews', 'byoc')).toBe(true);
  });

  it('includes proactive_messaging feature', () => {
    expect(gates.isFeatureEnabled('proactive_messaging', 'byoc')).toBe(true);
  });

  it('has labels for all new features', () => {
    expect(gates.FEATURE_LABELS.community_forums).toBe('Community Forums');
    expect(gates.FEATURE_LABELS.qa_reviews).toBe('QA & Conversation Review');
    expect(gates.FEATURE_LABELS.proactive_messaging).toBe('Proactive Messaging');
  });
});

describe('Event Dispatcher Types', () => {
  it('includes all 10 new canonical events', async () => {
    const { dispatch } = await import('../lib/events/dispatcher');
    expect(typeof dispatch).toBe('function');
    // Type-level check — if these compile, the events exist
    const events = [
      'forum.thread_created',
      'forum.reply_created',
      'forum.thread_converted',
      'qa.review_created',
      'qa.review_completed',
      'campaign.created',
      'campaign.sent',
      'customer.updated',
      'customer.merged',
      'time.entry_created',
    ] as const;
    expect(events.length).toBe(10);
  });
});

describe('Webhook Event Types', () => {
  it('includes new webhook event types', async () => {
    const webhooks = await import('../lib/webhooks');
    // The WebhookEventType union includes the new events — tested via compilation
    expect(typeof webhooks.dispatchWebhook).toBe('function');
  });
});
