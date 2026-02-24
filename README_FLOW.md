# Fluxo e Arquitetura do Cliente SSH

Este documento detalha o funcionamento interno da aplicação, desde a criação do ambiente de trabalho (Workspaces) e configuração de servidores (Servers), até os fluxos de conexão SSH e gerenciamento criptográfico das senhas utilizando a Senha Master (Vault).

## 1. Workspaces
Os **Workspaces** atuam como agrupadores lógicos de servidores.
- **Criação e Edição**: Ao criar ou atualizar um Workspace, o usuário informa um nome (`name`) e uma cor de identificação (`color`).
- **Armazenamento**: É salvo no banco de dados SQLite local na tabela `workspaces`, com um UUID identificador gerado na criação (`id`) e registro de data/hora (`updated_at`).
- **Exclusão**: A exclusão de um Workspace aciona automaticamente a remoção de todos os servidores associados a ele no banco de dados.

## 2. Servidores
Os **Servidores** (Servers) armazenam os perfis de acesso SSH e estão atrelados a um único Workspace (`workspace_id`).

### Criação e Edição
- **Requisitos Formais**: Ao cadastrar um servidor, o usuário deve informar `name` (apelido), `host` (IP ou Domínio), `port`, e `username`.
- **Configuração de Senha**: O usuário introduz opcionalmente a senha de acesso e decide se ela deve ser salva marcando `save_password`.
- **Armazenamento Seguro de Credenciais**: A senha real **NUNCA** é salva em texto puro.
  - Se `save_password` for verdadeiro, a senha é criptografada em memória usando a **Senha Master** (veja a seção Vault) e apenas o arquivo encriptado (`password_enc`) é persistido na tabela `servers`.
  - Na edição do servidor, se a flag `save_password` for desmarcada, o valor da coluna `password_enc` é limpo (`NULL`).

## 3. Fluxo de Conexão e Desconexão (SSH)

### Estabelecimento da Conexão (`ssh_connect`)
1. O backend recebe o ID do servidor desejado (`server_id`) e, opcionalmente, uma senha em texto puro digitada pelo usuário no momento da inicialização.
2. O sistema consulta as informações de rede do servidor no banco de dados.
3. **Resolução Dinâmica da Senha**:
   - Caso o usuário forneça a senha explicitamente naquela interação, o sistema a utiliza de imediato e ignora o arquivo salvo.
   - Caso contrário, o sistema consulta a coluna criptografada `password_enc` no banco.
   - O cipher recuperado da base é passado para a Engine de Criptografia do estado (`state.crypto`), que o descriptografa de volta para texto puro utilizando as chaves residentes na RAM.
4. **Alocação de Sessão**: É feita uma conexão persistente e uma ID de sessão SSH é iniciada.

### Encerramento e Comunicação
- **Comunicação (`ssh_write`)**: A infraestrutura repassa as saídas padrão do cliente para um pseudoterminal e vice-versa, enviando as strings em cima daquela sessão específica.
- **Desconexão (`ssh_disconnect`)**: O usuário pode interromper manualmente. O sistema repassa o encerramento do canal e desaloca os recursos dessa sessão.

## 4. Segurança e Cofre (Vault / Senha Master)

A segurança baseia-se em um modelo *Zero Knowledge* local.

### Funcionamento da Senha Master
- **Definição / Desbloqueio**: Durante a inicialização (`setup_vault`) ou destrancamento do app (`unlock_vault`), o usuário entrega a **Senha Master** em texto puro.
- **Não-Persistência**: Essa Senha Master **NUNCA** é escrita em disco. Em vez disso, ela é usada para instanciar/derivar as chaves da criptografia que ficarão contidas apenas e expressamente na memória viva (RAM) do Rust, no objeto `state.crypto`.

### Leitura e Recuperação Segura
- Quando a aplicação precisa ler os acessos automáticos no terminal (`get_server_password`), o banco de dados fornece apenas o dado aleatorizado (`password_enc`).
- Somente com o **Vault Destrancado** (com as chaves na memória pelo imput prévio do usuário), a decodificação ocorre de forma bem sucedida.
- O dado em texto simples viaja decodificado **apenas e brevemente em tempo de execução**, preenchendo o prompt de rede sem nunca transitar exposto nos logs persistentes.
