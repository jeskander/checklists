# Notion setup — created in your workspace

## Hub page

**Blocks App**  
https://www.notion.so/372a895b37ae8156bd28e89353710600

All five databases live under this page.

---

## Database IDs (for `.env.local`)

| Database | Env variable | Database ID |
|----------|--------------|-------------|
| Templates | `VITE_NOTION_TEMPLATES_DB` | `a69abea3d36a42a2854ed08a018a2828` |
| Template Items | `VITE_NOTION_TEMPLATE_ITEMS_DB` | `e43e6bd202944ad1a2e65f1334f26d5c` |
| Days | `VITE_NOTION_DAYS_DB` | `871b8a3a33fb4b7fb8102f9db58e76b3` |
| Day Instances | `VITE_NOTION_DAY_INSTANCES_DB` | `1ff406136ab54cdcb1bce2bd38879fd2` |
| Day Instance Items | `VITE_NOTION_DAY_INSTANCE_ITEMS_DB` | `fb18230e80fb4bc2bf98f4a9b387f514` |

### Links

- [Templates](https://www.notion.so/a69abea3d36a42a2854ed08a018a2828)
- [Template Items](https://www.notion.so/e43e6bd202944ad1a2e65f1334f26d5c)
- [Days](https://www.notion.so/871b8a3a33fb4b7fb8102f9db58e76b3)
- [Day Instances](https://www.notion.so/1ff406136ab54cdcb1bce2bd38879fd2)
- [Day Instance Items](https://www.notion.so/fb18230e80fb4bc2bf98f4a9b387f514)

---

## Your steps

1. Create a Notion integration at https://www.notion.so/my-integrations  
2. Copy the **Internal Integration Secret** into `.env.local` as `VITE_NOTION_TOKEN`  
3. On each database above: `⋯` → **Connections** → add your integration  
4. Restart the dev server (`npm run dev`)  
5. In the app: **Settings → Sync now**

A starter `.env.local` with database IDs (no token) is in the project root.

---

## Data source IDs (reference only)

Used internally by Notion; the app uses **database** IDs above.

| Database | Data source ID |
|----------|----------------|
| Templates | `8d6587eb-c0bc-4eed-86e6-e0c45928792e` |
| Template Items | `8df8a4e3-12c2-432f-8db8-c59d4c010023` |
| Days | `cae05591-b56c-4f51-9337-2ca8b7d63d9f` |
| Day Instances | `6e41f0dd-1c92-4938-a6ee-e4b181b7618b` |
| Day Instance Items | `5c33194f-b11f-4f50-b5e0-8f51ea3b6625` |

Schema details: [NOTION_SCHEMA.md](./NOTION_SCHEMA.md)
