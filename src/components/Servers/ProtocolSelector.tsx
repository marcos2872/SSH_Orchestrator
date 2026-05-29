import React from 'react';
import { Monitor, Terminal } from 'lucide-react';
import type { Protocol } from './types';

interface Props {
    value: Protocol;
    onChange: (protocol: Protocol) => void;
}

const ProtocolSelector: React.FC<Props> = ({ value, onChange }) => {
    return (
        <div className="space-y-2">
            <label
                className="block text-[11px] font-medium uppercase tracking-wide"
                style={{ color: 'rgba(235,235,245,0.55)' }}
            >
                Tipo de acesso
            </label>
            <div
                className="flex rounded-xl overflow-hidden p-0.5"
                style={{ background: 'rgba(255,255,255,0.06)' }}
                role="tablist"
                aria-label="Protocolo de conexão"
            >
                <ProtocolButton
                    active={value === 'ssh'}
                    onClick={() => onChange('ssh')}
                    icon={<Terminal className="w-3.5 h-3.5" />}
                    label="SSH"
                    description="Terminal remoto"
                />
                <ProtocolButton
                    active={value === 'rdp'}
                    onClick={() => onChange('rdp')}
                    icon={<Monitor className="w-3.5 h-3.5" />}
                    label="RDP"
                    description="Área de trabalho"
                />
            </div>
        </div>
    );
};

interface ProtocolButtonProps {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    description: string;
}

const ProtocolButton: React.FC<ProtocolButtonProps> = ({ active, onClick, icon, label, description }) => (
    <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onClick}
        className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold rounded-[10px] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        style={
            active
                ? { background: 'rgba(255,255,255,0.12)', color: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }
                : { color: 'rgba(235,235,245,0.45)' }
        }
    >
        {icon}
        <span className="flex flex-col items-start">
            <span>{label}</span>
            <span
                className="text-[9px] font-normal"
                style={{ color: active ? 'rgba(255,255,255,0.6)' : 'rgba(235,235,245,0.5)' }}
            >
                {description}
            </span>
        </span>
    </button>
);

export default ProtocolSelector;
