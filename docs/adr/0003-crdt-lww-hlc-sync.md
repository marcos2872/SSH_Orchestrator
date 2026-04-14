# 0003 — CRDT LWW-Register com HLC para Resolução de Conflitos

## Status

aceito

## Contexto

O app precisa sincronizar configurações de workspaces e servidores entre múltiplos dispositivos. Cenários problemáticos:

- Usuário edita o mesmo servidor em dois dispositivos sem conexão (offline-first)
- Pull e push acontecem em ordem arbitrária
- Dois dispositivos criam registros com o mesmo UUID (impossível por design, mas o merge precisa ser determinístico)
- Clocks de sistema podem estar dessincronizados entre máquinas

Alternativas consideradas:
- **Timestamp do sistema operacional (wall clock)**: não confiável — pode regredir com sincronização NTP ou fuso horário
- **Vetor de versões (Vector Clocks)**: robusto, mas complexo de implementar e armazenar em SQLite
- **OT (Operational Transformation)**: muito complexo, tipicamente usado em editores colaborativos de texto
- **Firestore/CRDTs de terceiros**: introduz dependência de serviço externo incompatível com o modelo offline-first

## Decisão

Implementamos **LWW-Register (Last-Writer-Wins Register)** com **HLC (Hybrid Logical Clock)** em Rust puro:

```
HLC = timestamp_ms (u64) : counter (u32) : node_id (String)
```

- `timestamp_ms`: Unix epoch em milissegundos (clock físico)
- `counter`: incrementado atomicamente se o timestamp não avançou (garante unicidade sub-ms)
- `node_id`: 8 chars do UUID do dispositivo (desempate quando timestamp + counter são iguais)

O `merge()` do LWWRegister é **comutativo, associativo e idempotente** — propriedades fundamentais de CRDTs.

## Consequências

- (+) Determinístico: mesmo resultado independente da ordem de merge
- (+) Simples de implementar e testar (cobertura completa de testes unitários em `crdt.rs`)
- (+) HLC é imune a regressões de clock físico — o counter garante monotonia
- (+) `node_id` persiste entre sessões em `node_id.txt` → identidade estável por dispositivo
- (+) Tombstones (`deleted = true`) propagam deleções sem precisar de tabela de exclusões separada
- (-) LWW perde granularidade: conflito em nível de campo (ex: só o `host` foi alterado) resulta em vitória completa do registro mais novo — a outra mudança é perdida
- (-) Requer que todos os campos de dados tenham HLC associado — não se aplica a campos derivados ou calculados
- (-) `node_id` de 8 chars tem chance mínima (mas não zero) de colisão entre dispositivos

Ver também: [0004 — GitHub como backend de sincronização](0004-github-sync-backend.md)
