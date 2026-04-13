---
name: criar-release
description: Cria uma release local e publica no GitHub para o SSH Orchestrator (Tauri v2). Atualiza versão nos três arquivos, faz build, commit, tag e upload dos artefatos .deb e .rpm via gh CLI.
license: MIT
compatibility: opencode
metadata:
  audience: maintainers
  workflow: github-release
---

# Skill: Criar Release — SSH Orchestrator

## O que esta skill faz

Guia o processo completo de release do SSH Orchestrator (Tauri v2):

1. Atualizar a versão nos três arquivos obrigatórios
2. Fazer o build de produção (`pnpm tauri build`)
3. Commitar, criar a tag e fazer push
4. Criar a GitHub Release e fazer upload dos artefatos `.deb` e `.rpm`

---

## Quando usar

Use esta skill quando o usuário pedir para criar uma release, subir uma versão, publicar uma nova versão ou similar.

---

## Pré-requisitos

Verificar antes de começar:

```bash
gh auth status          # gh CLI autenticado
pnpm --version          # pnpm instalado
rustup show             # Rust toolchain presente
```

Se algum falhar, informar o usuário antes de prosseguir.

---

## Passo 1 — Determinar a nova versão

Verificar a versão atual e a última tag:

```bash
cat package.json | grep '"version"'
git tag --sort=-version:refname | head -5
```

Perguntar ao usuário qual será a nova versão se não tiver sido informada. Seguir Semantic Versioning:
- `patch` (X.Y.Z+1): bugfixes
- `minor` (X.Y+1.0): novas features retrocompatíveis
- `major` (X+1.0.0): breaking changes

---

## Passo 2 — Atualizar versão nos três arquivos

Os três arquivos **devem estar sempre em sincronia**:

| Arquivo | Campo |
|---|---|
| `package.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` em `[package]` |
| `src-tauri/tauri.conf.json` | `"version"` |

Usar a ferramenta Edit para substituir a versão antiga pela nova em cada arquivo.

Após editar o `Cargo.toml`, atualizar o lockfile:

```bash
cd src-tauri && cargo generate-lockfile
```

---

## Passo 3 — Build de produção

```bash
pnpm tauri build
```

Este comando executa em ordem:
1. `tsc && vite build` — compila o frontend
2. `cargo build --release` — compila o backend Rust
3. Empacotamento dos instaladores

**Artefatos gerados** em `src-tauri/target/release/bundle/`:

| Formato | Caminho |
|---|---|
| `.deb` | `bundle/deb/ssh-orchestrator_X.Y.Z_amd64.deb` |
| `.rpm` | `bundle/rpm/ssh-orchestrator-X.Y.Z-1.x86_64.rpm` |
| `.AppImage` | `bundle/appimage/ssh-orchestrator_X.Y.Z_amd64.AppImage` *(pode falhar sem linuxdeploy — ignorar)* |

O build leva 5–15 minutos do zero, ou 1–2 minutos com cache.

Se o build falhar apenas no `.AppImage` com `failed to run linuxdeploy`, isso é esperado e não impede a release — continuar normalmente.

Se o build falhar no frontend ou no Rust, corrigir os erros antes de prosseguir.

---

## Passo 4 — Commit, tag e push

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

Ou, se houver outras mudanças não commitadas além da versão, incluí-las no mesmo commit com uma mensagem descritiva.

---

## Passo 5 — Criar GitHub Release e fazer upload

```bash
gh release create vX.Y.Z \
  --title "vX.Y.Z" \
  --notes "## vX.Y.Z

### Novidades
- <descrever features novas>

### Correções
- <descrever bugfixes>" \
  "src-tauri/target/release/bundle/deb/ssh-orchestrator_X.Y.Z_amd64.deb" \
  "src-tauri/target/release/bundle/rpm/ssh-orchestrator-X.Y.Z-1.x86_64.rpm"
```

As release notes devem ser escritas em **português**, resumindo as mudanças desde a última tag.

Para ver o diff desde a última tag:
```bash
git log $(git describe --tags --abbrev=0 HEAD^)..HEAD --oneline
```

---

## Corrigir ou recriar uma tag

Se a tag foi criada errada:

```bash
git tag -d vX.Y.Z
git push origin :vX.Y.Z
git tag vX.Y.Z
git push origin vX.Y.Z
```

Para recriar a release no GitHub:
```bash
gh release delete vX.Y.Z --yes
# depois recriar com gh release create ...
```

---

## Resultado esperado

Ao final, o usuário deve ter:
- Versão atualizada nos três arquivos e commitada
- Tag `vX.Y.Z` no repositório local e no remote
- GitHub Release publicada com `.deb` e `.rpm` anexados
- URL da release retornada pelo `gh release create`
