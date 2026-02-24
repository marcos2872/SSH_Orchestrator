import React from 'react';
import { Cloud, CloudOff, RefreshCw, CheckCircle2 } from 'lucide-react';

export type SyncState = 'idle' | 'syncing' | 'success' | 'error' | 'offline';

interface Props {
    state: SyncState;
    lastSyncTime?: Date;
    onManualSync?: () => void;
}

const SyncStatus: React.FC<Props> = ({ state, lastSyncTime, onManualSync }) => {

    const getIcon = () => {
        switch (state) {
            case 'syncing':
                return <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />;
            case 'success':
                return <CheckCircle2 className="w-4 h-4 text-green-400" />;
            case 'error':
            case 'offline':
                return <CloudOff className="w-4 h-4 text-red-400" />;
            case 'idle':
            default:
                return <Cloud className="w-4 h-4 text-slate-400" />;
        }
    };

    const getLabel = () => {
        switch (state) {
            case 'syncing': return 'Sincronizando...';
            case 'success': return 'Atualizado';
            case 'error': return 'Erro na sincronização';
            case 'offline': return 'Modo Offline';
            case 'idle':
            default: return 'Pronto para sincronizar';
        }
    };

    return (
        <button
            onClick={onManualSync}
            disabled={state === 'syncing'}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 transition-colors border border-slate-700 font-medium text-xs text-slate-300"
            title={lastSyncTime ? `Última sincronização: ${lastSyncTime.toLocaleTimeString()}` : 'Nunca sincronizado'}
        >
            {getIcon()}
            <span>{getLabel()}</span>
        </button>
    );
};

export default SyncStatus;
