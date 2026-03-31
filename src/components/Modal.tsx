import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    width?: string;
    icon?: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, width = 'w-[460px]', icon }) => {
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === overlayRef.current) {
            onClose();
        }
    };

    return (
        <div
            ref={overlayRef}
            onClick={handleOverlayClick}
            className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 p-4"
            style={{ top: 'var(--titlebar-height)' }}
        >
            <div className={`bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl ${width} max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200`}>
                {title && (
                    <div className="flex items-center justify-between px-8 pt-8 pb-6 shrink-0">
                        <div className="flex items-center gap-3">
                            {icon && (
                                <div className="p-2 bg-blue-500/10 rounded-lg">
                                    {icon}
                                </div>
                            )}
                            <h2 className="text-lg font-semibold text-white">
                                {title}
                            </h2>
                        </div>
                        <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                )}
                <div className={`overflow-y-auto flex-1 min-h-0 px-8 pb-8 ${!title ? 'pt-8' : ''}`}>
                    {children}
                </div>
            </div>
        </div>
    );
};

export default Modal;
