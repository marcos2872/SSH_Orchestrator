import React, { useEffect, useRef, useState } from 'react';
import { Monitor, Server as ServerIcon } from 'lucide-react';
import { createServer, updateServer } from '../../lib/api/servers';
import { sshConnect, sshDisconnect } from '../../lib/api/ssh';
import { useToast } from '../../hooks/useToast';
import Modal from '../Modal';
import ProtocolSelector from './ProtocolSelector';
import AuthMethodSelector from './AuthMethodSelector';
import CredentialFields from './CredentialFields';
import SecurityOptions from './SecurityOptions';
import ConnectionTestButton from './ConnectionTestButton';
import { useServerForm } from './useServerForm';
import { isRdpEnabled, setRdpEnabled } from './rdpPrefs';
import type { EditServerModalProps, Protocol } from './types';

const inputCls =
    'w-full rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 transition-all';

const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.07)',
    border: '0.5px solid rgba(255,255,255,0.1)',
};

const inputFocusStyle: React.CSSProperties = {
    ...inputStyle,
    border: '0.5px solid rgba(10,132,255,0.7)',
};

const EditServerModal: React.FC<EditServerModalProps> = ({ workspaceId, server, onClose, onSaved }) => {
    const toast = useToast();
    const isEdit = !!server;
    const firstRef = useRef<HTMLInputElement>(null);
    const [saving, setSaving] = useState(false);
    const [focused, setFocused] = useState<string | null>(null);
    const [rdpEnabledState, setRdpEnabledState] = useState(() =>
        server ? isRdpEnabled(server.id) : true
    );

    // Determinar protocolo inicial com base na porta existente
    const inferProtocol = (): Protocol => {
        if (!server) return 'ssh';
        if (server.port === 3389) return 'rdp';
        return 'ssh';
    };

    const {
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
    } = useServerForm({
        initialProtocol: inferProtocol(),
        initialName: server?.name,
        initialHost: server?.host,
        initialPort: server?.port,
        initialUsername: server?.username,
        initialAuthMethod: server?.auth_method,
        hasSavedPassword: server?.has_saved_password,
        hasSavedSshKey: server?.has_saved_ssh_key,
        hasSavedSshKeyPassphrase: server?.has_saved_ssh_key_passphrase,
    });

    useEffect(() => {
        setTimeout(() => firstRef.current?.focus(), 50);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validate(rdpEnabledState)) return;

        // Se RDP está desabilitado, apenas salvar a preferência e fechar
        if (state.protocol === 'rdp' && !rdpEnabledState) {
            if (server?.id) {
                setRdpEnabled(server.id, false);
            }
            toast.success('Preferência RDP salva!');
            onSaved();
            return;
        }

        setSaving(true);
        try {
            const isKeyAuth = state.protocol === 'ssh' && state.sshAuthMethod === 'key';
            const authMethod = isKeyAuth ? 'ssh_key' : 'password';

            if (isEdit) {
                await updateServer(
                    server!.id,
                    state.name.trim(),
                    state.host.trim(),
                    state.port,
                    state.username.trim(),
                    isKeyAuth ? null : (state.password || null),
                    isKeyAuth ? false : state.saveCredential,
                    isKeyAuth ? (state.sshKey || null) : null,
                    isKeyAuth ? state.saveSshKey : false,
                    isKeyAuth ? (state.sshKeyPassphrase || null) : null,
                    isKeyAuth ? state.saveSshKeyPassphrase : false,
                    authMethod,
                );
                toast.success('Servidor atualizado!');
            } else {
                await createServer(
                    workspaceId,
                    state.name.trim(),
                    state.host.trim(),
                    state.port,
                    state.username.trim(),
                    isKeyAuth ? null : (state.password || null),
                    isKeyAuth ? false : state.saveCredential,
                    isKeyAuth ? (state.sshKey || null) : null,
                    isKeyAuth ? state.saveSshKey : false,
                    isKeyAuth ? (state.sshKeyPassphrase || null) : null,
                    isKeyAuth ? state.saveSshKeyPassphrase : false,
                    authMethod,
                );
                toast.success('Servidor criado!');
            }
            // Salvar preferência RDP no localStorage
            if (server?.id) {
                setRdpEnabled(server.id, rdpEnabledState);
            }
            onSaved();
        } catch (err) {
            toast.error(String(err));
        } finally {
            setSaving(false);
        }
    };

    const handleTestConnection = async () => {
        if (!validate(rdpEnabledState)) return;

        setTestStatus('testing');
        setTestError('');

        try {
            // Testa via SSH connect + disconnect imediato
            const isKeyAuth = state.protocol === 'ssh' && state.sshAuthMethod === 'key';
            const sid = await sshConnect(
                server?.id ?? '',
                isKeyAuth ? null : (state.password || null),
                undefined,
                80,
                24,
                isKeyAuth ? (state.sshKey || null) : null,
                isKeyAuth ? (state.sshKeyPassphrase || null) : null,
            );
            await sshDisconnect(sid);
            setTestStatus('success');
            // Reset após 4 segundos
            setTimeout(() => setTestStatus('idle'), 4000);
        } catch (err) {
            setTestStatus('error');
            setTestError(String(err));
            // Reset após 6 segundos
            setTimeout(() => setTestStatus('idle'), 6000);
        }
    };

    const showAuthMethodSelector = state.protocol === 'ssh';
    const showSshKeySecurityOption = state.protocol === 'ssh' && state.sshAuthMethod === 'key';
    const showPassphraseSecurityOption = showSshKeySecurityOption && !!state.sshKeyPassphrase;

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={isEdit ? 'Editar servidor' : 'Novo servidor'}
            icon={<ServerIcon className="w-5 h-5" style={{ color: '#0a84ff' }} />}
            width="w-[500px]"
        >
            <form onSubmit={handleSubmit} className="space-y-5">
                {/* ── Seção 1: Tipo de acesso ──────────────────────── */}
                <ProtocolSelector
                    value={state.protocol}
                    onChange={setProtocol}
                />

                {/* ── Toggle RDP (apenas na aba RDP, no topo) ──────── */}
                {state.protocol === 'rdp' && (
                    <div
                        className="rounded-xl px-4 py-3"
                        style={{
                            background: rdpEnabledState ? 'rgba(191,90,242,0.06)' : 'rgba(255,255,255,0.03)',
                            border: `0.5px solid ${rdpEnabledState ? 'rgba(191,90,242,0.2)' : 'rgba(255,255,255,0.08)'}`,
                        }}
                    >
                        <label className="flex items-center gap-3 cursor-pointer group">
                            <div className="relative shrink-0">
                                <input
                                    type="checkbox"
                                    checked={rdpEnabledState}
                                    onChange={e => setRdpEnabledState(e.target.checked)}
                                    className="sr-only"
                                />
                                <div
                                    className="w-9 h-[20px] rounded-full transition-colors"
                                    style={{ background: rdpEnabledState ? '#bf5af2' : 'rgba(255,255,255,0.12)' }}
                                >
                                    <div
                                        className="w-[16px] h-[16px] bg-white rounded-full shadow-md absolute top-0.5 transition-transform"
                                        style={{ transform: rdpEnabledState ? 'translateX(18px)' : 'translateX(2px)' }}
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Monitor className="w-3.5 h-3.5" style={{ color: rdpEnabledState ? '#bf5af2' : 'rgba(255,255,255,0.4)' }} />
                                <div>
                                    <p className="text-[12px] font-medium text-white/80 group-hover:text-white/95 transition-colors">
                                        Habilitar conexão RDP
                                    </p>
                                    <p className="text-[10px] mt-0.5" style={{ color: 'rgba(235,235,245,0.5)' }}>
                                        {rdpEnabledState
                                            ? 'Conexão RDP disponível para este servidor'
                                            : 'Conexão RDP desabilitada — o botão ficará inativo no card'}
                                    </p>
                                </div>
                            </div>
                        </label>
                    </div>
                )}

                {/* ── Campos do formulário (desabilitados se RDP off) ── */}
                <div
                    className={`space-y-5 transition-opacity ${state.protocol === 'rdp' && !rdpEnabledState ? 'opacity-30 pointer-events-none select-none' : ''}`}
                    aria-disabled={state.protocol === 'rdp' && !rdpEnabledState}
                >

                {/* ── Seção 2: Identificação ──────────────────────── */}
                <div className="space-y-1.5">
                    <label
                        className="block text-[11px] font-medium"
                        style={{ color: 'rgba(235,235,245,0.55)' }}
                    >
                        Nome do servidor
                    </label>
                    <input
                        ref={firstRef}
                        value={state.name}
                        onChange={e => updateField('name', e.target.value)}
                        placeholder="Ex: Produção Web, Dev Backend"
                        required
                        className={inputCls}
                        style={focused === 'name' ? inputFocusStyle : inputStyle}
                        onFocus={() => setFocused('name')}
                        onBlur={() => setFocused(null)}
                        aria-invalid={!!errors.name}
                        aria-describedby="name-help"
                    />
                    {errors.name ? (
                        <p className="text-[10px]" style={{ color: 'rgba(255, 69, 58, 0.9)' }}>{errors.name}</p>
                    ) : (
                        <p id="name-help" className="text-[10px]" style={{ color: 'rgba(235,235,245,0.5)' }}>
                            Como esse servidor aparecerá na lista
                        </p>
                    )}
                </div>

                {/* ── Seção 3: Endereço ────────────────────────────── */}
                <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 space-y-1.5">
                        <label
                            className="block text-[11px] font-medium"
                            style={{ color: 'rgba(235,235,245,0.55)' }}
                        >
                            Host ou IP
                        </label>
                        <input
                            value={state.host}
                            onChange={e => updateField('host', e.target.value)}
                            placeholder="192.168.1.1 ou dominio.com"
                            required
                            className={inputCls}
                            style={focused === 'host' ? inputFocusStyle : inputStyle}
                            onFocus={() => setFocused('host')}
                            onBlur={() => setFocused(null)}
                            aria-invalid={!!errors.host}
                        />
                        {errors.host && (
                            <p className="text-[10px]" style={{ color: 'rgba(255, 69, 58, 0.9)' }}>{errors.host}</p>
                        )}
                    </div>
                    <div className="space-y-1.5">
                        <label
                            className="block text-[11px] font-medium"
                            style={{ color: 'rgba(235,235,245,0.55)' }}
                        >
                            Porta
                        </label>
                        <input
                            type="number"
                            value={state.port}
                            onChange={e => setPort(Number(e.target.value))}
                            min={1}
                            max={65535}
                            required
                            className={inputCls}
                            style={focused === 'port' ? inputFocusStyle : inputStyle}
                            onFocus={() => setFocused('port')}
                            onBlur={() => setFocused(null)}
                            aria-invalid={!!errors.port}
                        />
                        {errors.port && (
                            <p className="text-[10px]" style={{ color: 'rgba(255, 69, 58, 0.9)' }}>{errors.port}</p>
                        )}
                    </div>
                </div>

                {/* ── Seção 4: Usuário ─────────────────────────────── */}
                <div className="space-y-1.5">
                    <label
                        className="block text-[11px] font-medium"
                        style={{ color: 'rgba(235,235,245,0.55)' }}
                    >
                        Usuário
                    </label>
                    <input
                        value={state.username}
                        onChange={e => updateField('username', e.target.value)}
                        placeholder={state.protocol === 'rdp' ? 'Administrator' : 'root'}
                        required
                        className={inputCls}
                        style={focused === 'username' ? inputFocusStyle : inputStyle}
                        onFocus={() => setFocused('username')}
                        onBlur={() => setFocused(null)}
                        aria-invalid={!!errors.username}
                    />
                    {errors.username && (
                        <p className="text-[10px]" style={{ color: 'rgba(255, 69, 58, 0.9)' }}>{errors.username}</p>
                    )}
                </div>

                {/* ── Seção 5: Auth method (apenas SSH) ────────────── */}
                {showAuthMethodSelector && (
                    <AuthMethodSelector
                        value={state.sshAuthMethod}
                        onChange={setSshAuthMethod}
                    />
                )}

                {/* ── Seção 6: Credenciais ─────────────────────────── */}
                <CredentialFields
                    protocol={state.protocol}
                    sshAuthMethod={state.sshAuthMethod}
                    password={state.password}
                    sshKey={state.sshKey}
                    sshKeyPassphrase={state.sshKeyPassphrase}
                    hasSavedPassword={server?.has_saved_password ?? false}
                    hasSavedSshKey={server?.has_saved_ssh_key ?? false}
                    isChangingPassword={state.isChangingPassword}
                    isChangingSshKey={state.isChangingSshKey}
                    errors={errors}
                    onPasswordChange={v => updateField('password', v)}
                    onSshKeyChange={v => updateField('sshKey', v)}
                    onSshKeyPassphraseChange={v => updateField('sshKeyPassphrase', v)}
                    onChangePasswordToggle={v => setState(prev => ({ ...prev, isChangingPassword: v }))}
                    onChangeSshKeyToggle={v => setState(prev => ({ ...prev, isChangingSshKey: v }))}
                />

                {/* ── Seção 8: Segurança / Armazenamento ──────────── */}
                <SecurityOptions
                    saveCredential={state.saveCredential}
                    saveSshKey={state.saveSshKey}
                    saveSshKeyPassphrase={state.saveSshKeyPassphrase}
                    showSshKeyOption={showSshKeySecurityOption}
                    showPassphraseOption={showPassphraseSecurityOption}
                    onSaveCredentialChange={v => updateField('saveCredential', v)}
                    onSaveSshKeyChange={v => updateField('saveSshKey', v)}
                    onSaveSshKeyPassphraseChange={v => updateField('saveSshKeyPassphrase', v)}
                />

                </div>{/* Fim do wrapper de campos desabilitáveis */}

                {/* ── Seção 9: Ações ───────────────────────────────── */}
                <div className="space-y-3 pt-2">
                    {/* Testar conexão */}
                    {state.protocol === 'ssh' && (
                        <ConnectionTestButton
                            status={testStatus}
                            errorMessage={testError}
                            onTest={handleTestConnection}
                            disabled={!isFormValid() || !isEdit}
                        />
                    )}

                    {/* Botões primários */}
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors text-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                            style={{ background: 'rgba(255,255,255,0.08)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={saving || !isFormValid()}
                            className="flex-1 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold rounded-xl transition-colors text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                            style={{ background: '#0a84ff' }}
                            onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = '#409cff'; }}
                            onMouseLeave={e => (e.currentTarget.style.background = '#0a84ff')}
                        >
                            {saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar servidor'}
                        </button>
                    </div>
                </div>
            </form>
        </Modal>
    );
};

export default EditServerModal;
