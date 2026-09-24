import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * The backup gate (card 04.2).
 *
 * The backup reads PRODUCTION databases from a PUBLIC repository, whose Actions logs and
 * artifacts anyone can read. The rules that keep that safe are all things a later edit
 * breaks by accident — a debugging `set -x`, an `upload-artifact` to "look at the dump",
 * a `push` trigger to test a change — and none of them shows up as a failing run: the
 * backup keeps working while it leaks. So the two workflows and the scripts are read here
 * and checked as data, like `wrangler.toml` and `deploy.yml` in config.test.ts.
 */

const REPO = resolve(__dirname, '../../..');
const WORKFLOWS = ['pg_dump_r2.yml', 'restore_check.yml'] as const;
/** Tenants with a production database. Desmalha joins the day it has one. */
const BACKED_UP = ['entrelares', 'gestaoim360'];

const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');
const workflowText = (name: string) => read(`.github/workflows/${name}`);
const workflow = (name: string) => parseYaml(workflowText(name));
const scripts = readdirSync(resolve(REPO, 'backup'))
  .filter((file) => file.endsWith('.sh'))
  .map((file) => `backup/${file}`);

interface Step {
  uses?: string;
  run?: string;
}
const steps = (name: string): Step[] =>
  Object.values(workflow(name).jobs as Record<string, { steps: Step[] }>).flatMap(
    (job) => job.steps,
  );

describe('backup workflows — production credentials in a public repository', () => {
  it.each(WORKFLOWS)('%s runs on schedule and by hand only, never from a branch', (name) => {
    // `push` or `pull_request` would run production credentials from any branch.
    expect(Object.keys(workflow(name).on).sort()).toEqual(['schedule', 'workflow_dispatch']);
  });

  it.each(WORKFLOWS)('%s never uploads an artifact — an artifact here is public', (name) => {
    for (const step of steps(name)) {
      expect(step.uses ?? '').not.toMatch(/upload-artifact|actions\/cache/);
    }
  });

  it.each(WORKFLOWS)('%s covers exactly the tenants that have production', (name) => {
    const job = Object.values(workflow(name).jobs)[0] as {
      strategy: { matrix: { include: { tenant: string }[] } };
    };
    expect(job.strategy.matrix.include.map((row) => row.tenant)).toEqual(BACKED_UP);
  });

  it.each(WORKFLOWS)('%s uses a database credential per tenant, never an account token', (name) => {
    const text = workflowText(name);
    // An account token reaches every project of the account; a connection string reaches
    // one database (Decisions §4, card 04.2).
    expect(text).not.toMatch(/SUPABASE_ACCESS_TOKEN/);
    for (const secret of text.matchAll(/secrets(?:\.(\w+)|\[format\('(\w+)')/g)) {
      expect(secret[1] ?? secret[2]).toMatch(/^(FULCRUM_BACKUP_|CLOUDFLARE_ACCOUNT_ID$)/);
    }
  });
});

describe('backup scripts — what may reach a public log', () => {
  it.each([...scripts, ...WORKFLOWS.map((w) => `.github/workflows/${w}`)])(
    '%s never turns on shell tracing',
    (path) => {
      // `set -x` prints every expanded command — the connection string and the passphrase
      // among them — and GitHub only masks a secret it can match verbatim.
      expect(read(path)).not.toMatch(/set -[a-z]*x|xtrace|bash -x/);
    },
  );

  it('encrypts with GPG symmetric AES-256 before anything is uploaded', () => {
    const dump = read('backup/pg_dump_r2.sh');
    // The tar stream is piped straight into gpg: no plaintext archive is ever written.
    expect(dump).toMatch(/\| *\n? *gpg [^|]*--symmetric --cipher-algo AES256/);
    // The one upload names the encrypted archive and nothing else.
    const uploads = [...dump.matchAll(/aws s3 cp "([^"]+)"/g)].map((m) => m[1]);
    expect(uploads).toEqual(['$archive']);
    expect(dump).toMatch(/archive="\$work\/\$TENANT-\$stamp\.tar\.gz\.gpg"/);
  });

  it('passes the passphrase on a file descriptor, never on the command line', () => {
    // An argv is readable by every process on the machine, and echoed by any tracing.
    for (const path of scripts) {
      expect(read(path)).not.toMatch(/--passphrase[ =]/);
    }
  });

  it('prints a restore error as its SQLSTATE, never the row', () => {
    // A COPY error quotes the offending row in its CONTEXT line.
    const restore = read('backup/restore_check.sh');
    expect(restore).toMatch(/VERBOSITY=sqlstate[^\n]*\\\n[^\n]*-f "\$work\/data\.sql"/);
  });
});
