# Smart Folders

An Obsidian plugin that gives folders their own properties and templates.

Each folder can hold a hidden `.osf/` directory:

```
MyFolder/
  .osf/
    frontmatter.yaml   # folder properties
    templates/*.md     # folder-specific templates
```

Click a folder in the File Explorer (or right-click → **Open folder page**) to open its
page: edit properties, browse subfolders, see its templates.

## For plugin developers

Read and write folder properties, use folder templates and react to changes through the
versioned API at `app.plugins.plugins["smart-folders"].api`. See [docs/API.md](docs/API.md).

## Development

```sh
npm install
npm run check          # typecheck + tests + build
npm run dev            # watch build
OBSIDIAN_VAULT=~/TestVault npm run install:vault
```

Contributor/agent guide: [CLAUDE.md](CLAUDE.md). Plan: [docs/ROADMAP.md](docs/ROADMAP.md).
