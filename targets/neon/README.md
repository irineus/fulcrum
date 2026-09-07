# Alternative target — Neon + Cloud Run

What lives here (cards 05.1–05.2): Cloud Run manifests and Dockerfiles for `supabase/auth`
(GoTrue) and `postgrest/postgrest`, the deploy Action, and the Neon scripts (project in
`aws-sa-east-1`, pooler, branches). No SQL: a tenant's migrations are applied from **its
own repo** (Desmalha's ten already run against plain Postgres in its CI).

Constraints decided up front (Decisions §4): no `pg_cron` and no `pg_net` on Neon — routine
bodies become functions and only the trigger changes (Cron Triggers); push drains a queue
table every minute; Realtime is not portable. `min-instances=0` and scale-to-zero are the
whole point; verify Cloud Run's free tier in `southamerica-east1` first (card 01.8).
