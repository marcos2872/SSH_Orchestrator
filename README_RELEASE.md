# Gerando Releases

Este projeto usa **Tauri v2**. O build é feito **localmente** e os artefatos são publicados manualmente como GitHub Release via `gh` CLI.

> Não existe CI/CD configurado. Todos os passos abaixo são executados na sua máquina.

---

## Pré-requisitos

- [`pnpm`](https://pnpm.io/) instalado
- [`gh` CLI](https://cli.github.com/) instalado e autenticado (`gh auth login`)
- Rust toolchain instalado (`rustup`)
- Dependências nativas do Tauri para Linux:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

---

## Fluxo de Release

### 1. Atualizar a versão

Edite os **três arquivos** com a nova versão (devem estar sempre em sincronia):

| Arquivo | Campo |
|---|---|
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` em `[package]` |
| `package.json` | `"version"` |

### 2. Fazer o build

```bash
pnpm tauri build
```

Isso executa, em ordem:
1. `tsc && vite build` — compila o frontend
2. `cargo build --release` — compila o backend Rust
3. Empacotamento — gera os instaladores em `src-tauri/target/release/bundle/`:

| Formato | Caminho |
|---|---|
| `.deb` | `bundle/deb/ssh-orchestrator_X.Y.Z_amd64.deb` |
| `.rpm` | `bundle/rpm/ssh-orchestrator-X.Y.Z-1.x86_64.rpm` |
| `.AppImage` | `bundle/appimage/ssh-orchestrator_X.Y.Z_amd64.AppImage` |

> **Nota:** O `.AppImage` requer o `linuxdeploy` instalado. Se falhar, os `.deb` e `.rpm` ainda são gerados normalmente. Para instalar: baixe o binário em https://github.com/linuxdeploy/linuxdeploy/releases e coloque em `$PATH`.

O build completo leva entre 5 e 15 minutos (compilação Rust do zero) ou 1-2 minutos se o cache do `target/` já existir.

### 3. Commit e tag

```bash
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock package.json
git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

### 4. Criar a GitHub Release e fazer upload dos artefatos

```bash
gh release create vX.Y.Z \
  --title "vX.Y.Z" \
  --notes "Release vX.Y.Z" \
  "src-tauri/target/release/bundle/deb/ssh-orchestrator_X.Y.Z_amd64.deb" \
  "src-tauri/target/release/bundle/rpm/ssh-orchestrator-X.Y.Z-1.x86_64.rpm"
```

Os binários ficam hospedados na aba **Releases** do GitHub — fora do repositório git.

---

## Corrigir ou recriar uma tag

```bash
# Deletar a tag localmente e no remote
git tag -d vX.Y.Z
git push origin :vX.Y.Z

# Recriar apontando para o commit correto
git tag vX.Y.Z
git push origin vX.Y.Z
```

---

## Estratégia de versioning

Seguir [Semantic Versioning](https://semver.org/):

- `vX.Y.Z-alpha` — testes internos
- `vX.Y.Z-beta` — testes públicos
- `vX.Y.Z` — versão estável

---

## CI/CD (futuro)

Não há GitHub Actions configurado. Para automatizar o build multiplataforma (Windows, macOS, Linux) via push de tag, crie `.github/workflows/release.yml` usando a action oficial [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action). Ela cuida de todas as dependências nativas em cada runner.
