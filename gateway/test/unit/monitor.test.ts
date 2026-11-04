import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * The monitor gate (card 08.1).
 *
 * The monitor runs in a PUBLIC repository, so its log is public, and the things that make it
 * wrong are all quiet: a production host added to `wrangler.toml` that nobody adds here is a
 * tenant nobody watches; a debugging `cat` of the body or an `echo` of the key leaks on the
 * next run; a second issue per failure turns an incident into an e-mail per run; a job that
 * never ends spends the account's Actions minutes (04/11/2026). None of that fails a run. So
 * the workflow is read here as data, like the backup workflows in backup.test.ts.
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
  it('runs once a day and by hand, never from a branch — the 5 minutes are the external service', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(workflow.on.schedule).toEqual([{ cron: '41 7 * * *' }]);
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
  it('reads the tenant key from its secret, and nothing else — never a variable', () => {
    // GitHub prints every step's `env:` block and masks secrets only: a `vars.` key reaches
    // the public log verbatim (the first drill, 28/09/2026).
    expect(job.env.KEY).toBe('${{ secrets.FULCRUM_MONITOR_ENTRELARES_KEY }}');
    expect(text).not.toMatch(/bvars\./);
    expect([...text.matchAll(/secrets\.(\w+)/g)].map((m) => m[1])).toEqual([
      'FULCRUM_MONITOR_ENTRELARES_KEY',
    ]);
  });

  it('probes every host even when one fails — the runner starts bash with -e', () => {
    // With `-e`, the first failing command ends the step: the first drill never probed at
    // all, because `read` returns 1 at an EOF with no newline.
    const lines = probeScript.split('\n').map((line) => line.trim());
    const firstCommand = lines.find((line) => line !== '' && !line.startsWith('#'));
    expect(firstCommand).toBe('set +e');
    // …and `read` gets a whole line from curl, so it never returns 1 in the first place.
    expect(probeScript).toContain(`-w '%{http_code} %{time_total}\\n'`);
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

  it('asks for nothing beyond reading the repo and writing issues — it cannot dispatch itself', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', issues: 'write' });
  });
});

describe('monitor.yml — one incident, one issue', () => {
  it('comments the open `monitor` issue instead of opening another', () => {
    expect(probeScript).toMatch(/gh issue list[^\n]*--label monitor --state open/);
    expect(probeScript).toMatch(/if \[ -n "\$open" \]; then\s*\n\s*gh issue comment/);
  });

  it('reports when a probe failed and ends red, so the run history stays the evidence', () => {
    expect(probeScript).toMatch(/if \[ -s failures\.txt \]; then\s*\n\s*report\s*\n\s*exit 1/);
  });

  it('closes it on the first all-green pass', () => {
    expect(probeScript).toMatch(/gh issue close/);
    expect(probeScript.trimEnd().endsWith('close_if_open')).toBe(true);
  });
});

describe('monitor.yml — one pass, never a loop (04/11/2026)', () => {
  // From 28/09 to 04/11/2026 the job looped for 5 h 45 and dispatched its successor: one job
  // always running, ~1,760 billed minutes a day. With the repositories private it spent the
  // account's 2,000 monthly minutes in a day and a half and blocked the CI of every product.
  it('makes one pass and ends — no sleep, no loop', () => {
    // `while read` over failures.txt is fine; an endless `while :` / `while true` is not.
    expect(probeScript).not.toMatch(/while\s+(:|true)\b|\bsleep \$|LOOP_MINUTES|deadline/);
    expect(job.env).not.toHaveProperty('LOOP_MINUTES');
    const timeout = (workflow.jobs.probe as { 'timeout-minutes': number })['timeout-minutes'];
    // Four probes, two tries of at most 15 s plus the 10 s pause each: about 3 minutes.
    expect(timeout).toBeLessThanOrEqual(5);
  });

  it('never dispatches a run of itself', () => {
    expect(text).not.toMatch(/gh workflow run|workflow_run|repository_dispatch/);
    expect(workflow.on.workflow_dispatch.inputs).not.toHaveProperty('loop');
  });

  it('runs one at a time, never cancelling a pass that is reporting', () => {
    expect(workflow.concurrency).toEqual({ group: 'monitor', 'cancel-in-progress': false });
  });
});
