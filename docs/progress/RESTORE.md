# Restore, roll back, move machines
Backups are local git bundles written by `scripts/backup.sh` into `../trace-backups/` (next to the repo folder). Each bundle holds every branch and tag (`--all`). The script keeps the newest 10.

## 1. Restore from a bundle
1. Pick a bundle: `ls -t ../trace-backups/*.bundle | head`
2. Check it is complete: `git bundle verify ../trace-backups/<file>.bundle`
3. Clone it into a new folder (never over the existing repo):
   `git clone ../trace-backups/<file>.bundle TraceHiring-restored`
4. In the new folder, recreate local branches you need: `git branch -a`, then `git switch milestone/m<X>` (git creates it from `origin/milestone/m<X>`).
5. Tags come across with the clone: `git tag -l 'cp/*'`.
6. The clone's `origin` points at the bundle file. Remove it so nothing tries to fetch from it later: `git remote remove origin`.
7. Re-create `.env.local` (see §3). Run `pnpm install` and `pnpm verify` before working.

To pull a single branch out of a bundle into the existing repo instead:
`git fetch ../trace-backups/<file>.bundle 'refs/heads/milestone/m<X>:refs/heads/restored/m<X>'`

## 2. Roll back to a checkpoint (cp tag)
Checkpoints are tags `cp/m<X>-<NN>` on the milestone branch, made after each green sub-step.
1. Make sure you are on the milestone branch: `git switch milestone/m<X>`.
2. Save the current state first — always: `git branch rescue/<YYYYMMDD-HHMM> HEAD`
3. Roll back: `git reset --hard cp/m<X>-<NN>`
4. Add a row to `docs/progress/LOG.md` naming the rescue branch and the cp tag.
Never reset `main`, never delete tags, never delete a rescue branch without the founder's OK.

## 3. Move the project to another machine
1. Copy the **whole** project folder, including the hidden `.git` folder (a zip of the folder, an external drive, or a bundle from §1). Copying only the working files loses history, branches and tags.
2. Also copy `../trace-backups/` if you want the older bundles.
3. Do **not** copy `.env.local`. Re-create it on the new machine from 1Password or Doppler. Never send it over chat, email or a shared drive.
4. Install the toolchain: Node 22, pnpm, Docker Desktop, gitleaks (see `docs/setup-checklist.md`).
5. In the folder: `git status` (should be clean), `pnpm install`, `pnpm verify`.
6. Start Claude Code in the folder and give it the NEXT PROMPT from `docs/AUTOPILOT.md` §7.
