import React from 'react';
import { useToast } from '../hooks/useToast';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />,
    error: <XCircle className="w-5 h-5 text-red-400 shrink-0" />,
    info: <Info className="w-5 h-5 text-blue-400 shrink-0" />,
};

const styles = {
    success: 'bg-slate-900 border-green-500/40 text-green-100',
    error: 'bg-slate-900 border-red-500/40 text-red-100',
    info: 'bg-slate-900 border-blue-500/40 text-blue-100',
};

const ToastContainer: React.FC = () => {
    const { toasts, dismiss } = useToast();

    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
            {toasts.map(toast => (
                <div
                    key={toast.id}
                    className={`
                        flex items-start gap-3 px-4 py-3 rounded-xl border shadow-2xl
                        pointer-events-auto backdrop-blur-sm
                        animate-[slideIn_0.2s_ease-out]
                        ${styles[toast.type]}
                    `}
                >
                    {icons[toast.type]}
                    <p className="flex-1 text-sm leading-snug">{toast.message}</p>
                    <button
                        onClick={() => dismiss(toast.id)}
                        className="text-slate-500 hover:text-slate-300 transition-colors mt-0.5"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            ))}
        </div>
    );
};

export default ToastContainer;
