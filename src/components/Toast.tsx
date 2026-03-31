import React from 'react';
import { useToast } from '../hooks/useToast';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

const icons = {
    success: <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: '#32d74b' }} />,
    error: <XCircle className="w-4 h-4 shrink-0" style={{ color: '#ff453a' }} />,
    info: <Info className="w-4 h-4 shrink-0" style={{ color: '#0a84ff' }} />,
};

const accentColor = {
    success: 'rgba(50,215,75,0.35)',
    error: 'rgba(255,69,58,0.35)',
    info: 'rgba(10,132,255,0.35)',
};

const ToastContainer: React.FC = () => {
    const { toasts, dismiss } = useToast();

    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
            {toasts.map(toast => (
                <div
                    key={toast.id}
                    className="flex items-start gap-3 px-4 py-3 pointer-events-auto animate-[slideIn_0.2s_ease-out]"
                    style={{
                        background: 'rgba(44,44,46,0.92)',
                        backdropFilter: 'blur(40px) saturate(180%)',
                        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
                        border: `0.5px solid ${accentColor[toast.type]}`,
                        borderRadius: '14px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.5), inset 0 0 0 0.5px rgba(255,255,255,0.06)',
                    }}
                >
                    {icons[toast.type]}
                    <p className="flex-1 text-sm leading-snug text-white/85">{toast.message}</p>
                    <button
                        onClick={() => dismiss(toast.id)}
                        className="transition-colors mt-0.5"
                        style={{ color: 'rgba(255,255,255,0.3)' }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            ))}
        </div>
    );
};

export default ToastContainer;
