# 0004 — GitHub como Backend de Sincronização

## Status

aceito

## Contexto

O app precisa de um backend para sincronizar configurações entre dispositivos. Requisitos:
- Sem infraestrutura própria para manter
- Privado (dados de servidores não devem ser públicos)
- Gratuito para o usuário
- Suporte a versionamento e histórico de mudanças
- Autenticação robusta sem gerenciar usuários próprios

Alternativas consideradas:
- **Backend próprio (API REST + PostgreSQL)**: requer infraestrutura, custos operacionais, autenticação própria
- **Dropbox/Google Drive API**: dados em pasta compartilhada sem controle de acesso granular; sem histórico de versões
- **iCloud/OneDrive**: não cross-platform de forma confiável
- **S3 + DynamoDB**: custo, complexidade de configuração para o usuário
- **Nostr/IPFS**: muito experimentais para dados sensíveis

## Decisão

Usamos o **GitHub** como backend de sincronização via:
1. **OAuth 2.0** com escopos `repo` + `user:email` para autenticação do usuário
2. **Repositório privado** provisionado automaticamente como storage git
3. **git2** (binding Rust para libgit2) para clone, pull e push
4. **Formato JSON** por workspace em `sync_repo/workspaces/{id}.json`

O fluxo de push implementa um loop pull→merge→push (até 3 tentativas) para evitar force-push. Force-push é usado apenas como último recurso quando todas as tentativas fast-forward falham — e apenas após o estado local ter incorporado todos os dados remotos via merge LWW.

## Consequências

- (+) Zero custo de infraestrutura — repositório privado GitHub gratuito
- (+) Histórico de versões automático — cada sync é um commit auditável
- (+) Autenticação robusta sem gerenciar credenciais de usuário
- (+) git2 é maduro e amplamente testado
- (+) Dados nunca em texto claro no repo — apenas ciphertext AES-256-GCM
- (-) Dependência do GitHub — se o serviço ficar indisponível, sync falha
- (-) OAuth exige `GH_CLIENT_ID` e `GH_CLIENT_SECRET` no build (variáveis de ambiente)
- (-) Token GitHub armazenado em `github_token.enc` — necessita vault desbloqueado para sync
- (-) Rate limits da API GitHub podem afetar usuários com sync muito frequente
- (-) Force-push como fallback pode sobrescrever commits de outros dispositivos em casos extremos (mitigado pelo merge LWW antes do force-push)

Ver também: [0002 — AES-256-GCM com PBKDF2 para vault](0002-aes256gcm-pbkdf2-vault.md)
Ver também: [0003 — CRDT LWW-Register com HLC](0003-crdt-lww-hlc-sync.md)
