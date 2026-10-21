---
paths:
  - "public/index.php"
  - "puls"
  - "config.php"
  - ".env.example"
---

# Keep docs in sync

When changing these files, check if the docs or CLAUDE.md need updating. README.md is the landing page; the reference docs live in `docs/`:

- **New/changed endpoint** → update CLAUDE.md endpoint table
- **New/changed CLI command** → update the CLI reference in docs/configuration.md (+ CLAUDE.md file list if a file is added)
- **New/changed .env variable** → update the settings in docs/configuration.md + .env.example
- **New file added to project** → update CLAUDE.md file list
- **New/changed script attribute** → update the attribute table in docs/integrations.md
- **New/changed install or server requirement** → update docs/install.md
- **User-visible feature** → check if the "What you get" list in README.md should mention it
- **Test count changes significantly** → update CLAUDE.md test count
