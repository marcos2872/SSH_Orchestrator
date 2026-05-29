import React from 'react';
import { Key, Lock } from 'lucide-react';
import type { SshAuthMethod } from './types';

interface Props {
    value: SshAuthMethod;
    onChange: (method: SshAuthMethod) => void;
}

const AuthMethodSelector: React.FC<Props> = ({ value, onChange }) => {
    return (
        <div className="space-y-2">
            <label
                className="block text-[11px] font-medium"
                style={{ color: 'rgba(235,235,245,0.55)' }}
            >
                Método de autenticação
            </label>
            <div
                className="flex rounded-xl overflow-hidden p-0.5"
                style={{ background: 'rgba(255,255,255,0.06)' }}
                role="tablist"
                aria-label="Método de autenticação SSH"
            >
                <button
                    type="button"
                    role="tab"
                    aria-selected={value === 'password'}
                    onClick={() => onChange('password')}
                    className="flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-semibold rounded-[10px] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                    style={
                        value === 'password'
                            ? { background: 'rgba(255,255,255,0.12)', color: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }
                            : { color: 'rgba(235,235,245,0.45)' }
                    }
                >
                    <Lock className="w-3 h-3" />
                    Senha
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={value === 'key'}
                    onClick={() => onChange('key')}
                    className="flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-semibold rounded-[10px] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                    style={
                        value === 'key'
                            ? { background: 'rgba(255,255,255,0.12)', color: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }
                            : { color: 'rgba(235,235,245,0.45)' }
                    }
                >
                    <Key className="w-3 h-3" />
                    Chave privada
                </button>
            </div>
        </div>
    );
};

export default AuthMethodSelector;
