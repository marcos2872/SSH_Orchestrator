/** Protocolo de conexão suportado */
export type Protocol = 'ssh' | 'rdp';

/** Método de autenticação SSH */
export type SshAuthMethod = 'password' | 'key';

/** Estado de teste de conexão */
export type ConnectionTestStatus = 'idle' | 'testing' | 'success' | 'error';

/** Erros de validação do formulário, por campo */
export interface FormErrors {
    name?: string;
    host?: string;
    port?: string;
    username?: string;
    password?: string;
    sshKey?: string;
}

/** Estado completo do formulário de servidor */
export interface ServerFormState {
    protocol: Protocol;
    name: string;
    host: string;
    port: number;
    username: string;
    sshAuthMethod: SshAuthMethod;
    password: string;
    saveCredential: boolean;
    sshKey: string;
    saveSshKey: boolean;
    sshKeyPassphrase: string;
    saveSshKeyPassphrase: boolean;
    /** Se a senha foi editada manualmente pelo usuário */
    portManuallyEdited: boolean;
    /** Se o usuário está no fluxo de alterar senha existente */
    isChangingPassword: boolean;
    /** Se o usuário está no fluxo de alterar chave existente */
    isChangingSshKey: boolean;
}

/** Dados de credencial existente no servidor */
export interface SavedCredentials {
    hasPassword: boolean;
    hasSshKey: boolean;
    hasSshKeyPassphrase: boolean;
}

/** Props do modal principal */
export interface EditServerModalProps {
    workspaceId: string;
    server?: {
        id: string;
        name: string;
        host: string;
        port: number;
        username: string;
        has_saved_password: boolean;
        has_saved_ssh_key: boolean;
        has_saved_ssh_key_passphrase: boolean;
        auth_method: 'password' | 'ssh_key';
    } | null;
    onClose: () => void;
    onSaved: () => void;
}
