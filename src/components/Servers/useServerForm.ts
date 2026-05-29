import { useCallback, useRef, useState } from 'react';
import type {
    ConnectionTestStatus,
    FormErrors,
    Protocol,
    ServerFormState,
    SshAuthMethod,
} from './types';

const DEFAULT_SSH_PORT = 22;
const DEFAULT_RDP_PORT = 3389;

interface UseServerFormOptions {
    initialProtocol?: Protocol;
    initialName?: string;
    initialHost?: string;
    initialPort?: number;
    initialUsername?: string;
    initialAuthMethod?: 'password' | 'ssh_key';
    hasSavedPassword?: boolean;
    hasSavedSshKey?: boolean;
    hasSavedSshKeyPassphrase?: boolean;
}

export function useServerForm(options: UseServerFormOptions = {}) {
    const {
        initialProtocol = 'ssh',
        initialName = '',
        initialHost = '',
        initialPort,
        initialUsername = '',
        initialAuthMethod = 'password',
        hasSavedPassword = false,
        hasSavedSshKey = false,
        hasSavedSshKeyPassphrase = false,
    } = options;

    const resolvedInitialPort = initialPort ?? (initialProtocol === 'rdp' ? DEFAULT_RDP_PORT : DEFAULT_SSH_PORT);

    const [state, setState] = useState<ServerFormState>({
        protocol: initialProtocol,
        name: initialName,
        host: initialHost,
        port: resolvedInitialPort,
        username: initialUsername,
        sshAuthMethod: initialAuthMethod === 'ssh_key' ? 'key' : 'password',
        password: '',
        saveCredential: hasSavedPassword,
        sshKey: '',
        saveSshKey: hasSavedSshKey,
        sshKeyPassphrase: '',
        saveSshKeyPassphrase: hasSavedSshKeyPassphrase,
        portManuallyEdited: !!initialPort,
        isChangingPassword: false,
        isChangingSshKey: false,
    });

    const [errors, setErrors] = useState<FormErrors>({});
    const [testStatus, setTestStatus] = useState<ConnectionTestStatus>('idle');
    const [testError, setTestError] = useState('');

    // Armazena dados por protocolo para preservar ao alternar
    const protocolDataRef = useRef<Record<Protocol, Partial<ServerFormState>>>({
        ssh: {},
        rdp: {},
    });

    const updateField = useCallback(<K extends keyof ServerFormState>(
        field: K,
        value: ServerFormState[K],
    ) => {
        setState(prev => {
            const next = { ...prev, [field]: value };
            // Limpa erro do campo ao editar
            if (field in (errors || {})) {
                setErrors(e => ({ ...e, [field]: undefined }));
            }
            return next;
        });
    }, [errors]);

    const setProtocol = useCallback((protocol: Protocol) => {
        setState(prev => {
            // Salva dados do protocolo atual
            protocolDataRef.current[prev.protocol] = {
                password: prev.password,
                username: prev.username,
                sshKey: prev.sshKey,
                sshKeyPassphrase: prev.sshKeyPassphrase,
                sshAuthMethod: prev.sshAuthMethod,
                saveCredential: prev.saveCredential,
                saveSshKey: prev.saveSshKey,
                saveSshKeyPassphrase: prev.saveSshKeyPassphrase,
            };

            // Recupera dados do novo protocolo
            const saved = protocolDataRef.current[protocol];
            const defaultPort = protocol === 'rdp' ? DEFAULT_RDP_PORT : DEFAULT_SSH_PORT;

            return {
                ...prev,
                protocol,
                port: prev.portManuallyEdited ? prev.port : defaultPort,
                // Restaura dados salvos do protocolo alvo
                password: saved.password ?? prev.password,
                username: saved.username ?? prev.username,
                sshKey: saved.sshKey ?? prev.sshKey,
                sshKeyPassphrase: saved.sshKeyPassphrase ?? prev.sshKeyPassphrase,
                sshAuthMethod: saved.sshAuthMethod ?? prev.sshAuthMethod,
                saveCredential: saved.saveCredential ?? prev.saveCredential,
                saveSshKey: saved.saveSshKey ?? prev.saveSshKey,
                saveSshKeyPassphrase: saved.saveSshKeyPassphrase ?? prev.saveSshKeyPassphrase,
            };
        });
        setErrors({});
        setTestStatus('idle');
    }, []);

    const setPort = useCallback((port: number) => {
        setState(prev => ({ ...prev, port, portManuallyEdited: true }));
        setErrors(e => ({ ...e, port: undefined }));
    }, []);

    const setSshAuthMethod = useCallback((method: SshAuthMethod) => {
        setState(prev => ({ ...prev, sshAuthMethod: method }));
        setErrors(e => ({ ...e, password: undefined, sshKey: undefined }));
    }, []);

    const validate = useCallback((rdpEnabled = true): boolean => {
        const newErrors: FormErrors = {};
        const { name, host, port, username, protocol, sshAuthMethod, password, sshKey } = state;

        // Se RDP está desabilitado, não validar campos (só salvar a preferência)
        if (protocol === 'rdp' && !rdpEnabled) {
            setErrors({});
            return true;
        }

        if (!name.trim()) newErrors.name = 'Informe o nome do servidor';
        if (!host.trim()) newErrors.host = 'Informe um host válido';
        if (!port || port < 1 || port > 65535) newErrors.port = 'A porta deve estar entre 1 e 65535';
        if (!username.trim()) newErrors.username = 'Informe o usuário';

        if (protocol === 'ssh' && sshAuthMethod === 'password') {
            // Senha obrigatória apenas se não há senha salva e não está em modo edição
            if (!password && !hasSavedPassword) {
                newErrors.password = 'Informe a senha';
            }
        }

        if (protocol === 'ssh' && sshAuthMethod === 'key') {
            if (!sshKey && !hasSavedSshKey) {
                newErrors.sshKey = 'Cole uma chave privada válida';
            }
        }

        if (protocol === 'rdp') {
            if (!password && !hasSavedPassword) {
                newErrors.password = 'Informe a senha';
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }, [state, hasSavedPassword, hasSavedSshKey]);

    const isFormValid = useCallback((): boolean => {
        const { name, host, port, username } = state;
        return !!(name.trim() && host.trim() && port >= 1 && port <= 65535 && username.trim());
    }, [state]);

    return {
        state,
        errors,
        testStatus,
        testError,
        updateField,
        setProtocol,
        setPort,
        setSshAuthMethod,
        setTestStatus,
        setTestError,
        validate,
        isFormValid,
        setState,
        setErrors,
    };
}
