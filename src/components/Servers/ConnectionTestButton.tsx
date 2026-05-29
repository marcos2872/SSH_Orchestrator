import React from 'react';
import { CheckCircle, Loader2, Plug, XCircle } from 'lucide-react';
import type { ConnectionTestStatus } from './types';

interface Props {
    status: ConnectionTestStatus;
    errorMessage?: string;
    onTest: () => void;
    disabled?: boolean;
}

const ConnectionTestButton: React.FC<Props> = ({ status, errorMessage, onTest, disabled }) => {
    const getButtonContent = () => {
        switch (status) {
            case 'testing':
                return (
                    <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Testando...
                    </>
                );
            case 'success':
                return (
                    <>
                        <CheckCircle className="w-3.5 h-3.5" style={{ color: 'rgba(48, 209, 88, 0.9)' }} />
                        Conexão bem-sucedida
                    </>
                );
            case 'error':
                return (
                    <>
                        <XCircle className="w-3.5 h-3.5" style={{ color: 'rgba(255, 69, 58, 0.9)' }} />
                        Falha na conexão
                    </>
                );
            default:
                return (
                    <>
                        <Plug className="w-3.5 h-3.5" />
                        Testar conexão
                    </>
                );
        }
    };

    const getButtonStyle = (): React.CSSProperties => {
        switch (status) {
            case 'success':
                return { background: 'rgba(48, 209, 88, 0.08)', border: '0.5px solid rgba(48, 209, 88, 0.2)', color: 'rgba(48, 209, 88, 0.9)' };
            case 'error':
                return { background: 'rgba(255, 69, 58, 0.08)', border: '0.5px solid rgba(255, 69, 58, 0.2)', color: 'rgba(255, 69, 58, 0.9)' };
            case 'testing':
                return { background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', color: 'rgba(235,235,245,0.5)' };
            default:
                return { background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', color: 'rgba(235,235,245,0.6)' };
        }
    };

    return (
        <div className="space-y-1.5">
            <button
                type="button"
                onClick={onTest}
                disabled={disabled || status === 'testing'}
                className="flex items-center justify-center gap-2 w-full py-2 text-xs font-medium rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                style={getButtonStyle()}
            >
                {getButtonContent()}
            </button>
            {status === 'error' && errorMessage && (
                <p className="text-[10px] text-center" style={{ color: 'rgba(255, 69, 58, 0.8)' }}>
                    {errorMessage}
                </p>
            )}
        </div>
    );
};

export default ConnectionTestButton;
