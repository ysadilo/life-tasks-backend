# life-tasks-backend

NestJS API + Prisma + Postgres for Life Tasks Manager. Owns all business rules,
authorization, recurrence generation — the client
(`life-tasks-frontend`) never touches Postgres directly.

## Setup

```bash
cp .env.example .env
docker compose up -d          # local Postgres on :5432
pnpm install
pnpm prisma:migrate           # creates tables from prisma/schema.prisma
pnpm start:dev                # API on :3000
```

## Status

`tasks` and `boards` CRUD, Prisma schema matching the data model in
`../ARCHITECTURE.md` §5.

Phase 4 (auth) is wired: `Auth0AuthGuard` verifies the caller's Auth0 access
token (RS256, against the tenant JWKS) on every `/api/tasks` and `/api/boards`
route, checking `iss` and `aud`. The user id comes from the token `sub`
(`@CurrentUser()`), not from query/body params. `TasksController` resolves the
caller's solo board via `BoardsService.resolveSoloBoardId`, which bootstraps the
`User` + `Board` rows on first request (email read once from Auth0 `/userinfo`).
Set `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` before starting the API.

Rollover is lazy: listing tasks with `?today=YYYY-MM-DD` moves stale Today tasks to
Triage and promotes due backlog tasks to Today (`TasksService.findMany`).

Recurrence (`task_templates` + `rrule`) is modeled in the Prisma schema but not
yet wired to any generation logic — that's phase 5.

## Scripts

- `pnpm start:dev` — watch mode
- `pnpm prisma:migrate` — run/create a migration
- `pnpm prisma:generate` — regenerate the Prisma client after schema changes
- `pnpm lint` / `pnpm test`
- `pnpm format` / `pnpm format:check` — prettier
