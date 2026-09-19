# Dependency inventory

## Baseline

- Local runtime: Node `22.14.0`, npm `10.9.2`.
- Declared engine: Node `>=22.13.0`.
- Package manager: npm (`package-lock.json`).
- Build: Vinext + Vite + Cloudflare Vite plugin.

## Significant runtime dependencies

| Package | Version | Purpose / use | Coupling / observation |
| --- | --- | --- | --- |
| React / React DOM | `^19.2.8` | application UI | pervasive |
| Vinext | `^1.0.0-beta.9` | Next-compatible routing/build on Vite/Workers | deployment-critical beta |
| Drizzle ORM | `^0.45.2` | D1 schema definitions | schema-critical; runtime mostly raw SQL |
| `@base-ui/react` | `1.7.0` | dialog/menu/accessibility primitives | UI primitives |
| `lucide-react` | `1.31.0` | icons | pervasive presentation dependency |
| `react-resizable-panels` | `4.5.8` | resizable exam explanation layout | exam UI-specific |
| `ts-fsrs` | `^5.4.2` | flashcard scheduling | flashcard-domain coupling |
| `sql.js` | `^1.14.2` | Anki/SQLite import in browser | adds 39.7 KB loader JS + WASM asset; low-end cost |
| `fflate` | `^0.8.3` | compressed import/export | import/backup |
| `jsonrepair` | `^3.15.0` | tolerant JSON import | import pipeline |
| CVA / clsx / tailwind-merge | pinned/current declared | class composition | overlapping but conventional roles |
| shadcn | `4.18.0` | component/tooling ecosystem | UI structure |

## Significant development/deployment dependencies

| Package | Version | Purpose |
| --- | --- | --- |
| TypeScript | `5.9.3` | types/build |
| Vite | `^8.2.2` | bundling/dev |
| Cloudflare Vite plugin | `^1.54.3` | Workers integration |
| Wrangler | `^4.128.0` | local Worker/D1/migrations/deploy |
| Drizzle Kit | `^0.31.10` | migration generation |
| Tailwind/PostCSS | `4.2.1` | styling |
| oxlint / oxfmt | `1.76.0` / `0.61.0` | code quality |

## Commands

| Purpose | Command |
| --- | --- |
| Development | `npm run dev` |
| Build | `npm run build` |
| Tests | `npm test` |
| Lint/format | `npm run lint`, `npm run format` |
| Built local Worker | `npm start` |
| Generate/apply local migration | `npm run db:generate`, `npm run db:migrate:local` |
| Cloudflare dry run/deploy | `npm run cloudflare:check`, `deploy:*` |

## Audit observations

- No dependency was installed, removed, upgraded, or audited against a live vulnerability service.
- No package was conclusively proven unused. `R2_PUBLIC_URL` was unused as an environment name, not a package.
- Vinext is beta and deeply coupled to routing/build/deployment, so upgrades require a dedicated compatibility phase.
- SQL.js/WASM and the monolithic app chunk are important performance inputs.
- Package overlap in class helpers is intentional enough that removal should not be attempted without usage analysis.
