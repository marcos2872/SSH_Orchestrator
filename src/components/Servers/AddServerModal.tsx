import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Eye, EyeOff, Server, Lock } from 'lucide-react';
import { useToast } from '../../hooks/useToast';

interface Server {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    has_saved_password: boolean;
}

interface Props {
    workspaceId: string;
    /** If provided, the modal opens in edit mode */
    server?: Server | null;
    onClose: () => void;
    onSaved: () => void;
}

const DEFAULTS = { name: '', host: '', port: 22, username: '', password: '', savePassword: false };

const AddServerModal: React.FC<Props> = ({ workspaceId, server, onClose, onSaved }) => {
    const toast = useToast();
    const [name, setName] = useState(server?.name ?? DEFAULTS.name);
    const [host, setHost] = useState(server?.host ?? DEFAULTS.host);
    const [port, setPort] = useState<number>(server?.port ?? DEFAULTS.port);
    const [username, setUsername] = useState(server?.username ?? DEFAULTS.username);
    const [password, setPassword] = useState('');
    const [savePassword, setSavePassword] = useState(server?.has_saved_password ?? DEFAULTS.savePassword);
    const [showPassword, setShowPassword] = useState(false);
    const [saving, setSaving] = useState(false);

    const firstRef = useRef<HTMLInputElement>(null);
    const isEdit = !!server;

    useEffect(() => {
        setTimeout(() => firstRef.current?.focus(), 50);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !host.trim() || !username.trim()) return;

        setSaving(true);
        try {
            if (isEdit) {
                await invoke('update_server', {
                    id: server!.id,
                    name: name.trim(),
                    host: host.trim(),
                    port,
                    username: username.trim(),
                    password: password || null,
                    savePassword,
                });
                toast.success('Servidor atualizado!');
            } else {
                await invoke('create_server', {
                    workspaceId,
                    name: name.trim(),
                    host: host.trim(),
                    port,
                    username: username.trim(),
                    password: password || null,
                    savePassword,
                });
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 w-[460px] shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 rounded-lg">
                            <Server className="w-5 h-5 text-blue-400" />
                        </div>
                        <h2 className="text-lg font-semibold">
                            {isEdit ? 'Editar Servidor' : 'Novo Servidor'}
                        </h2>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

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

                    {/* Divider */}
                    <div className="border-t border-slate-800 pt-4">
                        <div className="flex items-center gap-2 mb-3">
                            <Lock className="w-4 h-4 text-slate-500" />
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                                Credenciais SSH
                            </span>
                        </div>

                        {/* Password field */}
                        <Field label={isEdit && server?.has_saved_password ? 'Nova senha (deixe em branco para manter a atual)' : 'Senha'}>
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

                        {/* Save password toggle */}
                        <label className="flex items-start gap-3 mt-3 cursor-pointer group">
                            <div className="relative mt-0.5">
                                <input
                                    type="checkbox"
                                    checked={savePassword}
                                    onChange={e => setSavePassword(e.target.checked)}
                                    className="sr-only"
                                />
                                <div
                                    className={`w-10 h-5 rounded-full transition-colors ${savePassword ? 'bg-blue-600' : 'bg-slate-700'}`}
                                >
                                    <div
                                        className={`w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform ${savePassword ? 'translate-x-5' : 'translate-x-0.5'}`}
                                    />
                                </div>
                            </div>
                            <div>
                                <p className="text-sm font-medium group-hover:text-white transition-colors">
                                    Salvar senha encriptada
                                </p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    AES-256-GCM · Armazenada localmente · Nunca transmitida
                                </p>
                            </div>
                        </label>
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
            </div>
        </div>
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

export default AddServerModal;
