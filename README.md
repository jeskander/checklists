# Blocks

A minimal PWA for block templates and daily plans. Local-first (IndexedDB) with optional Notion sync.

## Development

```bash
npm install
cp .env.example .env.local
# Add VITE_NOTION_TOKEN and database IDs (optional for local-only use)
npm run dev
```

## Notion setup

Databases are already created in Notion — see **[docs/NOTION_SETUP.md](docs/NOTION_SETUP.md)** for links and IDs.

1. Copy `.env.example` to `.env.local` (or use the generated `.env.local` with IDs pre-filled).
2. Add your integration token as `VITE_NOTION_TOKEN`.
3. Share all five databases with your integration (Connections on each DB).
4. Restart dev server → **Settings → Sync now**.

## Deploy (Netlify)

```bash
npm run build
```

Set the same `VITE_*` env vars in Netlify. The `netlify.toml` is included.

## License

MIT — personal project.
