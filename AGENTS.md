# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the React + TypeScript overlay UI. The current entry points are `src/main.tsx` and `src/App.tsx`, with styles in `src/App.css` and static frontend assets under `src/assets/`. `public/` is for files served directly by Vite. The desktop shell lives in `src-tauri/`: Rust sources are in `src-tauri/src/`, app capabilities in `src-tauri/capabilities/`, generated schemas in `src-tauri/gen/`, and bundled icons in `src-tauri/icons/`.

## Build, Test, and Development Commands
Use `npm run dev` to start the Vite frontend for UI iteration. Use `npm run build` to type-check with `tsc` and produce the production web bundle in `dist/`. Use `npm run tauri dev` to run the full desktop app with the Tauri shell. Use `npm run tauri build` to create desktop builds. For Rust-only validation, run `cargo check` from `src-tauri/`.

## Coding Style & Naming Conventions
Match the existing style instead of introducing a new one. TypeScript uses 2-space indentation, double quotes, semicolons, and `PascalCase` for React components (`App.tsx`) with `camelCase` for hooks, handlers, and local helpers. Keep constants in `UPPER_SNAKE_CASE`. Rust follows standard `rustfmt` conventions with `snake_case` functions and clear, descriptive names for platform-specific helpers. Keep files focused; UI behavior belongs in `src/`, native windowing and system hooks belong in `src-tauri/`.

## Testing Guidelines
There is no dedicated automated test suite yet. Treat `npm run build` as the minimum frontend validation step and `cargo check` in `src-tauri/` as the minimum native validation step. For behavior changes, manually verify the overlay flow, especially window transitions and the global Shift shortcut on the target platform.

## Commit & Pull Request Guidelines
Recent commits use short, imperative, lowercase subjects such as `build tomo ui and window shell` and `add macOS global shift listener and window transition animations`. Keep commits focused and descriptive. Pull requests should summarize user-visible changes, note platform-specific behavior, link related issues, and include screenshots or recordings when the UI or window behavior changes.

## Security & Configuration Tips
Do not commit secrets, local credentials, or machine-specific config. Treat `src-tauri/capabilities/default.json` and `src-tauri/tauri.conf.json` as sensitive runtime configuration and document any permission changes in the PR.
