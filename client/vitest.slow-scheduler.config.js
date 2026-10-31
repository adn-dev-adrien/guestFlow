// @ts-check
// Manual race sweep: the unit suite with React's scheduler slowed down (specs/server-test-isolation.md
// rule 11). `npm run test:slow-scheduler`, SCHED_DELAY=<ms> to change the delay.
import { defineConfig } from 'vitest/config';
import base from './vitest.config.js';

export default defineConfig({
  ...base,
  test: { ...base.test, setupFiles: ['./src/setupSlowScheduler.js', ...(base.test?.setupFiles || [])] },
});
