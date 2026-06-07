/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NOTION_TOKEN?: string
  readonly VITE_NOTION_TEMPLATES_DB?: string
  readonly VITE_NOTION_TEMPLATE_ITEMS_DB?: string
  readonly VITE_NOTION_DAYS_DB?: string
  readonly VITE_NOTION_DAY_INSTANCES_DB?: string
  readonly VITE_NOTION_DAY_INSTANCE_ITEMS_DB?: string
  readonly VITE_ANTHROPIC_API_KEY?: string
  readonly VITE_ANTHROPIC_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
