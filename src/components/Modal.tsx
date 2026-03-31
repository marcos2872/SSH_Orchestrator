import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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

    return createPortal(
        <div
            ref={overlayRef}
            onClick={handleOverlayClick}
            className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-2xl animate-in fade-in duration-200 p-4"
            style={{ top: 'var(--titlebar-height)' }}
        >
            <div
                className={`rounded-3xl ${width} max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200`}
                style={{
                    background: 'rgba(28, 28, 30, 0.88)',
                    backdropFilter: 'blur(40px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(40px) saturate(180%)',
                    border: '0.5px solid rgba(255, 255, 255, 0.12)',
                    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.7), inset 0 0 0 0.5px rgba(255, 255, 255, 0.06)',
                }}
            >
                {title && (
                    <div className="flex items-center justify-between px-8 pt-7 pb-5 shrink-0" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
                        <div className="flex items-center gap-3">
                            {icon && (
                                <div className="p-2 rounded-xl" style={{ background: 'rgba(10, 132, 255, 0.15)' }}>
                                    {icon}
                                </div>
                            )}
                            <h2 className="text-[17px] font-semibold text-white tracking-tight">
                                {title}
                            </h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="flex items-center justify-center w-7 h-7 rounded-full transition-colors"
                            style={{ background: 'rgba(255,255,255,0.08)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                        >
                            <X className="w-3.5 h-3.5 text-white/60" />
                        </button>
                    </div>
                )}
                <div className={`overflow-y-auto flex-1 min-h-0 px-8 pb-8 ${!title ? 'pt-8' : 'pt-6'}`}>
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default Modal;
