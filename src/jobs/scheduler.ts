import cron from 'node-cron';
import { logger } from '../utils/logger';
import { runThresholdCheck } from './thresholdCheck';
import { runReauthorization } from './reauthorize';
import { runCaptainDailySummary } from './dailySummary';

export function startCronJobs(): void {
  // Threshold check — every hour
  cron.schedule('0 * * * *', async () => {
    try {
      await runThresholdCheck();
    } catch (err) {
      logger.error({ err }, 'Threshold check job failed');
    }
  });

  // Re-authorization — daily at 2am UTC (6am UAE)
  cron.schedule('0 2 * * *', async () => {
    try {
      await runReauthorization();
    } catch (err) {
      logger.error({ err }, 'Reauthorization job failed');
    }
  });

  // Captain daily summary — daily at 4am UTC (8am UAE)
  cron.schedule('0 4 * * *', async () => {
    try {
      await runCaptainDailySummary();
    } catch (err) {
      logger.error({ err }, 'Captain daily summary job failed');
    }
  });

  logger.info('Cron jobs scheduled: threshold check (hourly), reauth (2am UTC), captain summary (4am UTC)');
}
