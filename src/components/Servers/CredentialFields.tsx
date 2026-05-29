import React, { useRef, useState } from 'react';
import { Eye, EyeOff, FileUp, ShieldCheck, X } from 'lucide-react';
import type { FormErrors, Protocol, SshAuthMethod } from './types';

interface Props {
    protocol: Protocol;
    sshAuthMethod: SshAuthMethod;
    password: string;
    sshKey: string;
    sshKeyPassphrase: string;
    hasSavedPassword: boolean;
    hasSavedSshKey: boolean;
    isChangingPassword: boolean;
    isChangingSshKey: boolean;
    errors: FormErrors;
    onPasswordChange: (value: string) => void;
    onSshKeyChange: (value: string) => void;
    onSshKeyPassphraseChange: (value: string) => void;
    onChangePasswordToggle: (changing: boolean) => void;
    onChangeSshKeyToggle: (changing: boolean) => void;
}

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

const CredentialFields: React.FC<Props> = ({
    protocol,
    sshAuthMethod,
    password,
    sshKey,
    sshKeyPassphrase,
    hasSavedPassword,
    hasSavedSshKey,
    isChangingPassword,
    isChangingSshKey,
    errors,
    onPasswordChange,
    onSshKeyChange,
    onSshKeyPassphraseChange,
    onChangePasswordToggle,
    onChangeSshKeyToggle,
}) => {
    const [showPassword, setShowPassword] = useState(false);
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [focused, setFocused] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const needsPassword = protocol === 'rdp' || (protocol === 'ssh' && sshAuthMethod === 'password');
    const needsSshKey = protocol === 'ssh' && sshAuthMethod === 'key';
    const sectionTitle = protocol === 'ssh' ? 'Credenciais SSH' : 'Credenciais RDP';

    const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const content = ev.target?.result;
            if (typeof content === 'string') {
                onSshKeyChange(content);
                onChangeSshKeyToggle(true);
            }
        };
        reader.readAsText(file);
        // Reset para permitir re-upload do mesmo arquivo
        e.target.value = '';
    };

    return (
        <div
            className="space-y-4 pt-4"
            style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)' }}
        >
            {/* Subtítulo dinâmico da seção */}
            <div className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.35)' }} />
                <span className="text-[11px] font-medium" style={{ color: 'rgba(235,235,245,0.55)' }}>
                    {sectionTitle}
                </span>
            </div>

            {/* ── Senha (SSH password ou RDP) ─────────────────────── */}
            {needsPassword && (
                <div className="space-y-2">
                    {hasSavedPassword && !isChangingPassword ? (
                        /* Estado: senha já salva */
                        <div
                            className="flex items-center justify-between rounded-xl px-4 py-3"
                            style={{ background: 'rgba(48, 209, 88, 0.08)', border: '0.5px solid rgba(48, 209, 88, 0.2)' }}
                        >
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4" style={{ color: 'rgba(48, 209, 88, 0.8)' }} />
                                <span className="text-sm text-white/80">Senha salva</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => onChangePasswordToggle(true)}
                                    className="text-xs font-medium px-2.5 py-1 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                                    style={{ color: '#0a84ff', background: 'rgba(10,132,255,0.1)' }}
                                >
                                    Alterar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onPasswordChange('');
                                        onChangePasswordToggle(true);
                                    }}
                                    className="text-xs font-medium px-2.5 py-1 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                                    style={{ color: 'rgba(255, 69, 58, 0.9)', background: 'rgba(255, 69, 58, 0.08)' }}
                                >
                                    Remover
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Campo de senha */
                        <div>
                            <label
                                className="block text-[11px] font-medium mb-1.5"
                                style={{ color: 'rgba(235,235,245,0.55)' }}
                            >
                                {hasSavedPassword ? 'Nova senha' : 'Senha'}
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={e => onPasswordChange(e.target.value)}
                                    className={`${inputCls} pr-10`}
                                    style={focused === 'password' ? inputFocusStyle : inputStyle}
                                    autoComplete="new-password"
                                    onFocus={() => setFocused('password')}
                                    onBlur={() => setFocused(null)}
                                    aria-invalid={!!errors.password}
                                    aria-describedby={errors.password ? 'password-error' : undefined}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(v => !v)}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                                    style={{ color: 'rgba(255,255,255,0.35)' }}
                                    tabIndex={-1}
                                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            {errors.password && (
                                <p id="password-error" className="text-[11px] mt-1" style={{ color: 'rgba(255, 69, 58, 0.9)' }}>
                                    {errors.password}
                                </p>
                            )}
                            {hasSavedPassword && isChangingPassword && (
                                <div className="flex items-center justify-between mt-1.5">
                                     <p className="text-[10px]" style={{ color: 'rgba(235,235,245,0.5)' }}>
                                        Deixe em branco para manter a senha atual
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onPasswordChange('');
                                            onChangePasswordToggle(false);
                                        }}
                                        className="text-[10px] font-medium transition-colors focus:outline-none"
                                        style={{ color: 'rgba(235,235,245,0.6)' }}
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Chave privada (SSH key) ──────────────────────────── */}
            {needsSshKey && (
                <div className="space-y-3">
                    {hasSavedSshKey && !isChangingSshKey ? (
                        /* Estado: chave já salva */
                        <div
                            className="flex items-center justify-between rounded-xl px-4 py-3"
                            style={{ background: 'rgba(48, 209, 88, 0.08)', border: '0.5px solid rgba(48, 209, 88, 0.2)' }}
                        >
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4" style={{ color: 'rgba(48, 209, 88, 0.8)' }} />
                                <span className="text-sm text-white/80">Chave privada salva</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => onChangeSshKeyToggle(true)}
                                    className="text-xs font-medium px-2.5 py-1 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                                    style={{ color: '#0a84ff', background: 'rgba(10,132,255,0.1)' }}
                                >
                                    Alterar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onSshKeyChange('');
                                        onChangeSshKeyToggle(true);
                                    }}
                                    className="text-xs font-medium px-2.5 py-1 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                                    style={{ color: 'rgba(255, 69, 58, 0.9)', background: 'rgba(255, 69, 58, 0.08)' }}
                                >
                                    Remover
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Área para colar/importar chave */
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label
                                    className="block text-[11px] font-medium"
                                    style={{ color: 'rgba(235,235,245,0.55)' }}
                                >
                                    {hasSavedSshKey ? 'Nova chave privada' : 'Chave privada'}
                                </label>
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                                    style={{ color: '#0a84ff', background: 'rgba(10,132,255,0.08)' }}
                                >
                                    <FileUp className="w-3 h-3" />
                                    Importar arquivo
                                </button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".pem,.key,.pub,*"
                                    onChange={handleFileImport}
                                    className="hidden"
                                    tabIndex={-1}
                                />
                            </div>
                            <textarea
                                value={sshKey}
                                onChange={e => onSshKeyChange(e.target.value)}
                                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                                rows={4}
                                className={`${inputCls} resize-none font-mono text-xs leading-relaxed`}
                                style={focused === 'sshKey' ? inputFocusStyle : inputStyle}
                                autoComplete="off"
                                spellCheck={false}
                                onFocus={() => setFocused('sshKey')}
                                onBlur={() => setFocused(null)}
                                aria-invalid={!!errors.sshKey}
                                aria-describedby={errors.sshKey ? 'sshkey-error' : undefined}
                            />
                            {errors.sshKey && (
                                <p id="sshkey-error" className="text-[11px] mt-1" style={{ color: 'rgba(255, 69, 58, 0.9)' }}>
                                    {errors.sshKey}
                                </p>
                            )}
                            <p className="text-[10px] mt-1.5" style={{ color: 'rgba(235,235,245,0.5)' }}>
                                Use a chave privada correspondente à chave pública autorizada no servidor
                            </p>
                            {hasSavedSshKey && isChangingSshKey && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onSshKeyChange('');
                                        onChangeSshKeyToggle(false);
                                    }}
                                    className="flex items-center gap-1 text-[10px] font-medium mt-1 transition-colors focus:outline-none"
                                    style={{ color: 'rgba(235,235,245,0.6)' }}
                                >
                                    <X className="w-3 h-3" />
                                    Cancelar alteração
                                </button>
                            )}
                        </div>
                    )}

                    {/* Passphrase da chave */}
                    <div>
                        <label
                            className="block text-[11px] font-medium mb-1.5"
                            style={{ color: 'rgba(235,235,245,0.55)' }}
                        >
                            Passphrase da chave
                            <span className="ml-1.5" style={{ color: 'rgba(235,235,245,0.45)' }}>(opcional)</span>
                        </label>
                        <div className="relative">
                            <input
                                type={showPassphrase ? 'text' : 'password'}
                                value={sshKeyPassphrase}
                                onChange={e => onSshKeyPassphraseChange(e.target.value)}
                                placeholder="Apenas se a chave for protegida por passphrase"
                                className={`${inputCls} pr-10 text-xs`}
                                style={focused === 'passphrase' ? inputFocusStyle : inputStyle}
                                autoComplete="new-password"
                                onFocus={() => setFocused('passphrase')}
                                onBlur={() => setFocused(null)}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassphrase(v => !v)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                                style={{ color: 'rgba(255,255,255,0.35)' }}
                                tabIndex={-1}
                                aria-label={showPassphrase ? 'Ocultar passphrase' : 'Mostrar passphrase'}
                            >
                                {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CredentialFields;
