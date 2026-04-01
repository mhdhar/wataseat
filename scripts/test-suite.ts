#!/usr/bin/env tsx
/**
 * WataSeat Comprehensive Test Suite
 *
 * Usage:
 *   npm run test              — Silent mode (no WhatsApp messages, fast)
 *   npm run test:live         — Live mode (real WhatsApp messages)
 *   npm run test:stress       — Stress tests only
 *   npm run test:logic        — Logic/validation tests only
 *   npm run test:infra        — Infrastructure tests only
 */
import 'dotenv/config';
import { summarize } from './test-suite/runner';
import { cleanup, WA_ID, GUEST_ID, BASE_URL, IS_SILENT } from './test-suite/harness';
import { runInfrastructureTests } from './test-suite/groups/01-infrastructure';
import { runOnboardingTests } from './test-suite/groups/02-onboarding';
import { runTripWizardTests } from './test-suite/groups/03-trip-wizard';
import { runCommandTests } from './test-suite/groups/04-commands';
import { runStressTests } from './test-suite/groups/05-stress';

const GROUP_FLAG = process.argv.find(a => a === '--group');
const GROUP = GROUP_FLAG ? process.argv[process.argv.indexOf('--group') + 1] : null;

/** Fast captain setup via direct DB insert — no webhook simulation needed */
async function ensureCaptainViaDB() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: existing } = await sb.from('captains').select('id, onboarding_step').eq('whatsapp_id', WA_ID).single();
  if (existing?.onboarding_step === 'complete') return;

  // Clean and insert fresh
  await cleanup(WA_ID);
  const { data: captain } = await sb.from('captains').insert({
    whatsapp_id: WA_ID,
    display_name: 'Test Captain',
    boat_name: 'Test Boat',
    onboarding_step: 'complete',
    is_active: true,
    iban: 'AE070331234567890123456',
    bank_name: 'Test Bank',
  }).select('id').single();

  if (captain) {
    await sb.from('whatsapp_groups').insert({
      group_id: WA_ID,
      captain_id: captain.id,
      group_name: "Test Captain's trips",
      is_active: true,
    });
  }
  console.log('  Captain created via DB (fast setup)');
}

async function main() {
  console.log('');
  console.log('═'.repeat(55));
  console.log('  WataSeat Test Suite');
  console.log(`  Mode: ${IS_SILENT ? 'Silent (captured)' : 'Live (real WhatsApp)'}`);
  console.log(`  Server: ${BASE_URL}`);
  console.log(`  Captain: +${WA_ID}`);
  if (GROUP) console.log(`  Group: ${GROUP}`);
  console.log('═'.repeat(55));

  // Check server
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error();
  } catch {
    console.error(`\n\x1b[31m  Server not reachable at ${BASE_URL}\x1b[0m`);
    console.error('  Start it first:\n');
    if (IS_SILENT) {
      console.error('    WATASEAT_TEST_MODE=true npm run dev\n');
    } else {
      console.error('    npm run dev\n');
    }
    process.exit(1);
  }

  // Pre-cleanup
  console.log('\n  Cleaning up...');
  await cleanup(WA_ID);
  await cleanup(GUEST_ID);

  try {
    const groups: Record<string, () => Promise<void>> = {
      infra: runInfrastructureTests,
      onboarding: runOnboardingTests,
      logic: async () => { await runTripWizardTests(); await runCommandTests(); },
      stress: runStressTests,
    };

    if (GROUP) {
      const fn = groups[GROUP];
      if (!fn) {
        console.error(`\n  Unknown group: ${GROUP}`);
        console.error(`  Available: ${Object.keys(groups).join(', ')}\n`);
        process.exit(1);
      }
      // For non-infra/non-onboarding groups, ensure a captain exists via DB insert (fast)
      if (GROUP !== 'infra' && GROUP !== 'onboarding') {
        await ensureCaptainViaDB();
      }
      await fn();
    } else {
      // Run all groups in order with cleanup between groups
      await runInfrastructureTests();
      // Clean up + small delay to let any infra webhook async processing finish
      await cleanup(WA_ID);
      await runOnboardingTests();
      await runTripWizardTests();
      await runCommandTests();
      await runStressTests();
    }
  } finally {
    // Post-cleanup
    console.log('\n  Cleaning up...');
    await cleanup(WA_ID);
    await cleanup(GUEST_ID);
  }

  const { failed } = summarize();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\nFatal:', err);
  process.exit(1);
});
