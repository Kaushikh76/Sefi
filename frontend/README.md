# SeFi Frontend

Next.js dashboard for SeFi indexing, modeling, and agent workflows.

## Quick Start

```bash
cd frontend
npm install
npm run dev
```

- URL: `http://localhost:3000`
- Backend API (default): `http://127.0.0.1:3210/api/v1`

## Runtime Notes

- Frontend rewrites `/api/v1/:path*` to backend (`frontend/next.config.mjs`)
- Long-running agent routes use elevated proxy timeout in dev/build config
- Chat/converse and playground endpoints use extended write timeout in API client

## Main Routes

- `/indexing/overview`
- `/indexing/runs`
- `/indexing/contracts`
- `/modeling/studio`
- `/modeling/query`
- `/modeling/api`
- `/agents`
- `/agents/converse`
- `/agents/playground`
- `/agents/[id]/[tab]`

## Env

- `NEXT_PUBLIC_SEFI_API_BASE` (optional override)
- `NEXT_PUBLIC_SEFI_API_TOKEN` (optional)

## More Detail

See root guide: [../README.md](../README.md)
