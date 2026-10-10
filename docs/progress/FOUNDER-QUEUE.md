# Founder queue
Items only the founder can do (AUTOPILOT.md §3). The autopilot adds rows; the founder marks them done. Never paste secret values here or in chat — put them in `.env.local` or Doppler.

| Date | Item | Why | Exact founder steps | Blocking which milestone |
| --- | --- | --- | --- | --- |
| 2026-10-11 | Fix the dev machine toolchain (build-notes Q5) | Checked 2026-10-11: Node 20.20.0 is active and Node 22 is not installed (nvm has 25.3.0, 24.11.0, 20.20.0, 18.20.8); `pnpm -v` crashes (Corepack's pnpm 12.8.1 files are missing); Docker Desktop is installed but its engine is not running; gitleaks is not installed. M0a's first commit (S1.0) needs gitleaks; `pnpm verify` needs Node 22 + pnpm + Docker. | In PowerShell: `nvm install 22` → `nvm use 22` → `corepack enable` → `corepack prepare pnpm@latest --activate` → `winget install Gitleaks.Gitleaks` → start Docker Desktop and wait for "Engine running". Check: `node -v` (v22.x), `pnpm -v`, `gitleaks version`, `docker info`. Then tell the autopilot "toolchain ready". | M0a BUILD (SPEC can proceed) |
