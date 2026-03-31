import React, { useEffect, useRef, useState } from 'react';
import { createServer, updateServer, Server } from '../../lib/api/servers';
import { Eye, EyeOff, Key, Lock, Server as ServerIcon } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import Modal from '../Modal';

interface Props {
    workspaceId: string;
    /** If provided, the modal opens in edit mode */
    server?: Server | null;
    onClose: () => void;
    onSaved: () => void;
}

type AuthMethod = 'password' | 'ssh_key';

const DEFAULTS = {
    name: '',
    host: '',
    port: 22,
    username: '',
    password: '',
    savePassword: false,
    authMethod: 'password' as AuthMethod,
    sshKey: '',
    saveSshKey: false,
    sshKeyPassphrase: '',
    saveSshKeyPassphrase: false,
};

const AddServerModal: React.FC<Props> = ({ workspaceId, server, onClose, onSaved }) => {
    const toast = useToast();
    const isEdit = !!server;

    const [name, setName] = useState(server?.name ?? DEFAULTS.name);
    const [host, setHost] = useState(server?.host ?? DEFAULTS.host);
    const [port, setPort] = useState<number>(server?.port ?? DEFAULTS.port);
    const [username, setUsername] = useState(server?.username ?? DEFAULTS.username);

    const [authMethod, setAuthMethod] = useState<AuthMethod>(
        server?.auth_method === 'ssh_key' ? 'ssh_key' : 'password'
    );

    const [password, setPassword] = useState('');
    const [savePassword, setSavePassword] = useState(server?.has_saved_password ?? DEFAULTS.savePassword);
    const [showPassword, setShowPassword] = useState(false);

    const [sshKey, setSshKey] = useState('');
    const [saveSshKey, setSaveSshKey] = useState(server?.has_saved_ssh_key ?? DEFAULTS.saveSshKey);
    const [sshKeyPassphrase, setSshKeyPassphrase] = useState('');
    const [saveSshKeyPassphrase, setSaveSshKeyPassphrase] = useState(server?.has_saved_ssh_key_passphrase ?? false);
    const [showPassphrase, setShowPassphrase] = useState(false);

    const [saving, setSaving] = useState(false);

    const firstRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setTimeout(() => firstRef.current?.focus(), 50);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !host.trim() || !username.trim()) return;

        setSaving(true);
        try {
            const isKeyAuth = authMethod === 'ssh_key';

            if (isEdit) {
                await updateServer(
                    server!.id,
                    name.trim(),
                    host.trim(),
                    port,
                    username.trim(),
                    isKeyAuth ? null : (password || null),
                    isKeyAuth ? false : savePassword,
                    isKeyAuth ? (sshKey || null) : null,
                    isKeyAuth ? saveSshKey : false,
                    isKeyAuth ? (sshKeyPassphrase || null) : null,
                    isKeyAuth ? saveSshKeyPassphrase : false,
                    authMethod,
                );
                toast.success('Servidor atualizado!');
            } else {
                await createServer(
                    workspaceId,
                    name.trim(),
                    host.trim(),
                    port,
                    username.trim(),
                    isKeyAuth ? null : (password || null),
                    isKeyAuth ? false : savePassword,
                    isKeyAuth ? (sshKey || null) : null,
                    isKeyAuth ? saveSshKey : false,
                    isKeyAuth ? (sshKeyPassphrase || null) : null,
                    isKeyAuth ? saveSshKeyPassphrase : false,
                    authMethod,
                );
                toast.success('Servidor criado!');
            }
            onSaved();
        } catch (err) {
            toast.error(String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={isEdit ? 'Editar Servidor' : 'Novo Servidor'}
            icon={<ServerIcon className="w-5 h-5" style={{ color: "#0a84ff" }} />}
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Name */}
                <Field label="Nome *">
                    <input
                        ref={firstRef}
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Servidor de Produção"
                        required
                        className={inputCls}
                        onFocus={e => (e.currentTarget.style.border = '0.5px solid rgba(10,132,255,0.7)')}
                        onBlur={e => (e.currentTarget.style.border = '0.5px solid rgba(255,255,255,0.1)')}
                    />
                </Field>

                {/* Host + Port side by side */}
                <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                        <Field label="Host / IP *">
                            <input
                                value={host}
                                onChange={e => setHost(e.target.value)}
                                placeholder="192.168.1.1"
                                required
                                className={inputCls}
                                onFocus={e => (e.currentTarget.style.border = '0.5px solid rgba(10,132,255,0.7)')}
                                onBlur={e => (e.currentTarget.style.border = '0.5px solid rgba(255,255,255,0.1)')}
                            />
                        </Field>
                    </div>
                    <Field label="Porta *">
                        <input
                            type="number"
                            value={port}
                            onChange={e => setPort(Number(e.target.value))}
                            min={1}
                            max={65535}
                            required
                            className={inputCls}
                            onFocus={e => (e.currentTarget.style.border = '0.5px solid rgba(10,132,255,0.7)')}
                            onBlur={e => (e.currentTarget.style.border = '0.5px solid rgba(255,255,255,0.1)')}
                        />
                    </Field>
                </div>

                {/* Username */}
                <Field label="Usuário *">
                    <input
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        placeholder="root"
                        required
                        className={inputCls}
                        onFocus={e => (e.currentTarget.style.border = '0.5px solid rgba(10,132,255,0.7)')}
                        onBlur={e => (e.currentTarget.style.border = '0.5px solid rgba(255,255,255,0.1)')}
                    />
                </Field>

                {/* Credentials section */}
                <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)' }} className="pt-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Lock className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.35)" }} />
                        <span className="text-[11px] font-medium" style={{ color: "rgba(235,235,245,0.4)" }}>
                            Credenciais SSH
                        </span>
                    </div>

                    {/* Auth method toggle — Apple segmented control style */}
                    <div
                        className="flex rounded-xl overflow-hidden mb-4 p-0.5"
                        style={{ background: "rgba(255,255,255,0.06)" }}
                    >
                        <button
                            type="button"
                            onClick={() => setAuthMethod('password')}
                            className="flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-semibold rounded-[10px] transition-all"
                            style={
                                authMethod === 'password'
                                    ? { background: "rgba(255,255,255,0.12)", color: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }
                                    : { color: "rgba(235,235,245,0.45)" }
                            }
                        >
                            <Lock className="w-3 h-3" />
                            Senha
                        </button>
                        <button
                            type="button"
                            onClick={() => setAuthMethod('ssh_key')}
                            className="flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-semibold rounded-[10px] transition-all"
                            style={
                                authMethod === 'ssh_key'
                                    ? { background: "rgba(255,255,255,0.12)", color: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }
                                    : { color: "rgba(235,235,245,0.45)" }
                            }
                        >
                            <Key className="w-3 h-3" />
                            Chave SSH
                        </button>
                    </div>

                    {/* ── Password section ─────────────────────────────── */}
                    {authMethod === 'password' && (
                        <div className="space-y-3">
                            <Field
                                label={
                                    isEdit && server?.has_saved_password
                                        ? 'Nova senha (deixe em branco para manter a atual)'
                                        : 'Senha'
                                }
                            >
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        placeholder={
                                            isEdit && server?.has_saved_password
                                                ? '••••••••  (salva)'
                                                : '••••••••'
                                        }
                                        className={`${inputCls} pr-10`}
                                        autoComplete="new-password"
                                        onFocus={e => (e.currentTarget.style.border = '0.5px solid rgba(10,132,255,0.7)')}
                                        onBlur={e => (e.currentTarget.style.border = '0.5px solid rgba(255,255,255,0.1)')}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(v => !v)}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
                                        style={{ color: "rgba(255,255,255,0.35)" }}
                                        onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                                        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
                                        tabIndex={-1}
                                    >
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </Field>

                            <Toggle
                                checked={savePassword}
                                onChange={setSavePassword}
                                label="Salvar senha encriptada"
                                description="AES-256-GCM · Sincronizável entre dispositivos"
                            />
                        </div>
                    )}

                    {/* ── SSH Key section ──────────────────────────────── */}
                    {authMethod === 'ssh_key' && (
                        <div className="space-y-3">
                            <Field
                                label={
                                    isEdit && server?.has_saved_ssh_key
                                        ? 'Nova chave privada (deixe em branco para manter a atual)'
                                        : 'Chave privada (PEM)'
                                }
                            >
                                <textarea
                                    value={sshKey}
                                    onChange={e => setSshKey(e.target.value)}
                                    placeholder={
                                        isEdit && server?.has_saved_ssh_key
                                            ? '-----BEGIN ... (chave salva)-----'
                                            : '-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'
                                    }
                                    rows={4}
                                    className={`${inputCls} resize-none font-mono text-xs leading-relaxed`}
                                    autoComplete="off"
                                    spellCheck={false}
                                    onFocus={e => (e.currentTarget.style.border = '0.5px solid rgba(10,132,255,0.7)')}
                                    onBlur={e => (e.currentTarget.style.border = '0.5px solid rgba(255,255,255,0.1)')}
                                />
                            </Field>

                            <Toggle
                                checked={saveSshKey}
                                onChange={setSaveSshKey}
                                label="Salvar chave encriptada"
                                description="AES-256-GCM · Sincronizável entre dispositivos"
                            />

                            <Field label="Passphrase da chave (opcional)">
                                <div className="relative">
                                    <input
                                        type={showPassphrase ? 'text' : 'password'}
                                        value={sshKeyPassphrase}
                                        onChange={e => setSshKeyPassphrase(e.target.value)}
                                        placeholder={
                                            isEdit && server?.has_saved_ssh_key
                                                ? '(salva)'
                                                : 'Deixe em branco se a chave não tiver passphrase'
                                        }
                                        className={`${inputCls} pr-10`}
                                        autoComplete="new-password"
                                        onFocus={e => (e.currentTarget.style.border = '0.5px solid rgba(10,132,255,0.7)')}
                                        onBlur={e => (e.currentTarget.style.border = '0.5px solid rgba(255,255,255,0.1)')}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassphrase(v => !v)}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
                                        style={{ color: "rgba(255,255,255,0.35)" }}
                                        onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                                        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
                                        tabIndex={-1}
                                    >
                                        {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </Field>

                            {sshKeyPassphrase && (
                                <Toggle
                                    checked={saveSshKeyPassphrase}
                                    onChange={setSaveSshKeyPassphrase}
                                    label="Salvar passphrase encriptada"
                                    description="AES-256-GCM · Junto com a chave"
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors text-white/70"
                        style={{ background: "rgba(255,255,255,0.08)" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.14)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        disabled={saving || !name.trim() || !host.trim() || !username.trim()}
                        className="flex-1 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold rounded-xl transition-colors text-white"
                        style={{ background: "#0a84ff" }}
                        onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "#409cff"; }}
                        onMouseLeave={e => (e.currentTarget.style.background = "#0a84ff")}
                    >
                        {saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar servidor'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const inputCls =
    'w-full rounded-xl px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none transition-all';

// Applied as inline style (can't use className for dynamic border in Tailwind JIT)
const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.07)',
    border: '0.5px solid rgba(255,255,255,0.1)',
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <label
            className="block text-[11px] font-medium mb-1.5"
            style={{ color: 'rgba(235,235,245,0.4)' }}
        >
            {label}
        </label>
        {React.Children.map(children, child => {
            if (React.isValidElement(child)) {
                const el = child as React.ReactElement<any>;
                return React.cloneElement(el, {
                    style: { ...inputStyle, ...el.props.style },
                });
            }
            return child;
        })}
    </div>
);

interface ToggleProps {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    description: string;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label, description }) => (
    <label className="flex items-start gap-3 cursor-pointer group">
        <div className="relative mt-0.5 shrink-0">
            <input
                type="checkbox"
                checked={checked}
                onChange={e => onChange(e.target.checked)}
                className="sr-only"
            />
            <div
                className="w-10 h-[22px] rounded-full transition-colors"
                style={{ background: checked ? '#0a84ff' : 'rgba(255,255,255,0.15)' }}
            >
                <div
                    className="w-[18px] h-[18px] bg-white rounded-full shadow-md absolute top-0.5 transition-transform"
                    style={{ transform: checked ? 'translateX(20px)' : 'translateX(2px)' }}
                />
            </div>
        </div>
        <div>
            <p className="text-sm font-medium text-white/75 group-hover:text-white/95 transition-colors">{label}</p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(235,235,245,0.35)' }}>{description}</p>
        </div>
    </label>
);

export default AddServerModal;
