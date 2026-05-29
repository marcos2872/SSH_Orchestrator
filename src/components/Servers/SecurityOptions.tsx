import React from 'react';
import { Shield } from 'lucide-react';

interface Props {
    saveCredential: boolean;
    saveSshKey: boolean;
    saveSshKeyPassphrase: boolean;
    showSshKeyOption: boolean;
    showPassphraseOption: boolean;
    onSaveCredentialChange: (value: boolean) => void;
    onSaveSshKeyChange: (value: boolean) => void;
    onSaveSshKeyPassphraseChange: (value: boolean) => void;
}

const SecurityOptions: React.FC<Props> = ({
    saveCredential,
    saveSshKey,
    saveSshKeyPassphrase,
    showSshKeyOption,
    showPassphraseOption,
    onSaveCredentialChange,
    onSaveSshKeyChange,
    onSaveSshKeyPassphraseChange,
}) => {
    return (
        <div
            className="space-y-3 pt-4"
            style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)' }}
        >
            <div className="flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.5)' }} />
                <span className="text-[11px] font-medium" style={{ color: 'rgba(235,235,245,0.55)' }}>
                    Armazenamento
                </span>
            </div>

            {/* Toggle principal: salvar credencial (senha) */}
            <Toggle
                checked={saveCredential}
                onChange={onSaveCredentialChange}
                label="Salvar credencial neste dispositivo"
                description="Recomendado apenas em dispositivos confiáveis"
            />

            {/* Toggle: salvar chave SSH */}
            {showSshKeyOption && (
                <Toggle
                    checked={saveSshKey}
                    onChange={onSaveSshKeyChange}
                    label="Salvar chave privada neste dispositivo"
                    description="Criptografada com AES-256-GCM"
                />
            )}

            {/* Toggle: salvar passphrase da chave */}
            {showPassphraseOption && (
                <Toggle
                    checked={saveSshKeyPassphrase}
                    onChange={onSaveSshKeyPassphraseChange}
                    label="Salvar passphrase da chave"
                    description="Armazenada junto com a chave"
                />
            )}
        </div>
    );
};

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
                className="w-9 h-[20px] rounded-full transition-colors"
                style={{ background: checked ? '#0a84ff' : 'rgba(255,255,255,0.12)' }}
            >
                <div
                    className="w-[16px] h-[16px] bg-white rounded-full shadow-md absolute top-0.5 transition-transform"
                    style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
                />
            </div>
        </div>
        <div>
            <p className="text-[12px] font-medium text-white/70 group-hover:text-white/90 transition-colors">
                {label}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: 'rgba(235,235,245,0.5)' }}>
                {description}
            </p>
        </div>
    </label>
);

export default SecurityOptions;
