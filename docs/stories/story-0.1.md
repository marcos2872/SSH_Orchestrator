# Story 0.1: Implementação do MVP Local

## Descrição
Como desenvolvedor, quero poder gerenciar meus workspaces e servidores localmente com segurança inicial, para que eu possa organizar minhas conexões SSH antes de sincronizá-las.

## Critérios de Aceitação
- [ ] Estrutura de pastas organizada para Frontend e Backend.
- [ ] Banco de dados SQLite inicializado com suporte a criptografia (Ring).
- [ ] Interface React permitindo criar, listar, editar e excluir Workspaces.
- [ ] Interface React permitindo adicionar servidores a Workspaces.
- [ ] Terminal básico integrado capaz de simular uma conexão SSH.

## Lista de Arquivos
- [ ] src-tauri/Cargo.toml
- [ ] src-tauri/src/main.rs
- [ ] src-tauri/src/models/mod.rs
- [ ] src-tauri/src/services/db.rs
- [ ] package.json
- [ ] src/App.tsx
- [ ] src/components/Sidebar.tsx
- [ ] src/components/Terminal.tsx
