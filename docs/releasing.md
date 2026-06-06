# Releasing & auto-updates

Tables++ ships as a native installer per platform and updates itself in place using Tauri's
updater. This is the one-time setup plus the per-release flow.

## How it fits together

- `npm run tauri build` produces installers: **`.dmg`/`.app`** (macOS), **`.msi`/`.exe`**
  (Windows), **`.AppImage`/`.deb`/`.rpm`** (Linux).
- With `bundle.createUpdaterArtifacts: true`, the build also emits **signed update artifacts**
  and a **`latest.json`** manifest.
- The app's updater (`src-tauri/tauri.conf.json` → `plugins.updater`) checks the `endpoints`
  URL on launch; `src/features/updates/AppUpdater.tsx` prompts the user to **Install & Restart**.
- The download/verify/install happen in the Rust plugin and are verified against the
  **updater public key** baked into the config — so a tampered update is rejected.

> **Two kinds of signing, don't conflate them:**
> 1. **Updater signing key** (a minisign keypair) — authenticates the *update payload*. The
>    **public** half goes in `tauri.conf.json`; the **private** half is a CI secret. This is what
>    makes auto-update trustworthy.
> 2. **OS code-signing certificate** (Apple Developer ID / Windows Authenticode) — makes the
>    *installer* trusted by the OS so users don't see "unidentified developer" warnings. Optional;
>    reused across all your apps.

## One-time setup

### 1. Updater signing key

Either **generate a new key** for Tables++:

```bash
npm run tauri signer generate -- -w ~/.tauri/tablesplusplus.key
```

…or **reuse an existing key** (e.g. from another of your apps). Either way you end up with a
**public key** and a **private key** (+ optional password).

- Put the **public key** in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
  (replace `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY`).
- Add the **private key** and its password as GitHub Actions secrets:
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty string if none)

> Reusing another project's key means setting **this repo's** `pubkey` to that key's public half
> and adding that key's private half to **this repo's** secrets — keys are not shared between
> repos automatically, and CI secrets can't be read across repositories.

### 2. (Optional) OS code-signing

Add the relevant secrets so installers are signed/notarized — see the comments at the top of
`.github/workflows/release.yml`. Skip this to ship **unsigned** installers (they work, but the
OS shows a one-time warning on first launch).

## Cutting a release

1. Bump the version in **all three** manifests so they stay in sync: `package.json`,
   `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` (the updater compares the
   `tauri.conf.json` version). Run `npm install` so `package-lock.json` picks up the new version.
2. Tag and push:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. The **Release** workflow builds all three platforms, signs the update artifacts, and creates a
   **draft GitHub Release** with the installers + `latest.json`.
4. Review the draft and **publish** it. Existing installs will see the update on their next launch.

> The updater endpoint is `…/releases/latest/download/latest.json`, so it always points at the
> newest **published** (non-draft) release.
