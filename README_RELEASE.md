# 🚀 Gerando Releases (Cross-Platform)

Este projeto utiliza **Tauri v2** e está configurado para gerar instaladores automáticos para **Windows, Linux e macOS** via GitHub Actions.

## 🎯 **Fluxo de Release Automático**

A maneira mais fácil de gerar os instaláveis é através de **Tags do Git**.

### **1. Criar uma nova versão**
Sempre que desejar lançar uma nova versão, crie uma tag seguindo o padrão semantic versioning (`v*.*.*`):

```bash
git tag v1.0.0
git push origin v1.0.0


git tag -d v0.1.0        # Deleta local
git push origin :v0.1.0  # Deleta no GitHub
git tag v0.1.0           # Cria de novo com o código novo
git push origin v0.1.0   # Envia a tag nova
```

### **2. Acompanhar o Build**
1. Vá para a aba **Actions** no seu repositório GitHub.
2. Você verá o workflow "🚀 Publish All Platforms" em execução.
3. O build leva entre 5 a 10 minutos para compilar para todas as plataformas simultaneamente.

### **3. Resultado**
Após a conclusão, um **Rascunho de Release (Draft)** será criado automaticamente na aba **Releases** do GitHub com os seguintes arquivos:
- **Windows**: `.exe` (NSIS Installer)
- **macOS**: `.dmg`
- **Linux**: `.AppImage` e `.deb`

---

## 🛠️ **Build Local (Apenas sua plataforma)**

Se você quiser testar o build localmente:

```bash
pnpm tauri build
```

Os arquivos gerados estarão em `src-tauri/target/release/bundle/`.

---

## 🎨 **Estratégia de Tags Recomendada**

- `v0.1.0-alpha`: Versão de testes internos.
- `v0.1.0-beta`: Versão para testes públicos.
- `v1.0.0`: Versão estável.

## 🚀 **Comando Rápido para Testar (GitHub CLI)**

Se você tiver a `gh` CLI instalada, pode disparar o build sem criar uma tag:

```bash
gh workflow run "Publish All Platforms"
```

---

> [!TIP]
> O workflow do GitHub Actions já lida com todas as dependências nativas (como `libwebkit2gtk`), então você não precisa configurar nada no seu computador para o build de outras plataformas.
