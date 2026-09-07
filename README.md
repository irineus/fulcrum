# Fulcrum

*The fixed point of a lever: the service that gives the other apps the mechanical support to
move and scale with far less effort.*

Fulcrum is the shared backend layer of Irineu's apps — Entrelares, Gestão IM360, Desmalha
and whatever comes next. It is **a gateway at the edge** (one Cloudflare Worker, one deploy
per product, owning `api.<product>`) that speaks the protocol the apps already speak
(PostgREST + GoTrue + Storage), so **what sits behind it can change without publishing an
app**. It authorizes nothing, unifies no identity, and is only proven once a second real
target passes the same contract suite.

| Where | What |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | The five design rules, stack, how an app joins, conventions, build & test |
| [`gateway/`](gateway/) | The Worker, its unit tests and the contract suite |
| [`docs/`](docs/) | `contract.md` · `tenant-onboarding.md` · `testing.md` · `runbook.md` |
| Notion — *Fulcrum — Decisões vigentes* | What is valid today; wins over any document here |
| Notion — *Fulcrum — Roadmap de Construção* | Status, order and the gate (*Portão*) of every card |

```
cd gateway && npm ci && npm run lint && npm test
```

The name never reaches an end user. Everything in this repository is in English.
