import 'dotenv/config';
import { TestHarness } from './test-e2e/harness';
import { testOnboarding } from './test-e2e/flows/01-onboarding';
import { testTripCreation } from './test-e2e/flows/02-trip-creation';
import { testHelpCommand, testTripsCommand, testStatusCommand } from './test-e2e/flows/03-commands';
import { testEditTrip } from './test-e2e/flows/04-edit-trip';
import { testRepeatTrip } from './test-e2e/flows/05-repeat-trip';
import { testCancelTrip } from './test-e2e/flows/06-cancel-trip';
import { testStress } from './test-e2e/flows/07-stress';

const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

async function runTest(
  name: string,
  fn: () => Promise<void>
): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    console.log(`  \x1b[32m[PASS]\x1b[0m ${name} (${(duration / 1000).toFixed(1)}s)`);
    return { name, passed: true, duration };
  } catch (err: any) {
    const duration = Date.now() - start;
    console.log(`  \x1b[31m[FAIL]\x1b[0m ${name} (${(duration / 1000).toFixed(1)}s)`);
    console.log(`         ${err.message}`);
    return { name, passed: false, duration, error: err.message };
  }
}

async function checkServer(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\nWataSeat E2E Tests`);
  console.log(`Target: ${BASE_URL}`);
  console.log('─'.repeat(50));

  // Check server is running
  const serverUp = await checkServer();
  if (!serverUp) {
    console.error(`\n\x1b[31mServer not reachable at ${BASE_URL}\x1b[0m`);
    console.error('Start the server first: WATASEAT_TEST_MODE=true npm run dev\n');
    process.exit(1);
  }

  const h = new TestHarness();
  const results: TestResult[] = [];

  // Shared state between tests
  let tripShortId = '';
  let repeatShortId = '';

  try {
    // Clean up before starting
    console.log('\nCleaning up test data...');
    await h.cleanup();
    console.log('');

    // 1. Onboarding (required before all other tests)
    results.push(await runTest('Captain onboarding', () => testOnboarding(h)));
    if (!results[0].passed) {
      console.log('\n  Onboarding failed — cannot proceed with other tests.');
      return summarize(results);
    }

    // 2. Trip creation
    results.push(await runTest('Trip creation wizard', async () => {
      tripShortId = await testTripCreation(h);
    }));

    // 3. Commands (use trip from step 2)
    if (tripShortId) {
      results.push(await runTest('Help command', () => testHelpCommand(h)));
      results.push(await runTest('Trips list', () => testTripsCommand(h, tripShortId)));
      results.push(await runTest('Trip status', () => testStatusCommand(h, tripShortId)));
    }

    // 4. Edit trip
    if (tripShortId) {
      results.push(await runTest('Edit trip', () => testEditTrip(h, tripShortId)));
    }

    // 5. Repeat trip
    results.push(await runTest('Repeat trip', async () => {
      repeatShortId = await testRepeatTrip(h);
    }));

    // 6. Cancel the repeated trip (not the original — keep original for stress verification)
    if (repeatShortId) {
      results.push(await runTest('Cancel trip', () => testCancelTrip(h, repeatShortId)));
    }

    // 7. Stress test
    results.push(await runTest('Stress test (5 rapid trips)', () => testStress(h)));

  } finally {
    // Always clean up
    console.log('\nCleaning up test data...');
    await h.cleanup();
  }

  summarize(results);
}

function summarize(results: TestResult[]) {
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log('\n' + '─'.repeat(50));
  if (passed === total) {
    console.log(`\x1b[32m${passed}/${total} passed\x1b[0m (${(totalTime / 1000).toFixed(1)}s)\n`);
  } else {
    console.log(`\x1b[31m${passed}/${total} passed, ${total - passed} failed\x1b[0m (${(totalTime / 1000).toFixed(1)}s)`);
    console.log('\nFailed tests:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
    console.log('');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
