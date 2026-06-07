# Blocks

A minimal PWA for block templates and daily plans. **Offline-first** (IndexedDB via Dexie) with Supabase sync when signed in.

## Development

```bash
npm install
cp .env.example .env.local
# Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

## Architecture

- **Local source of truth:** Dexie (IndexedDB) — all reads and writes are instant
- **Cloud sync:** Supabase — background push/pull with an outbox queue
- **UI reactivity:** `dexie-react-hooks` live queries (no React Query cache layer)

## Deploy (Netlify)

```bash
npm run build
```

Set `VITE_SUPABASE_*` env vars in Netlify. The `netlify.toml` is included.

## License

MIT — personal project.
