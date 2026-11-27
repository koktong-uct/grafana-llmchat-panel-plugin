# UCT Grafana LLM Chat

## Deploy on Litmus Edge

Import the Grafana dashboard and chat backend tar files, then run both containers on the same Docker network.

| Container name or network alias | Port mapping |
| --- | --- |
| `grafana-global-dashboard-llm` | `3005:3000` |
| `uct-llmchat-backend` | Keep `8787` private to Docker |

Open `https://grafana.example.com:3005/` and ask **“List equipment”**. The panel sends chat through
Grafana’s built-in route. Grafana forwards it to the backend, which calls the Grafana LLM app and queries
PostgreSQL when needed. The panel URL and route are packaged in the dashboard image.

The packaged backend uses `GRAFANA_URL=https://grafana-global-dashboard-llm:3000`,
`PGHOST=postgre-litmus`, and `CHAT_ALLOWED_ORIGINS=https://grafana.example.com:3005`.

## Build a new dashboard release

From the repo root in WSL, with Docker Desktop running, choose a new release tag such as `v1.9.2`.
repo root:
- wsl
- cd ~/grafana-plugins/uct-llmchat-panel

If fetching latest updated dashboard from litmus edge, make sure to load the tar file as image in docker first.
Refer to ./Dockerfile.grafana for the docker command to understand.

```sh
npm run build
mkdir -p artifacts
docker.exe --context desktop-linux buildx build --load --platform linux/amd64 \
  -f "$(wslpath -w "$PWD/Dockerfile.grafana")" \
  -t grafana-global-dashboard-llm:v1.9.2 "$(wslpath -w "$PWD")"
docker.exe --context desktop-linux image save --platform linux/amd64 \
  grafana-global-dashboard-llm:v1.9.2 > artifacts/grafana-global-dashboard-llm-v1.9.2.tar
```

`npm run build` generates `dist/`. `Dockerfile.grafana` copies both plugins and the route provisioning into
the dashboard image. Use `--build-arg GRAFANA_IMAGE=...` to choose a different base dashboard image, make sure
it follows the latest base image extracted from litmus edge platform! Use `-t`
and the tar filename for the new release version.

Import the new tar into Litmus and recreate the Grafana container with the new tag. Reuse the backend image
for panel-only releases.

## Rebuild the chat backend

Update `server/.env` before building. The packaged image includes that file and `server/.env.grafana-ca.pem`.
Run these commands from the main repo root in WSL with Docker Desktop running. (Command is already scoped to server/)
Docker file is at ./server/Dockerfile


```sh
mkdir -p artifacts
umask 077
docker.exe --context desktop-linux buildx build --load --platform linux/amd64 \
  --target packaged --no-cache-filter packaged \
  --secret "id=backend_env,src=$(wslpath -w "$PWD/server/.env")" \
  --secret "id=grafana_ca,src=$(wslpath -w "$PWD/server/.env.grafana-ca.pem")" \
  -t uct-llmchat-backend:1.0.2 "$(wslpath -w "$PWD/server")" && \
docker.exe --context desktop-linux image save --platform linux/amd64 \
  uct-llmchat-backend:1.0.2 > artifacts/uct-llmchat-backend-v1.0.2.tar
```

Use the same version in the build tag, export tag, and tar filename. Keep the tar private because it contains
the backend credentials. Import it into Litmus and recreate `uct-llmchat-backend` on Grafana’s Docker network.
Litmus runtime environment variables override the packaged `.env`.

Run the health check in the backend container’s terminal. Expect `200` and `{"ok":true}`.

```sh
node -e 'fetch("http://127.0.0.1:8787/health/postgres").then(async r => console.log(r.status, await r.text()))'
```

## Run both containers on Litmus Edge

After importing the tar files, run these commands with the image tags shown in Litmus. The example uses
`container` as the shared Docker network name. Replace it if your network has a different name.

```sh
docker run -d --name grafana-global-dashboard-llm -p 3005:3000 --restart always grafana-global-dashboard-llm:v1.9.1

docker run -d --name uct-llmchat-backend --restart always uct-llmchat-backend:1.0.1
```

Attach the shared litmus edge docker network afterward.

In Compose container terminal, run (or do it in Applications > Networks > Container -> Connect the container to it):
```sh
docker network connect container grafana-global-dashboard-llm
docker network connect container uct-llmchat-backend
```

Use these names for the containers or their network aliases so Grafana and the backend can find each other.
Port `8787` stays private to Docker.

## Run the manufacturing chat locally

1. Install the backend dependencies with `npm ci --prefix server`. Use Node.js 22.18 or later.
2. Copy [server/.env.example](server/.env.example) to a private env file outside the repository. Set `PGHOST` to
   your PostgreSQL hostname, leave `PGPORT=5432`, and enter the database name and a read-only account.
   The account needs read access to `dim_equipment`, `fact_equipment_state`, and `fact_production_output`.
   Set `GRAFANA_URL` to an instance with the Grafana LLM app and its Base model configured. If the instance
   requires authentication, set `GRAFANA_SERVICE_ACCOUNT_TOKEN` to a token that can call the LLM app.
   For HTTPS backed by a private CA, set `GRAFANA_TLS_CA_FILE` to its trusted PEM file. If local port
   forwarding uses a different hostname, set `GRAFANA_TLS_SERVER_NAME` to the DNS name in the certificate.
3. From the repository root, start the server and check the database connection.

   ```sh
   node --env-file=/path/to/chat-backend.env server/src/index.ts
   # In a second terminal
   curl -fsS http://127.0.0.1:8787/health/postgres
   ```

4. Run `npm run build` and load the panel in Grafana. For local development without a reverse proxy, set
   **Chat backend URL** to `http://127.0.0.1:8787/chat` and open Grafana in a browser on the machine running
   the chat backend. If the browser's Grafana origin differs from `http://localhost:3000` or
   `http://127.0.0.1:3000`, update `CHAT_ALLOWED_ORIGINS` and restart the chat backend.

Try **“List equipment”** first, then ask about an equipment ID and a time range with production data.
The backend queries PostgreSQL for equipment, KPIs, and diagnostic evidence. The configured Grafana model must
support tool calling over HTTP SSE. It can fetch several metrics, compare time ranges, and request diagnostic
evidence in one turn. The panel supplies the selected time range.

Queries use the selected absolute timestamps with an inclusive start and exclusive end. Singapore time
determines production calendar days and daily diagnostic grouping.

Set `UCAP_AOI01_DATABASE_URL`, `UCAP_AOI02_DATABASE_URL`, and `UCME_WLD01_DATABASE_URL` to add the
optional inspection sources. Use a read-only PostgreSQL account on each host. Each configured source contributes
one equipment ID to fleet OEE, component, and utilization queries. The inspection SQL keeps its original
Grafana-style inclusive end and each source's original calendar and timezone logic. The PostgreSQL health
check also checks the tables on configured sources.

| KPI | PostgreSQL calculation |
| --- | --- |
| OEE | Availability × performance × quality. Availability uses planned minutes on recorded days less DOWN and WAIT minutes. Performance uses ideal cycle time × input divided by RUN minutes, capped at 100%. Quality uses good output divided by input. |
| FPY | Good output divided by input for production records where `fpy = 0`, matching the configured reporting rule. |
| Utilization | RUN minutes overlapping the selected window divided by planned minutes. Count Monday–Friday across the rounded-up number of 24-hour periods from the Singapore start date. At least one overlapping work order is required. |
| Work orders | Distinct work-order IDs in production output, counted per piece of equipment. |
| Idle, run, down, and wait hours | Hours from recorded state intervals that overlap the selected range. |
| Part counts | Input, good, and rejected part totals from production output in the selected range. |

Comparisons evaluate all matching equipment before ranking. An explicit site or set of IDs narrows the
scope. Large diagnostic requests return period summaries per equipment.

## Backend design

The chat backend is a Node.js HTTP service in `server/`. It accepts chat requests at `POST /chat`, streams
responses as NDJSON, and exposes `GET /health/postgres` for PostgreSQL readiness.

Each turn combines the selected Grafana time range and page context with conversation history, then calls the
configured Grafana LLM through HTTP SSE. The backend provides tools for equipment lookup, KPIs, fleet
comparisons, and diagnostics; tool results are read only from PostgreSQL and returned to the model in the
same turn. Requests are origin-controlled, limited by size and duration, and concurrent turns are capped.

### Backend modules

| File | Design |
| --- | --- |
| `server/src/index.ts` | HTTP entry point. Validates origins and chat requests, streams NDJSON events, serves the PostgreSQL health check, and handles shutdown. |
| `server/src/chat.ts` | Coordinates each model turn: sends dashboard context to the LLM, runs requested tools, streams answers, and enforces a tool-call limit. |
| `server/src/chat-tools.ts` | Defines the equipment, metrics, and diagnostics tools; validates model arguments and executes queries through the PostgreSQL layer. |
| `server/src/grafana.ts` | Calls Grafana’s LLM app and parses its server-sent event stream, including streamed text and tool calls. |
| `server/src/postgres.ts` | Owns read-only PostgreSQL connections, combines core equipment with optional inspection sources, and exposes metric and evidence queries. |
| `server/src/metric-sql.ts` | Holds SQL for OEE, FPY, utilization, production counts, state hours, and diagnostic evidence. |
| `server/src/inspection-sources.ts` | Configures optional AOI and welding inspection databases, maps their equipment, and runs source-specific KPI queries. |
| `server/src/sql/ucap-aoi01.sql` | Calculates OEE components and utilization for UCAP Power Box AOI using its inspection tables and pass/quality rules. |
| `server/src/sql/ucap-aoi02.sql` | Calculates OEE components and utilization for UCAP Gas Panel AOI using its separate schema and failure rules. |
| `server/src/sql/ucme-wld01.sql` | Calculates OEE components and utilization for UCME Weldment Inspection using its inspection schema and Shanghai-time rules. |
| `server/src/diagnostics.ts` | Maps diagnostic requests (OEE, its components, FPY, and utilization) to the KPI and evidence data they need. |
| `server/src/equipment.ts` | Resolves equipment by normalized name, ID, serial number, alias, site, or type. |
| `server/src/fleet-ranking.ts` | Recognizes common highest/lowest questions and formats their fleet ranking results. |
| `server/src/query-report.ts` | Builds concise tool activity reports, comparison tables, and query context for chat follow-ups. |
| `server/src/time-range.ts` | Validates timezone-qualified ranges and formats them in Singapore time. |
| `server/src/types.ts` | Defines shared request, model, tool, metric, and report types, plus the backend error type. |

## What are Grafana panel plugins?

Panel plugins allow you to add new types of visualizations to your dashboard, such as maps, clocks, pie charts, lists, and more.

Use panel plugins when you want to do things like visualize data returned by data source queries, navigate between dashboards, or control external systems (such as smart home devices).

## Getting started

### Frontend

1. Install dependencies

   ```bash
   npm install
   ```

2. Build plugin in development mode and run in watch mode

   ```bash
   npm run dev
   ```

3. Build plugin in production mode

   ```bash
   npm run build
   ```

4. Run the tests (using Jest)

   ```bash
   # Runs the tests and watches for changes, requires git init first
   npm run test

   # Exits after running all the tests
   npm run test:ci
   ```

5. Spin up a Grafana instance and run the plugin inside it (using Docker)

   ```bash
   npm run server
   ```

6. Run the E2E tests (using Playwright)

   ```bash
   # Spins up a Grafana instance first that we tests against
   npm run server

   # If you wish to start a certain Grafana version. If not specified will use latest by default
   GRAFANA_VERSION=11.3.0 npm run server

   # Starts the tests
   npm run e2e
   ```

7. Run the linter

   ```bash
   npm run lint

   # or

   npm run lint:fix
   ```

# Distributing your plugin

When distributing a Grafana plugin either within the community or privately the plugin must be signed so the Grafana application can verify its authenticity. This can be done with the `@grafana/sign-plugin` package.

_Note: It's not necessary to sign a plugin during development. The docker development environment that is scaffolded with `@grafana/create-plugin` caters for running the plugin without a signature._

## Initial steps

Before signing a plugin please read the Grafana [plugin publishing and signing criteria](https://grafana.com/legal/plugins/#plugin-publishing-and-signing-criteria) documentation carefully.

`@grafana/create-plugin` has added the necessary commands and workflows to make signing and distributing a plugin via the grafana plugins catalog as straightforward as possible.

Before signing a plugin for the first time please consult the Grafana [plugin signature levels](https://grafana.com/legal/plugins/#what-are-the-different-classifications-of-plugins) documentation to understand the differences between the types of signature level.

1. Create a [Grafana Cloud account](https://grafana.com/signup).
2. Make sure that the first part of the plugin ID matches the slug of your Grafana Cloud account.
   - _You can find the plugin ID in the `plugin.json` file inside your plugin directory. For example, if your account slug is `acmecorp`, you need to prefix the plugin ID with `acmecorp-`._
3. Create a Grafana Cloud API key with the `PluginPublisher` role.
4. Keep a record of this API key as it will be required for signing a plugin

## Signing a plugin

### Using Github actions release workflow

If the plugin is using the github actions supplied with `@grafana/create-plugin` signing a plugin is included out of the box. The [release workflow](./.github/workflows/release.yml) can prepare everything to make submitting your plugin to Grafana as easy as possible. Before being able to sign the plugin however a secret needs adding to the Github repository.

1. Please navigate to "settings > secrets > actions" within your repo to create secrets.
2. Click "New repository secret"
3. Name the secret "GRAFANA_API_KEY"
4. Paste your Grafana Cloud API key in the Secret field
5. Click "Add secret"

#### Push a version tag

To trigger the workflow we need to push a version tag to github. This can be achieved with the following steps:

1. Run `npm version <major|minor|patch>`
2. Run `git push origin main --follow-tags`

## Learn more

Below you can find source code for existing app plugins and other related documentation.

- [Basic panel plugin example](https://github.com/grafana/grafana-plugin-examples/tree/master/examples/panel-basic#readme)
- [`plugin.json` documentation](https://grafana.com/developers/plugin-tools/reference/plugin-json)
- [How to sign a plugin?](https://grafana.com/developers/plugin-tools/publish-a-plugin/sign-a-plugin)
