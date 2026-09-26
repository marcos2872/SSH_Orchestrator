// Converte erros brutos (backend/Rust/rede) em mensagens amigáveis em PT-BR.

const RULES: Array<[RegExp, string]> = [
  [/connection refused/i, "Conexão recusada pelo servidor. Verifique host, porta e firewall."],
  [/timed out|timeout/i, "Tempo de conexão esgotado. Verifique host, porta e sua rede."],
  [/no route to host|network is unreachable/i, "Servidor inalcançável. Verifique sua conexão de rede."],
  [/could not resolve|failed to lookup|name or service not known|dns/i, "Não foi possível encontrar o host. Verifique o endereço."],
  [/permission denied|authentication failed|auth failed|unauthorized/i, "Falha de autenticação. Verifique usuário e credenciais."],
  [/incorrect|wrong password/i, "Senha incorreta. Verifique e tente novamente."],
  [/no such file|not found/i, "Arquivo ou pasta não encontrado."],
  [/permission|denied/i, "Sem permissão para esta operação."],
];

export function friendlyError(err: unknown): string {
  const raw = String(err ?? "").replace(/^Error:\s*/i, "").trim();
  if (!raw) return "Ocorreu um erro inesperado.";
  for (const [pattern, message] of RULES) {
    if (pattern.test(raw)) return message;
  }
  return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
}
