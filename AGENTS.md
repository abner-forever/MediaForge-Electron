# Repository Guidelines

## Project Structure & Module Organization

- `desktop/web/` — React 18 + TypeScript frontend built with Vite. Source lives in `src/`.
- `electron/` — Electron main process, Express/Node backend, and platform services.
- `electron/backend/` — API routes, stores, services, and state management.
- `data/` — runtime data such as images, logs, settings, authentication state, and user files.
- `docs/` — product, feature, release, and user documentation.
- `desktop/web/src/**/__tests__/` — frontend unit tests, co-located with source.

## Build, Test, and Development Commands

Frontend, run from `desktop/web/`:

```bash
pnpm install          # Install frontend dependencies
pnpm run dev          # Start Vite dev server on port 5173
pnpm run build        # Type-check and produce a production build
pnpm test             # Run Vitest once
pnpm run test:watch   # Run Vitest in watch mode
npx tsc --noEmit      # Type-check without emitting files
```

Desktop shell, run from `electron/`:

```bash
pnpm install          # Install Electron/backend dependencies
pnpm start            # Launch Electron with the Node backend
pnpm run dist         # Package the desktop application
```

Use `bash build_local.sh` for a one-command local release build.

## Coding Style & Naming Conventions

- Use TypeScript strict mode and avoid `any`; do not use `@ts-ignore`.
- Use the `@/` alias for imports from `src/`; avoid `../../` relative paths.
- Route all HTTP requests through `api/` modules. Never call `fetch()` directly in components or stores.
- Use Zustand's single `useStore` with slice modules instead of multiple stores.
- Name React components with `PascalCase`, hooks and utilities with `camelCase`, API modules as `xxxApi`, and props as `XxxProps`.
- Keep code identifiers in English; comments and documentation may be in Simplified Chinese.

## Testing Guidelines

Use Vitest with Testing Library for frontend unit tests. Place tests beside the code under `__tests__/` and name files `*.test.ts`. Run `pnpm test` before opening a PR and add focused tests for changed hooks, stores, utilities, and API helpers.

## Commit & Pull Request Guidelines

Follow Conventional Commits from Git history:

```text
feat: add new capability
fix: resolve a defect
chore(release): bump version
docs: update guidance
```

Keep commits small and scoped. Pull requests should describe the change, link any related issue, include screenshots or videos for UI changes, and pass type checks and tests.
