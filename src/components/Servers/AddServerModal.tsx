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

    // Auth method — if existing server has a key, default to ssh_key tab
    const [authMethod, setAuthMethod] = useState<AuthMethod>(
        server?.has_saved_ssh_key ? 'ssh_key' : 'password'
    );

    // Password fields
    const [password, setPassword] = useState('');
    const [savePassword, setSavePassword] = useState(server?.has_saved_password ?? DEFAULTS.savePassword);
    const [showPassword, setShowPassword] = useState(false);

    // SSH key fields
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
                    // Password fields — clear when switching to key auth
                    isKeyAuth ? null : (password || null),
                    isKeyAuth ? false : savePassword,
                    // SSH key fields — clear when switching to password auth
                    isKeyAuth ? (sshKey || null) : null,
                    isKeyAuth ? saveSshKey : false,
                    isKeyAuth ? (sshKeyPassphrase || null) : null,
                    isKeyAuth ? saveSshKeyPassphrase : false,
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
            icon={<ServerIcon className="w-5 h-5 text-blue-400" />}
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
                    />
                </Field>

                {/* Host + Port side by side */}
                <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                        <Field label="Host / IP *">
                            <input
                                value={host}
                                onChange={e => setHost(e.target.value)}
                                placeholder="192.168.1.1 ou my.server.com"
                                required
                                className={inputCls}
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
                    />
                </Field>

                {/* Credentials section */}
                <div className="border-t border-slate-800 pt-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Lock className="w-4 h-4 text-slate-500" />
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            Credenciais SSH
                        </span>
                    </div>

                    {/* Auth method toggle */}
                    <div className="flex rounded-lg overflow-hidden border border-slate-700 mb-4">
                        <button
                            type="button"
                            onClick={() => setAuthMethod('password')}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold transition-colors ${
                                authMethod === 'password'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            <Lock className="w-3.5 h-3.5" />
                            Senha
                        </button>
                        <button
                            type="button"
                            onClick={() => setAuthMethod('ssh_key')}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold transition-colors ${
                                authMethod === 'ssh_key'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            <Key className="w-3.5 h-3.5" />
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
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(v => !v)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
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
                                />
                            </Field>

                            <Toggle
                                checked={saveSshKey}
                                onChange={setSaveSshKey}
                                label="Salvar chave encriptada"
                                description="AES-256-GCM · Sincronizável entre dispositivos"
                            />

                            {/* Passphrase (optional) */}
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
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassphrase(v => !v)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
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
                        className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-lg transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        disabled={saving || !name.trim() || !host.trim() || !username.trim()}
                        className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold rounded-lg transition-colors"
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
    'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <label className="block text-xs text-slate-500 mb-1.5">{label}</label>
        {children}
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
            <div className={`w-10 h-5 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-700'}`}>
                <div
                    className={`w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform ${
                        checked ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                />
            </div>
        </div>
        <div>
            <p className="text-sm font-medium group-hover:text-white transition-colors">{label}</p>
            <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>
    </label>
);

export default AddServerModal;
