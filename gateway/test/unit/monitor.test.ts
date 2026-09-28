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

  it('asks for nothing beyond reading the repo, writing issues and dispatching itself', () => {
    expect(workflow.permissions).toEqual({ actions: 'write', contents: 'read', issues: 'write' });
  });
});

describe('monitor.yml — one incident, one issue', () => {
  it('comments the open `monitor` issue instead of opening another', () => {
    expect(probeScript).toMatch(/gh issue list[^\n]*--label monitor --state open/);
    expect(probeScript).toMatch(/if \[ -n "\$open" \]; then\s*\n\s*gh issue comment/);
  });

  it('comments again only when what fails changes — a long outage is one e-mail', () => {
    expect(probeScript).toContain('[ "$state" != "$last_state" ] && report');
  });

  it('closes it on the first all-green pass', () => {
    expect(probeScript).toMatch(/gh issue close/);
    expect(probeScript).toContain('[ -n "$last_state" ] && close_if_open');
  });
});

describe('monitor.yml — the 5 minutes are a loop, not the cron', () => {
  // GitHub's scheduler fired the 5-minute cron once in ~11 h on this repository
  // (28/09/2026): the cadence has to live inside the job.
  it('loops for most of a job on schedule, and makes one pass on dispatch', () => {
    expect(job.env.LOOP_MINUTES).toBe(
      "${{ (github.event_name == 'schedule' || inputs.loop) && 345 || 0 }}",
    );
    const timeout = (workflow.jobs.probe as { 'timeout-minutes': number })['timeout-minutes'];
    // The loop can overrun its deadline by one sleep (< 5 min) and one pass.
    expect(345 + 10).toBeLessThanOrEqual(timeout);
    expect(timeout).toBeLessThanOrEqual(360);
    expect(probeScript).toContain('sleep $(( 300 - (now % 300) ))');
  });

  it('queues the next run behind the running one instead of cancelling it', () => {
    expect(workflow.concurrency).toEqual({ group: 'monitor', 'cancel-in-progress': false });
  });

  it('ends red when any pass failed, so the run history stays the evidence', () => {
    expect(probeScript.trimEnd().endsWith('exit $any_red')).toBe(true);
  });

  // The scheduler then went 6 h 30 min without firing at all (28/09/2026).
  it('chains itself: a looping run dispatches the next looping run before it ends', () => {
    expect(workflow.on.workflow_dispatch.inputs.loop).toMatchObject({
      type: 'boolean',
      default: false,
    });
    expect(probeScript).toMatch(
      /if \[ "\$LOOP_MINUTES" -gt 0 \]; then\s*\n\s*gh workflow run monitor\.yml --repo "\$GITHUB_REPOSITORY" --ref main -f loop=true/,
    );
  });
});
