---
id: 2026-05-04-gotcha-npm-cli-update-leaves-mcp-stale
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/cli/package.json
    - packages/mcp/package.json
  symbols: []
tags:
  - release
  - npm
  - ux
  - v0.9.0
created_at: '2026-05-04T01:05:36.619Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
sensor:
  kind: regex
  pattern: "npm\\s+(install|i)\\s+-g\\s+@hiveai\\/cli"
  message: "Always install @hiveai/cli AND @hiveai/mcp together: `npm i -g @hiveai/cli@latest @hiveai/mcp@latest`. Installing only the CLI leaves the global MCP binary stale."
  severity: warn
  autogen: false
  last_fired: null
  paths:
    - packages/cli/package.json
    - packages/mcp/package.json
---
# `npm install -g @hiveai/cli@latest` ne met PAS à jour `@hiveai/mcp` global

**Reproduit en v0.9.0** :
- `npm i -g @hiveai/cli@latest` → CLI passe à 0.9.0
- Mais `haive-mcp --version` reste à la version précédemment installée (0.6.0 sur cette machine)
- Conséquence : tous les nouveaux tools MCP (pattern_detect, etc.) sont **inaccessibles** aux clients (Claude Code, Cursor) puisque leurs configs pointent vers le binaire global `haive-mcp`.

**Pourquoi** : `@hiveai/mcp` est un package séparé sur npm avec son propre binaire global. Il n'est pas une dépendance hoist-able du CLI au niveau global.

**Fix utilisateur** : `npm i -g @hiveai/cli@latest @hiveai/mcp@latest` (les deux ensemble).

**Fix produit (suggestions)** :
1. Ajouter à `haive doctor` un check version-mismatch CLI vs MCP qui suggère la commande de fix
2. Ou intégrer le serveur MCP directement dans le binaire `haive` (ex. `haive mcp --stdio`) pour qu'il n'y ait qu'un seul package à mettre à jour
3. Ou faire de `@hiveai/cli` un meta-package qui dépend de `@hiveai/mcp` ET expose les deux binaires
