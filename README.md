# Workflow Engine

A small workflow automation engine, in the spirit of Zapier or n8n. A workflow is a trigger followed by a chain of steps; a pool of background workers runs it, retries what fails, and records what every step received and returned.

The interesting part is the engine: a **durable job queue built on plain Postgres**, with no Redis or message broker. Runs survive restarts, a delay does not hold a worker, and a run whose worker died is picked up by another one from the step where it stopped.

## Run it

Requires Docker with Compose. No configuration needed.

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). Three example workflows are created on first start:

| Workflow | Shows |
|---|---|
| **Welcome new signups** | A webhook trigger, a filter, a transform, a 5-second delay and an HTTP request |
| **Call an unreliable API** | An endpoint that fails twice with `503` before answering: press *Run now* and watch the retries in the timeline |
| **Repository star report** | A schedule that calls the GitHub API every 30 minutes |

Run more workers with `docker compose up --scale worker=3`. Use `PORT` to change the port, `WORKFLOWS_DIR=` (empty) to start without the examples, and `docker compose down -v` to wipe the data.

## What a workflow is made of

**Triggers**: started manually, by a webhook (`POST /api/hooks/<token>`, the JSON body becomes `trigger.body`), or on a schedule (every N minutes).

**Steps**, executed in order:

| Step | Does |
|---|---|
| HTTP request | Calls a URL. The response status and parsed body become the step's output |
| Transform | Builds a new object from earlier data |
| Filter | Continues only if a condition holds, otherwise ends the run as *stopped* |
| Delay | Pauses the run for a number of seconds |

Any text field accepts templates: `{{trigger.body.email}}` reads the webhook payload and `{{steps.fetch.body.items.0.title}}` reads the output of an earlier step. A field that is exactly one template keeps the original type, so a number stays a number.

## Architecture

```mermaid
flowchart LR
  H[Webhook] --> A
  U[Browser] --> A[app<br/>Next.js]
  A -- "insert run (queued)" --> DB[(Postgres)]
  subgraph workers [worker × N]
    S[scheduler] 
    W[run loop]
  end
  S -- "enqueue due schedules" --> DB
  W -- "claim: FOR UPDATE SKIP LOCKED" --> DB
  W -- "step result + next state<br/>in one transaction" --> DB
  W -- "HTTP steps" --> X[External APIs]
  M[migrate<br/>one-shot job] -. "schema + examples" .-> DB
```

Compose starts the database, runs `migrate` once, and only then starts `app` and `worker`. The app never executes steps and the workers serve no HTTP; they share nothing but the database.

| | |
|---|---|
| Web | Next.js 16 (App Router, Server Actions), React 19, Tailwind CSS v4 |
| Engine | TypeScript, bundled with esbuild into a single worker file |
| Storage and queue | Postgres 17, Drizzle ORM, SQL migrations in [`drizzle/`](drizzle) |
| Quality | Vitest (unit, plus integration against a real Postgres), ESLint, GitHub Actions |

## How the engine works

The whole state of a run lives in one row: its status, the index of the next step (`cursor`), the attempt number, when it may run next (`run_at`) and who holds it (`locked_by`, `locked_until`).

1. **Claiming.** A worker takes the oldest runnable row with `SELECT … FOR UPDATE SKIP LOCKED` inside an `UPDATE`, which marks it running and sets a 60-second lease. `SKIP LOCKED` makes concurrent workers pass over rows another worker is claiming instead of waiting, so two workers never get the same run ([`queue.ts`](src/engine/queue.ts)).
2. **Executing.** The worker rebuilds the context from the outputs already stored, runs the step at `cursor`, and gets back one of four outcomes: ok, wait, stop or error.
3. **Deciding.** A pure function maps the position and the outcome to the next state ([`state.ts`](src/engine/state.ts)). It has no I/O, which is why every branch of it is unit-tested.
4. **Recording.** The step's input, output and the run's new state are written **in one transaction**. Either the step is recorded and the cursor moves, or neither happens.

What follows from that design:

- **Retries with backoff.** A retryable failure (network error, timeout, `5xx`, `429`) puts the run back in the queue with `run_at` 2, 4, then 8 seconds ahead. After four attempts the run fails. A `4xx` fails immediately, because repeating a bad request does not fix it.
- **Delays cost nothing.** A delay is just a `run_at` in the future. No worker sleeps, and a delay survives a restart.
- **Crash recovery.** If a worker dies mid-step, its lease expires and another worker claims the run at the same `cursor`. Finished steps are not repeated.
- **A stale worker cannot corrupt a run.** The recording transaction only applies if the row is still locked by that worker; a worker that lost its lease has its result discarded.
- **Editing is safe.** A run copies the workflow's steps when it is created, so changing a workflow never alters runs in progress.
- **Schedules fire once.** Due workflows are selected with `SKIP LOCKED`, advanced and enqueued in a single statement, so several workers running the scheduler do not double-fire.

### Delivery guarantee

Steps run **at least once**. If a worker dies after an HTTP request was sent but before the result was recorded, the request is sent again by whoever recovers the run. Every HTTP step therefore carries an `Idempotency-Key` header (`<run id>:<step id>`, the same across retries) so the receiving API can deduplicate.

## Workflows as files

Besides the editor, workflows can live in JSON files next to the code that depends on them. On start, the `migrate` job reads every `*.json` in `WORKFLOWS_DIR` and creates or updates the workflow with that `slug`, so the files are the source of truth and applying them twice changes nothing.

```json
{
  "slug": "ticket-triage",
  "name": "Triage a new ticket",
  "trigger": { "type": "webhook", "token": "${TRIAGE_HOOK_TOKEN}" },
  "steps": [
    {
      "id": "classify",
      "type": "http",
      "method": "POST",
      "url": "${DESK_URL}/api/engine/classify",
      "headers": { "authorization": "Bearer ${ENGINE_SECRET}" },
      "body": "{\"ticketId\": \"{{trigger.body.ticketId}}\"}"
    }
  ]
}
```

`${NAME}` placeholders are filled from the job's environment when the file is loaded, which keeps URLs and secrets out of the repository; a missing variable stops the start with a message naming the file. `{{...}}` templates are left for run time. The examples in [`workflows/examples`](workflows/examples) are loaded this way.

**Sending user-provided text.** Interpolating text into a JSON body by hand breaks as soon as it contains a quote. Build the object in a transform step and send it whole: a body that is exactly `{{steps.payload}}` is serialised as JSON.

### Using it from another project

[support-desk](https://github.com/chipitaps/support-desk) is a helpdesk whose triage, alerts and escalations are three workflow files. Its Compose file builds this engine directly from the repository and mounts its own definitions:

```yaml
engine-migrate:
  build:
    context: https://github.com/chipitaps/workflow-engine.git#main
    target: tools
  environment:
    WORKFLOWS_DIR: /workflows
  volumes:
    - ./workflows:/workflows:ro
```

## Security

A tool that makes HTTP requests on behalf of whoever configures it is a server-side request forgery risk: without limits, a workflow could call `http://169.254.169.254` or a database port inside the network.

- Before every request the worker resolves the host and refuses loopback, private, link-local and reserved ranges, IPv4 and IPv6, including IPv4-mapped IPv6 addresses ([`network.ts`](src/engine/network.ts)).
- Redirects are followed manually, at most three, and **each hop is checked again**.
- Only `http` and `https`, no credentials in URLs, 15-second timeout, 256 KB response limit.
- Hosts that are meant to be reachable are named in `HTTP_ALLOW_HOSTS` (Compose allows only `app`, for the examples).
- Templates only read own properties, so `{{trigger.__proto__}}` or `constructor` resolve to nothing. Templates never execute code.
- Webhook tokens are 144 random bits; payloads are capped at 64 KB.
- Header values that look like credentials (`authorization`, `cookie`, anything containing `token`, `key` or `secret`) are sent but recorded as `[redacted]`, so they never appear in a run's timeline.

### Not covered

- **No user accounts.** Anyone who can reach the UI can edit workflows. Run it on a private network or behind an authenticating proxy.
- **DNS rebinding.** The address is checked when resolved and resolved again by the HTTP client; a hostile DNS server could answer differently the second time. Closing that needs the connection pinned to the checked address.
- **No rate limit on webhooks**, and header values such as API keys are stored unencrypted.

## Development

Requires Node 24 and a Postgres database.

```bash
npm install
export DATABASE_URL=postgres://engine:engine@localhost:5432/engine
npm run db:migrate
npm run dev        # web on http://localhost:3000
npm run worker     # in a second terminal
```

Set `ALLOW_PRIVATE_NETWORK=true` for the worker if your workflows call services on localhost.

| Command | What |
|---|---|
| `npm test` | Unit tests: templates, conditions, the state machine, the network guard, step execution with a fake `fetch`, validation, definition files |
| `npm run test:integration` | Runs the engine against a real Postgres and a local HTTP server: retries, delays, crash recovery, lost leases, concurrent claims, schedules, provisioning |
| `npm run lint`, `npm run typecheck` | Static checks |
| `npm run db:generate` | New SQL migration after changing [`schema.ts`](src/db/schema.ts) |

CI runs all of it with a Postgres service container, then starts the Compose stack with two workers, fires the example webhook and waits for the run to succeed end to end.

## Roadmap

- [ ] Cron expressions for schedules
- [ ] Branching (if/else) and parallel steps
- [ ] User accounts and encrypted secrets
- [ ] `LISTEN/NOTIFY` to wake workers instead of polling every 500 ms
- [ ] Run retention and cleanup

## License

[MIT](LICENSE)
