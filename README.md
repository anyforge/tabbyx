# TabbyX

**Terminal Is All You Need**

![TabbyX](docs/readme.png)

> Forked from [Tabby](https://github.com/Eugeny/tabby), modded with Hermes.

On top of everything native Tabby offers, TabbyX adds:

- **Left sidebar** — a persistent connection tree on the left for quick switching and management (not in native Tabby)
- **SFTP split pane** — Terminal and SFTP side by side (60:40), independently closable, no cross-connection mixing when switching
- **SSH host-key TOFU** — First connection auto-trusts and stores the key, so nothing interrupts you; it only warns when a key genuinely changes
- **Password-first auth** — With a saved password, auto private-key loading is skipped, so no repeated passphrase prompts
- **Show-password toggle** — Every password field has an eye icon to reveal or hide the text
- **Fixed SSH algorithm priorities** — Negotiates ed25519 / chacha20-poly1305 / hmac-sha2-512 by default, so weaker algorithms are no longer preferred
- **JetBrainsMono Nerd Font by default** — Nerd Font glyphs work out of the box
- **Unified config dir `~/.config/tabbyx/`** — Same path on macOS and Linux for easier cross-machine sync
- **Themes** — Dracula (dark default), One Dark, One Half Light (light default)

## Note for macOS users

macOS builds are unsigned (no Apple Developer ID). On first launch, macOS may report "TabbyX is damaged and can't be opened" or "cannot verify the developer". To open it:

- Right-click the app in Finder → **Open** (do this once), or
- Remove the quarantine attribute:

  ```bash
  xattr -cr /Applications/TabbyX.app
  ```

## Building from source

Requirements: Node.js 22, Yarn, Rust (via rustup). Also Xcode Command Line Tools on macOS, `gem install fpm` + `libfontconfig1-dev`/`libarchive-tools` on Linux, and VS Build Tools (C++) on Windows.

```bash
git clone https://github.com/anyforge/tabbyx.git
cd tabbyx
yarn install                        # deps + native modules
yarn build                          # typings + all plugins
node scripts/prepackage-plugins.mjs # bundle built-in plugins
```

Then package per platform:

| Platform | Command |
|----------|---------|
| macOS (Apple Silicon) | `ARCH=arm64 node scripts/build-macos.mjs` |
| macOS (Intel) | `ARCH=x86_64 node scripts/build-macos.mjs` |
| Linux (x64) | `ARCH=x64 node scripts/build-linux.mjs` |
| Windows (x64) | `node scripts/build-windows.mjs` |

Installers land in `dist/`.

> In China, run `bash setup-dev.sh` for a one-shot setup with an npm mirror and a GitHub proxy.
