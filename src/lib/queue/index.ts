/** Queue module barrel export */

export { getRedis, isRedisAvailable, closeRedis, getRedisConnectionOpts } from './connection';
export { getQueue, closeAllQueues, getWebhookQueue, getAutomationQueue, getAIResolutionQueue, getEmailQueue } from './queues';
export { enqueueWebhookDelivery, enqueueEmailSend, enqueueAIResolution, enqueueAutomationTick } from './dispatch';
export { getQueueStats, getAllQueueStats } from './stats';
export { QUEUE_NAMES } from './types';
export type { WebhookDeliveryJob, EmailSendJob, AIResolutionJob, AutomationSchedulerJob, QueueName } from './types';
export type { QueueStats } from './stats';
