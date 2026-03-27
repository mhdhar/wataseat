import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { getTripsByCaptain } from '../services/trips';
import { notifyCaptainSummary } from '../services/notifications';
import { Captain } from '../types';

export async function runCaptainDailySummary(): Promise<void> {
  logger.info('Running captain daily summary job');

  // Get all active captains
  const { data: captains, error } = await supabase
    .from('captains')
    .select('*')
    .eq('is_active', true);

  if (error || !captains) {
    logger.error({ err: error }, 'Failed to query active captains');
    return;
  }

  for (const captain of captains as Captain[]) {
    try {
      const trips = await getTripsByCaptain(captain.id);
      if (trips.length > 0) {
        await notifyCaptainSummary(captain, trips);
      }
    } catch (err) {
      logger.error({ err, captainId: captain.id }, 'Failed to send daily summary');
    }
  }

  logger.info({ captainCount: captains.length }, 'Captain daily summaries sent');
}
