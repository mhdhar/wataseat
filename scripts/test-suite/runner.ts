/** Lightweight test runner with groups, assertions, and colored output */

export interface TestResult {
  name: string;
  group: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const allResults: TestResult[] = [];
let currentGroup = '';

export function setGroup(name: string) {
  currentGroup = name;
  console.log(`\n\x1b[36m▸ ${name}\x1b[0m`);
}

export async function test(name: string, fn: () => Promise<void>): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    const r: TestResult = { name, group: currentGroup, passed: true, duration: ms };
    allResults.push(r);
    console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[90m(${ms}ms)\x1b[0m`);
    return r;
  } catch (err: any) {
    const ms = Date.now() - start;
    const r: TestResult = { name, group: currentGroup, passed: false, duration: ms, error: err.message };
    allResults.push(r);
    console.log(`  \x1b[31m✗\x1b[0m ${name} \x1b[90m(${ms}ms)\x1b[0m`);
    console.log(`    \x1b[31m${err.message}\x1b[0m`);
    return r;
  }
}

export function summarize(): { passed: number; failed: number; total: number } {
  const passed = allResults.filter(r => r.passed).length;
  const failed = allResults.filter(r => !r.passed).length;
  const total = allResults.length;
  const totalMs = allResults.reduce((s, r) => s + r.duration, 0);

  console.log('\n' + '═'.repeat(55));
  if (failed === 0) {
    console.log(`\x1b[32m  ✓ ${passed}/${total} tests passed\x1b[0m \x1b[90m(${(totalMs / 1000).toFixed(1)}s)\x1b[0m`);
  } else {
    console.log(`\x1b[31m  ✗ ${failed} failed\x1b[0m, \x1b[32m${passed} passed\x1b[0m \x1b[90mof ${total} (${(totalMs / 1000).toFixed(1)}s)\x1b[0m`);
    console.log('');
    const byGroup = new Map<string, TestResult[]>();
    for (const r of allResults.filter(r => !r.passed)) {
      if (!byGroup.has(r.group)) byGroup.set(r.group, []);
      byGroup.get(r.group)!.push(r);
    }
    for (const [group, tests] of byGroup) {
      console.log(`  \x1b[36m${group}:\x1b[0m`);
      for (const t of tests) {
        console.log(`    \x1b[31m✗\x1b[0m ${t.name}: ${t.error}`);
      }
    }
  }
  console.log('═'.repeat(55) + '\n');

  return { passed, failed, total };
}

export function getResults(): TestResult[] {
  return [...allResults];
}
