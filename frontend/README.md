# SeFi Frontend

Next.js + shadcn dashboard for SeFi indexing metrics and records.

## Quick Start

```bash
cd SeFi/frontend
npm install
npm run dev
```

Set the backend URL if needed:

```bash
NEXT_PUBLIC_SEFI_API_BASE=http://localhost:3210/api/v1
NEXT_PUBLIC_SEFI_API_TOKEN=
```

## UI Features

- Route-based app shell with responsive sidebar and top utility bar
- Indexing tabs:
  - `/indexing/overview`
  - `/indexing/runs`
  - `/indexing/contracts`
- Data modeling tabs:
  - `/modeling/studio`
  - `/modeling/query`
- Agents workspace:
  - `/agents` (manager dashboard)
  - `/agents/new` (creation flow)
  - `/agents/[id]/[tab]` (brainstorm, semantic, tools, automations, publish, activity, settings)
  - `/agents/playground` (legacy semantic playground)
- Model Studio supports SQLite schema introspection, preview diff, and apply flow
- Model Studio includes model file manager (list/filter), YAML text editor, save/delete/create actions, and persistence status
- Query Lab supports Cube semantic queries and SQL execution against SQLite
- Agents workspace includes persisted Hedera/ElizaOS agent management, runtime controls, and publish test tooling
- Legacy semantic-first NL-to-query playground remains available under `/agents/playground`
