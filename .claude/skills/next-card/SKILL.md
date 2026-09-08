---
name: next-card
description: Advance the Fulcrum board in Notion — database "Fulcrum — Roadmap de Construção" (the shared backend layer / gateway for Entrelares, Gestão IM360 and Desmalha). Use whenever Irineu says "próxima tarefa", "próximo card", "o que fazer agora", "concluí esse card", "marca como concluído/em andamento", "como está o board do Fulcrum", "cria um card para X", or any request to consult, update or extend the Fulcrum roadmap — even without naming Notion. Not for the app boards (Entrelares → next-item; Gestão IM360 and Desmalha → proxima-tarefa).
---

# next-card — one Fulcrum card, end to end

You are advancing **Fulcrum**, the shared backend layer. This skill sequences the working
rhythm; `CLAUDE.md` remains the authority on every convention, and the Notion page
**Fulcrum — Decisões vigentes** wins over both on any conflict. Interact with Irineu in
PT-BR; everything written into the repository is in English.

An argument may have been passed (e.g. `/next-card 03.1`): treat it as the card key.

## Identifiers
- **Board (data source):** `02f7ae71-4d36-4acc-848c-05da99527c58` — query it as
  `collection://02f7ae71-4d36-4acc-848c-05da99527c58`.
- **Database (page):** `0e9af886-ac8d-43c1-8cd7-2bf52839d8a7`.
- **Decisões vigentes (page):** `3d32f3f4-b9b2-8111-a9f2-c638f3e80681` — §1 identity, §2 the
  five rules, §3 stack, §4 targets and cost, §5 tenant onboarding, §6 tests, §7 pending
  verifications, **📜 Histórico** at the end of the SAME page (not a sub-page, unlike the
  Gestão board).
- **Parent page:** `3d32f3f4-b9b2-817b-a240-e25cadfeaa07` ("Fulcrum — Backend compartilhado").
- **Repository:** `github.com/irineus/fulcrum`, default branch `main`.
- **Card properties:** `Tarefa` (title), `Fase` (select, `"01. …"` to `"08. …"`, leading zero
  and exact accents), `Ordem` (number, decimal allowed), `Status` (`A fazer` / `Em andamento`
  / `Concluído`), `Prioridade` (`Alta`/`Média`/`Baixa`), `Repo` (`fulcrum` /
  `entrelares-flutter` / `gestao-im360` / `desmalha` / `entrelares-console` / `externo` /
  `vários`), `Tipo`, `Tamanho` (`P`/`M`/`G`/`GG`), `Notas` (text; carries `Origem:` and
  `Destrava:`), **`Portão`** (text — the objective criterion that closes the card), and
  `Concluído em` (date — in SQL and updates use `date:Concluído em:start`).
- **Card key** = `<Fase number>.<Ordem>` (`01.4`, `03.4.2`). It is what the `Backlog:` trailer
  and the session title use; the board has no separate ID column.
- Do NOT confuse with the sibling boards: Entrelares (`109b1b02-5b6b-48ef-b3b6-990374a3d10f`),
  Gestão IM360 (`e50abe7f-1688-402a-96b5-c6049b24ce82`), Desmalha
  (`d50a2925-fb74-4f67-b0db-af03ef41d1b4`). Never write to them from this skill.

## Preconditions
- The **Notion MCP connector** must be active. If it is not, STOP and say so — never guess a
  card's status.
- Read `CLAUDE.md` and fetch **Decisões vigentes** (one `notion-fetch`; the page is small
  today — keep it that way, see "Closing").
- Toolchain: `node --version` ≥ 22 and `gateway/node_modules` present; otherwise
  `bash tool/setup_env.sh`.

## Pick the card
Query everything the session needs in **one** call (the query is metered):

```sql
SELECT url, "Fase", "Ordem", "Tarefa", "Status", "Repo", "Tipo", "Tamanho", "Prioridade",
       "Portão", "Notas", "date:Concluído em:start"
FROM "collection://02f7ae71-4d36-4acc-848c-05da99527c58"
ORDER BY CAST(substr("Fase", 1, 2) AS INTEGER), "Ordem"
```

The `CAST(substr(…,1,2))` is load-bearing: phase names carry a leading zero, and
`substr(…,1,1)` returns 0 for every row (the Gestão board learned it on 01/09/2026). If the
cast yields 0 everywhere, the phase names changed again.

1. **Cards `Em andamento` come first and Irineu decides.** List them all with their `Notas`
   and ask, with **AskUserQuestion**, which to continue — one option per card plus "next
   `A fazer`". A card in progress is usually parked on a third party (Google console,
   Cloudflare token, a decision) and only Irineu knows whether it is unblocked.
2. With none in progress, the next card is the first `A fazer` in the ordering **whose
   `Destrava:`/`Origem:` dependencies are `Concluído`**.
3. **A card without a written `Portão` does not start.** Ask Irineu for the criterion and
   write it into the card before any code.
4. **`Repo` decides where the work happens.** `fulcrum` → this repo, this skill. Any app repo
   → the card is delivered **in that repo, under that repo's conventions and skill**
   (`next-item` for `entrelares-flutter`/`entrelares-console`; `proxima-tarefa` for
   `gestao-im360` and `desmalha`), and that skill creates the **mirror item on the app's own
   board** (Decisions §5 item 6). This board keeps the Fulcrum card; the app board keeps its
   own ID and phase. `externo` → configuration Irineu does in a console; the session
   prepares the exact steps and values, does what it can with the connectors it has, and
   asks. `vários` → split per repo before starting.
5. Present the chosen card with `Notas` and `Portão` in full, then **analysis and gap
   questions before any code** (AskUserQuestion). A `Tamanho` G/GG card is split into 2–3
   PRs, each with its own docs close-out inline.

## Rename the session
Title: **`<card key> — <Tarefa>`** (e.g. `03.1 — Worker: tenant por Host, troca de apikey…`).
`set_session_title` needs the real session id: call `get_session` with no `session_id` to
read `ccr.id`, then `set_session_title` with it. If the tool is not exposed, say so once and
ask Irineu to rename in the UI — never skip silently.

## Execute
1. Mark the card **`Em andamento`** when starting.
2. Branch **`card/<fase>-<ordem>-<slug>` from `origin/main`** (`git fetch origin main &&
   git checkout -B card/03-1-worker-core origin/main`). Never commit on `main`. If the
   session's designated branch is a `claude/…` one, work there — the push proxy accepts only
   the session's own branch — but still start it from `origin/main`.
3. Honour the rules: name in the PR which of **R1–R5** the change honours; no `.sql`, no
   product table in `src/`, no privileged key (the gate `domain_gate.test.ts` enforces all
   three); a change that crosses to an app is **two PRs, gateway first**.
4. Tests ship with the change. A contract assertion is a real app call **copied from the
   adapter as text**, with the adapter file named in the test — never paraphrased.
5. Before pushing: `cd gateway && npm run lint && npm test`. CI (`ci.yml`) runs the same two
   on every push, so a red push is a red you already had locally.
6. If a `Nota` diverges from what makes sense, do not follow it silently and do not invent
   scope: do the coherent thing and record the divergence in the card's `Notas`, the PR and
   `CLAUDE.md` when it changes a convention (the backup-workflow path on 07/09/2026 is the
   pattern).

## Git cycle — merge only with Irineu's explicit OK
1. Commit in English, conventional style, trailer **`Backlog: <card key>`** (plus any
   Entrelares ID the commit also delivers — the Entrelares mirror reads this repo for them).
   `Backlog:` goes in the **last block**, no blank line before `Co-Authored-By`.
   `.githooks/commit-msg` repairs it if not (run `bash tool/setup_env.sh` once per session
   so it is installed); confirm before pushing with
   `git log -1 --format='%(trailers:key=Backlog,valueonly)'` — empty means broken.
2. `git push -u origin <branch>`.
3. **Ask Irineu (AskUserQuestion) before opening the PR and before merging** — never
   automatic. The PR body lists the card, the rule(s) honoured and every `Portão` line with
   its evidence. In web sessions `gh` does not exist — use the GitHub MCP tools
   (`create_pull_request`, `merge_pull_request`). Squash-merge with `--subject` **and**
   `--body` ending in the trailer, then verify:
   `git log -1 --format='%h %s%n%(trailers:key=Backlog,valueonly)'`.
4. A red CI is fixed, not merged around. Stop and say why only when the same failure repeats
   after a fix attempt, on the third attempt, or when the fix needs something only Irineu can
   do (a secret, a Cloudflare token, a console setting).
5. **Deploys are CI's, never a session's** (`wrangler deploy` and `wrangler secret put` are
   denied in `.claude/settings.json`). A card whose gate says "responds in production" waits
   for the deploy workflow after the merge — say so in the summary.
6. **Branch cleanup:** confirm with `git cherry main origin/<branch> | grep '^+' | wc -l`
   (0 = everything is in `main`; `--merged` lies after a squash). A cloud session cannot
   delete remote refs (HTTP 403 from the push proxy, deterministic) — list the branches ready
   for deletion with `https://github.com/irineus/fulcrum/branches` and never claim the
   cleanup as done.
7. If the session ends mid-cycle, the summary says **where it stopped** (pushed? PR open?
   merged?).

## Close the card — all in the SAME delivery, and only after the merge
1. **`Portão`, line by line, with evidence** (a CI run URL, a command and its output, a
   `/health` response). A gate line without evidence keeps the card `Em andamento`; a merge
   that is still pending keeps it `Em andamento` with the line `AGUARDANDO OK DE IRINEU:
   <what>` at the top of `Notas`.
2. **`Notas`:** `update_properties` **overwrites** the field — fetch the current text first
   and resend it in full, prefixed with `CONCLUÍDO <dd/mm/aaaa>: <what was delivered, PR
   link, divergences>`, keeping `Origem:` and `Destrava:`.
3. **Extensive results** (a measurement, a restore log, a review) go in a **sub-page of the
   card** (`parent: {page_id: <card id>}`), never loose in the workspace.
4. **Decisões vigentes**, when the card decided something: `update_content` (never
   `replace_content`) in the matching § — the **statement** of the rule plus the concrete
   trap it cost, a few lines at most — and one bullet at the **start of 📜 Histórico**
   (`update_content` with `old_str` = the current first Histórico bullet, `new_str` = the new
   bullet followed by that same bullet). Reasoning and measurements go to the card's
   sub-page. A superseded decision moves to a "superadas" note with the reason. The sibling
   boards' decisions pages grew to 120 KB and had to be surgically split — keep this one
   small.
5. **`CLAUDE.md` / `docs/`** of this repo when the card changed a convention, a layout or a
   command; `docs/runbook.md` for anything operational.
6. **`Status = Concluído`** and **`date:Concluído em:start` = today** — both, always; a
   card without a date is a hole in the delivery series.
7. If the card unblocked a Phase gate (`03.6`, `04.4`, `05.6`), say so in the summary.
8. **One card per session.** End with the summary block for the board: what was delivered,
   PR, what is pending and on whom, candidate cards discovered (never executed).

## Creating cards
Always in this board, with `Fase`, `Ordem` (decimal to insert in the middle — never
renumber), `Repo`, `Tipo`, `Tamanho`, `Prioridade`, `Notas` with `Origem:` and `Destrava:`,
and a written **`Portão`**. A pending item promised in Decisões vigentes ("card in Phase N")
must become a real card; a promise without a card is a forgotten promise.

## Scheduled reminders
- Opening any card of **Phase 02** (Google native sign-in): remind Irineu that 02.1 and 02.2
  are console work on Google Cloud and Supabase — the session prepares values, he clicks.
- Opening **03.2**: the CI needs a Cloudflare API token with `Workers Scripts:Edit`
  (Irineu creates it; the session never sees it).
- Opening **04.3** (Supabase consolidation): the Free plan has no backup — only after 04.2
  is running **and** one restore has been done and timed (04.4).
- Opening any **Phase 05** card: check the four verifications of card 01.8 first.

## Prohibitions
Never delete cards. Never touch the sibling boards from here. Never write a `.sql` into this
repo or a product table name into `gateway/src/`. Never put the privileged server key
anywhere in the gateway. Never deploy or set a secret from a session. Never merge without
Irineu's explicit OK. Page IDs in hyphenated UUID form in every update.
