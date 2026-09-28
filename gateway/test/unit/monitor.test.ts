import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * The monitor gate (card 08.1).
 *
 * The monitor runs every 5 minutes in a PUBLIC repository, so its log is public 288 times a
 * day, and the things that make it wrong are all quiet: a production host added to
 * `wrangler.toml` that nobody adds here is a tenant nobody watches; a debugging `cat` of the
 * body or an `echo` of the key leaks on the next run; a second issue per failure turns an
 * incident into 288 e-mails. None of that fails a run. So the workflow is read here as data,
 * like the backup workflows in backup.test.ts.
 */

const REPO = resolve(__dirname, '../../..');
const text = readFileSync(resolve(REPO, '.github/workflows/monitor.yml'), 'utf8');
const workflow = parseYaml(text);
const job = workflow.jobs.probe as {
  env: Record<string, string>;
  steps: { name: string; run?: string; uses?: string; if?: string }[];
};
const probeScript = job.steps[0]?.run ?? '';

const wrangler = parseToml(readFileSync(resolve(REPO, 'gateway/wrangler.toml'), 'utf8')) as {
  env: Record<string, { vars: { TENANT: string; TENANT_HOST: string } }>;
};
const production = Object.entries(wrangler.env)
  .filter(([name]) => !name.endsWith('-dev'))
  .map(([, block]) => block.vars);

describe('monitor.yml — what it watches', () => {
  it('runs every 5 minutes and by hand, never from a branch', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(workflow.on.schedule).toEqual([{ cron: '2-59/5 * * * *' }]);
  });

  it.each(production)(
    'probes /health on every production host and checks the tenant — $TENANT_HOST',
    ({ TENANT, TENANT_HOST }) => {
      expect(probeScript).toContain(`probe ${TENANT_HOST} /health '.tenant == "${TENANT}"'`);
    },
  );

  it('crosses the gateway to the target with the tenant key in both headers', () => {
    expect(probeScript).toMatch(
      /probe api\.entrelares\.app \/auth\/v1\/settings[^\n]*\n\s*-H "apikey: \$KEY" -H "Authorization: Bearer \$KEY"/,
    );
  });
});

describe('monitor.yml — what reaches the public log', () => {
  it('reads the tenant key from a variable, never a secret, and never another credential', () => {
    expect(job.env.KEY).toBe('${{ vars.FULCRUM_MONITOR_ENTRELARES_KEY }}');
    expect(text).not.toMatch(/secrets\./);
  });

  it('never prints the key', () => {
    for (const line of text.split('\n')) {
      if (/\b(echo|printf)\b/.test(line)) expect(line).not.toContain('$KEY');
    }
    expect(text).not.toMatch(/set -[a-z]*x|xtrace|bash -x/);
  });

  it('never prints a response body — it goes to a file that only jq reads', () => {
    expect(probeScript).toContain('curl -s -o body.json');
    expect(text).not.toMatch(/\bcat\b[^\n]*body|<\s*body\.json|\btee\b/);
    for (const step of job.steps) expect(step.uses ?? '').not.toMatch(/upload-artifact/);
  });

  it('asks for nothing beyond reading the repo and writing issues', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', issues: 'write' });
  });
});

describe('monitor.yml — one incident, one issue', () => {
  it('comments the open `monitor` issue instead of opening another', () => {
    const open = job.steps.find((s) => s.if === 'failure()')?.run ?? '';
    expect(open).toMatch(/gh issue list[^\n]*--label monitor --state open/);
    expect(open).toMatch(/if \[ -n "\$open" \]; then\s*\n\s*gh issue comment/);
  });

  it('closes it when every probe is green again', () => {
    const close = job.steps.find((s) => s.if === 'success()')?.run ?? '';
    expect(close).toMatch(/gh issue close/);
  });
});
