import fs from 'node:fs';
import path from 'node:path';

const pending = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '..', 'pending.json'), 'utf8')
);
console.log('Acceptance harness smoke test OK. Pending report-only suites:', pending.pendingIssues);
