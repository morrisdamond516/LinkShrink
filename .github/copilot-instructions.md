# Copilot instructions — Link-Shrink

This repository runs a combined Express API + React client served from a single Node process. Keep guidance concise and specific to code paths and conventions used here.

- **Big picture**: server boots from [server/index.ts](../server/index.ts#L1-L120). It registers API routes ([server/routes.ts](../server/routes.ts#L1-L220)), then either mounts Vite middleware in dev ([server/vite.ts](../server/vite.ts#L1-L200)) or serves prebuilt static assets in production ([server/static.ts](../server/static.ts#L1-L80)). Database access is via `drizzle-orm` in [server/db.ts](../server/db.ts#L1-L50) and schema is in [shared/schema.ts](../shared/schema.ts#L1-L120).

- **How to run (dev)**: use the npm scripts in `package.json`.
  - `npm run dev` — runs `tsx server/index.ts` which starts Express + Vite middleware.
  - Environment vars required for dev: at minimum `DATABASE_URL`. Stripe: set `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`. For webhook verification set `STRIPE_WEBHOOK_SECRET` (optional but recommended).
  - Note (Windows): `package.json` sets env vars inline (`NODE_ENV=development ...`), which may not work in cmd.exe. On PowerShell run:

    ```powershell
    $env:NODE_ENV = 'development'
    npm run dev
    ```

- **How to build / run (prod)**:
  - `npm run build` — builds the client with Vite and bundles the server via `script/build.ts` (Vite client output -> `dist/public`, server bundle -> `dist/index.cjs`).
  - `npm start` — runs the bundled server. Ensure `DATABASE_URL` and other production envs are set.

- **API surface**: defined in [shared/routes.ts](../shared/routes.ts#L1-L220). Key endpoints:
  - `POST /api/shorten` — create short URL (input validated with Zod; response shape defined in `shared/routes.ts`).
  - `GET /api/urls/:shortCode` — fetch URL metadata.
  - `POST /api/create-checkout-session` — Stripe checkout session (see [server/routes.ts](../server/routes.ts#L1-L80)).
  - `GET /api/stripe-publishable-key` — returns publishable key for client-side Stripe initialization.
  - `GET /api/confirm-checkout?session_id=...` — server-side verification of a Stripe session and plan confirmation.
  - `POST /api/webhook` — Stripe webhook endpoint (verify with `STRIPE_WEBHOOK_SECRET` in env).
  - `POST /api/register`, `POST /api/login`, `GET /api/me` — lightweight user auth endpoints; the server uses an httpOnly `session_token` cookie to identify users and tie payments to user accounts.
  - `GET /:shortCode` — redirect route implemented in [server/routes.ts](../server/routes.ts#L80-L180). It ignores `api/*` and paths containing `.`.

- **Storage & DB**:
  - Storage implementation: [server/storage.ts](../server/storage.ts#L1-L220) uses `drizzle-orm` and `@shared/schema` types. Short-code generation: **starts at length 5 and grows on collisions (keeps links between 5 and 20 characters)**.
  - Payments: a simple `payments` table exists in [shared/schema.ts](shared/schema.ts#L1-L200) and the server records confirmed checkout sessions there via `/api/confirm-checkout` and `/api/webhook`.
  - Migrations config: [drizzle.config.ts](../drizzle.config.ts#L1-L40). Use `npm run db:push` to push migrations (requires `DATABASE_URL`).

- **Patterns & conventions**:
  - Path aliases: `@shared` -> `shared`, `@` -> `client/src` (see [vite.config.ts](../vite.config.ts#L1-L120)). Use those when editing shared types or client imports.
  - Dev server uses Vite middleware (HMR path `/vite-hmr`) — see [server/vite.ts](server/vite.ts#L1-L160).
  - Logging: lightweight custom logger `log()` in [server/index.ts](server/index.ts#L1-L120) that prints API responses for `/api` prefixed routes.
  - Error handling: express error handler in [server/index.ts](server/index.ts#L120-L200) returns JSON `{ message }` and rethrows.

- **When changing API or schema**:
  - Update `shared/schema.ts` first for types, then adjust storage logic in [server/storage.ts](server/storage.ts#L1-L220) and route validation in `shared/routes.ts`.
  - Run `npm run check` to run TypeScript type check before committing.

- **Notable implementation details for code-gen/AI agents**:
  - Short-code algorithm intentionally avoids ambiguous/ vowel characters (see `chars` in [server/storage.ts](server/storage.ts#L1-L80)). Preserve this behavior when refactoring.
  - Client is a plain Vite + React app under `client/`; index entry is `client/src/main.tsx` and `client/index.html` is transformed by Vite in dev. Edits to index.html may require the dev middleware to re-load; `server/vite.ts` appends a nanoid query param to bust cache.
  - Build: [`script/build.ts`](../script/build.ts#L1-L200) bundles server with `esbuild` and client via Vite; keep the `allowlist` if adding large server deps to avoid bundling issues.

- **Quick references**:
  - Server bootstrap: [server/index.ts](server/index.ts#L1-L120)
  - Routes + redirect: [server/routes.ts](server/routes.ts#L1-L220)
  - Storage & schema: [server/storage.ts](server/storage.ts#L1-L220), [shared/schema.ts](shared/schema.ts#L1-L120)
  - Vite config & aliases: [vite.config.ts](vite.config.ts#L1-L140)
  - Build script: [script/build.ts](script/build.ts#L1-L200)

- **Testing payments locally**:
  - Set `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` in environment.
  - Start the app (dev):

    ```powershell
    $env:DATABASE_URL = 'postgresql://...'
    $env:STRIPE_SECRET_KEY = 'sk_test_...'
    $env:STRIPE_PUBLISHABLE_KEY = 'pk_test_...'
    npm run dev
    ```

  - (Optional) Run Stripe CLI to forward webhooks:

    ```bash
    stripe listen --forward-to http://localhost:5000/api/webhook
    ```

  - Complete a test checkout from `/pricing` and verify `/api/confirm-checkout?session_id=...` returns the confirmed plan.

If anything here is unclear or you want the instructions to emphasize other files/workflows (CI, tests, or deploy), tell me which areas to expand. I'll iterate.
