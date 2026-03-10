import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Lock,
  ShieldAlert,
  KeyRound,
  Cloud,
  Eye,
  EyeOff,
  ArrowLeft,
  AlertTriangle,
  CornerDownLeft,
  Clock,
  Minus,
  X,
} from "lucide-react";
import { useToast } from "../hooks/useToast";
import { useAuth } from "../hooks/useAuth";

const appWindow = getCurrentWindow();

interface VaultGuardProps {
  children: React.ReactNode;
}

type VaultFlowState =
  | "loading"
  | "welcome"
  | "setup"
  | "unlock"
  | "unlock_synced";

// --- Password Strength Helper ---
type StrengthLevel = "weak" | "fair" | "good" | "strong";

interface PasswordStrength {
  level: StrengthLevel;
  label: string;
  color: string;
  barColor: string;
  percent: number;
}

function evaluatePasswordStrength(password: string): PasswordStrength {
  if (password.length === 0) {
    return {
      level: "weak",
      label: "",
      color: "text-slate-500",
      barColor: "bg-slate-700",
      percent: 0,
    };
  }
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (password.length < 8) {
    return {
      level: "weak",
      label: "Muito curta",
      color: "text-red-400",
      barColor: "bg-red-500",
      percent: 15,
    };
  }
  if (score <= 2) {
    return {
      level: "weak",
      label: "Fraca",
      color: "text-red-400",
      barColor: "bg-red-500",
      percent: 25,
    };
  }
  if (score === 3) {
    return {
      level: "fair",
      label: "Razoável",
      color: "text-amber-400",
      barColor: "bg-amber-500",
      percent: 50,
    };
  }
  if (score === 4) {
    return {
      level: "good",
      label: "Boa",
      color: "text-blue-400",
      barColor: "bg-blue-500",
      percent: 75,
    };
  }
  return {
    level: "strong",
    label: "Forte",
    color: "text-green-400",
    barColor: "bg-green-500",
    percent: 100,
  };
}

// --- Relative time formatter ---
function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return "agora mesmo";
    if (diffMin < 60) return `há ${diffMin} min`;
    if (diffHour < 24) return `há ${diffHour}h`;
    if (diffDay === 1) return "ontem";
    if (diffDay < 7) return `há ${diffDay} dias`;

    return date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// --- Inline Password Input Component ---
interface PasswordInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  label: string;
  error?: string;
  shake?: boolean;
  onCapsLock?: (active: boolean) => void;
  extraClass?: string;
}

const PasswordInput: React.FC<PasswordInputProps> = ({
  value,
  onChange,
  placeholder,
  autoFocus,
  label,
  error,
  shake,
  onCapsLock,
  extraClass,
}) => {
  const [visible, setVisible] = useState(false);

  const handleKeyEvent = (e: React.KeyboardEvent) => {
    if (onCapsLock) {
      onCapsLock(e.getModifierState("CapsLock"));
    }
  };

  return (
    <div>
      <label className="block text-xs text-slate-400 font-medium mb-1">
        {label}
      </label>
      <div className={`relative ${shake ? "vault-shake" : ""}`}>
        <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyEvent}
          onKeyUp={handleKeyEvent}
          className={`
            w-full bg-slate-950 border rounded-md py-2 pl-10 pr-10
            focus:outline-none focus:ring-1 text-sm transition-all
            ${
              error
                ? "border-red-500/70 focus:border-red-500 focus:ring-red-500/50"
                : "border-slate-800 focus:border-primary/50 focus:ring-primary/50"
            }
            ${extraClass || ""}
          `}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
          tabIndex={-1}
        >
          {visible ? (
            <EyeOff className="w-4 h-4" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
};

// --- Animated Page Wrapper ---
interface AnimatedPageProps {
  children: React.ReactNode;
  flowKey: string;
}

const AnimatedPage: React.FC<AnimatedPageProps> = ({ children, flowKey }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Force a reflow then animate in
    const raf = requestAnimationFrame(() => {
      setVisible(true);
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [flowKey]);

  return (
    <div
      className={`transition-all duration-300 ease-out ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
      }`}
    >
      {children}
    </div>
  );
};

// --- Enter Hint Component ---
const EnterHint: React.FC<{ visible: boolean }> = ({ visible }) => {
  if (!visible) return null;
  return (
    <span className="inline-flex items-center gap-1 ml-2 text-xs opacity-60 font-normal">
      <CornerDownLeft className="w-3 h-3" />
      Enter
    </span>
  );
};

// --- Main Component ---
const VaultGuard: React.FC<VaultGuardProps> = ({ children }) => {
  const [flowState, setFlowState] = useState<VaultFlowState>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Inline error states
  const [inlineError, setInlineError] = useState("");
  const [shakeField, setShakeField] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  // Timestamp of last access
  const [lastAccess, setLastAccess] = useState<string | null>(null);

  // Transition direction tracking
  const [transitionKey, setTransitionKey] = useState(0);

  const { error, success } = useToast() as any;
  const { login } = useAuth();

  // --- Shake trigger helper ---
  const triggerShake = () => {
    setShakeField(true);
    setTimeout(() => setShakeField(false), 450);
  };

  // --- Clear state on flow change ---
  const navigateTo = useCallback((state: VaultFlowState) => {
    setPassword("");
    setConfirmPassword("");
    setInlineError("");
    setShakeField(false);
    setConfirmTouched(false);
    setCapsLockOn(false);
    setTransitionKey((k) => k + 1);
    setFlowState(state);
  }, []);

  // --- Fetch last access timestamp ---
  const fetchLastAccess = useCallback(async () => {
    try {
      const ts = await invoke<string | null>("get_vault_last_access");
      setLastAccess(ts);
    } catch {
      // Silently ignore — feature is non-critical
      setLastAccess(null);
    }
  }, []);

  useEffect(() => {
    checkVaultState();
  }, []);

  const checkVaultState = async () => {
    setFlowState("loading");
    try {
      const configured = await invoke<boolean>("is_vault_configured");

      if (configured) {
        const locked = await invoke<boolean>("is_vault_locked");
        if (locked) {
          setFlowState("unlock");
          fetchLastAccess();
        } else {
          setFlowState("loading");
          return;
        }
      } else {
        setFlowState("welcome");
      }
    } catch (err) {
      console.error("Failed to check vault state:", err);
      if (error) error("Falha ao conectar com o serviço de segurança.");
      setFlowState("welcome");
    }
  };

  const handleLoginAndCheckSync = async () => {
    setSubmitting(true);
    setInlineError("");
    try {
      await login();

      const hasSyncedVault = await invoke<boolean>("check_synced_vault");
      if (hasSyncedVault) {
        if (success) success("Cofre sincronizado encontrado!");
        navigateTo("unlock_synced");
      } else {
        navigateTo("setup");
      }
    } catch (err: any) {
      if (error) error(`Falha no login: ${err}`);
      setFlowState("welcome");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError("");

    if (password.length < 8) {
      setInlineError("A Master Password deve ter pelo menos 8 caracteres.");
      triggerShake();
      return;
    }
    if (password !== confirmPassword) {
      setInlineError("As senhas não coincidem.");
      triggerShake();
      return;
    }

    setSubmitting(true);
    try {
      await invoke("setup_vault", { password });
      if (success) success("Vault configurado com sucesso!");
      await checkVaultState();
      window.dispatchEvent(new Event("vault-unlocked"));
    } catch (err: any) {
      setInlineError(err.toString());
      triggerShake();
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError("");
    setSubmitting(true);
    try {
      await invoke("unlock_vault", { password });
      if (success) success("Vault destrancado com sucesso!");
      await checkVaultState();
      window.dispatchEvent(new Event("vault-unlocked"));
    } catch (err: any) {
      setInlineError("Senha incorreta. Verifique e tente novamente.");
      triggerShake();
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlockSynced = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError("");
    setSubmitting(true);
    try {
      await invoke("import_synced_vault", { password });
      if (success) success("Cofre sincronizado recuperado com sucesso!");
      await checkVaultState();
      window.dispatchEvent(new Event("vault-unlocked"));
    } catch (err: any) {
      const msg = err.toString();
      if (
        msg.includes("Senha incorreta") ||
        msg.includes("incorrect") ||
        msg.includes("decrypt")
      ) {
        setInlineError(
          "Senha incorreta. Use a Master Password original deste cofre.",
        );
      } else if (msg.includes("não foi encontrado")) {
        setInlineError("Cofre sincronizado não encontrado no dispositivo.");
      } else {
        setInlineError(msg);
      }
      triggerShake();
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  // --- Derived validation for setup confirm ---
  const confirmMismatch =
    confirmTouched &&
    confirmPassword.length > 0 &&
    password !== confirmPassword;
  const passwordStrength = evaluatePasswordStrength(password);

  // --- Render Logic ---
  const [isFullyUnlocked, setIsFullyUnlocked] = useState(false);

  useEffect(() => {
    invoke<boolean>("is_vault_configured").then((c) => {
      if (c)
        invoke<boolean>("is_vault_locked").then((l) => setIsFullyUnlocked(!l));
    });

    const handler = () => setIsFullyUnlocked(true);
    window.addEventListener("vault-unlocked", handler);
    return () => window.removeEventListener("vault-unlocked", handler);
  }, []);

  if (isFullyUnlocked) {
    return <>{children}</>;
  }

  if (flowState === "loading") {
    return (
      <div className="flex flex-col h-screen w-screen bg-background text-slate-500 z-[9999] absolute inset-0">
        {/* Window control bar */}
        <div
          data-tauri-drag-region
          className="flex items-center justify-end shrink-0 h-9 px-2 select-none"
        >
          <div className="flex items-center">
            <button
              onClick={() => appWindow.minimize()}
              className="w-8 h-8 inline-flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors"
              title="Minimizar"
              aria-label="Minimizar"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => appWindow.close()}
              className="w-8 h-8 inline-flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
              title="Fechar"
              aria-label="Fechar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground z-[9999] absolute inset-0">
      {/* Inject keyframes */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-6px); }
          30% { transform: translateX(5px); }
          45% { transform: translateX(-4px); }
          60% { transform: translateX(3px); }
          75% { transform: translateX(-2px); }
          90% { transform: translateX(1px); }
        }
        .vault-shake {
          animation: shake 0.4s ease-in-out;
        }
      `}</style>

      {/* ── Window control bar (drag + minimize/close) ── */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-end shrink-0 h-9 px-2 select-none"
      >
        <div className="flex items-center">
          <button
            onClick={() => appWindow.minimize()}
            className="w-8 h-8 inline-flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors"
            title="Minimizar"
            aria-label="Minimizar"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => appWindow.close()}
            className="w-8 h-8 inline-flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
            title="Fechar"
            aria-label="Fechar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Centered content ── */}
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md p-8 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl relative overflow-hidden">
          {/* Glow effect */}
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>

          {/* ===================== WELCOME ===================== */}
          {flowState === "welcome" && (
            <AnimatedPage flowKey={`welcome-${transitionKey}`}>
              <div className="text-center">
                <div className="mx-auto w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-6 border border-slate-700/50">
                  <ShieldAlert className="w-8 h-8 text-primary" />
                </div>
                <h1 className="text-2xl font-light mb-4">
                  Bem-vindo ao SSH Orchestrator
                </h1>
                <p className="text-sm text-slate-400 mb-8">
                  Para garantir a segurança zero-knowledge das suas credenciais,
                  precisamos configurar o seu cofre local (Vault).
                </p>

                <div className="space-y-4">
                  <button
                    onClick={handleLoginAndCheckSync}
                    disabled={submitting}
                    className="w-full bg-[#24292e] hover:bg-[#2f363d] text-white py-3 px-4 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-3 border border-[#1b1f23]/10"
                  >
                    {submitting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        <span className="text-slate-300">
                          Aguardando autenticação no navegador...
                        </span>
                      </>
                    ) : (
                      <>
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                        </svg>
                        <span>Fazer Login com GitHub para Sincronizar</span>
                      </>
                    )}
                  </button>

                  {submitting && (
                    <p className="text-xs text-slate-500 text-center">
                      Uma janela do navegador foi aberta. Conclua o login por
                      lá.
                    </p>
                  )}

                  <div className="relative flex items-center py-2">
                    <div className="flex-grow border-t border-slate-800"></div>
                    <span className="flex-shrink-0 mx-4 text-slate-500 text-xs">
                      OU
                    </span>
                    <div className="flex-grow border-t border-slate-800"></div>
                  </div>

                  <button
                    onClick={() => navigateTo("setup")}
                    disabled={submitting}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 px-4 rounded-md text-sm font-medium transition-colors"
                  >
                    Usar Apenas Localmente
                  </button>
                </div>
              </div>
            </AnimatedPage>
          )}

          {/* ===================== SETUP ===================== */}
          {flowState === "setup" && (
            <AnimatedPage flowKey={`setup-${transitionKey}`}>
              {/* Back button */}
              <button
                type="button"
                onClick={() => navigateTo("welcome")}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-6 group"
              >
                <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                Voltar
              </button>

              <div className="text-center mb-6">
                <div className="mx-auto w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-slate-700/50">
                  <ShieldAlert className="w-8 h-8 text-amber-500" />
                </div>
                <h2 className="text-xl font-light mb-2">Criar Vault</h2>
                <p className="text-sm text-slate-400">
                  Crie uma Master Password forte para proteger seus dados.
                </p>
              </div>

              {/* Warning box */}
              <div className="flex items-start gap-3 p-3 mb-5 rounded-lg bg-amber-950/40 border border-amber-500/30">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200/90 leading-relaxed">
                  <span className="font-semibold">
                    Esta senha não pode ser recuperada.
                  </span>{" "}
                  Se você perdê-la, será impossível acessar seus servidores e
                  dados criptografados.
                </p>
              </div>

              <form onSubmit={handleSetup} className="space-y-4">
                <div>
                  <PasswordInput
                    label="Master Password"
                    value={password}
                    onChange={(val) => {
                      setPassword(val);
                      setInlineError("");
                    }}
                    placeholder="Mínimo de 8 caracteres"
                    autoFocus
                    error={
                      inlineError && !confirmMismatch ? inlineError : undefined
                    }
                    shake={shakeField}
                    onCapsLock={setCapsLockOn}
                  />

                  {/* Password strength bar */}
                  {password.length > 0 && (
                    <div className="mt-2">
                      <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${passwordStrength.barColor}`}
                          style={{ width: `${passwordStrength.percent}%` }}
                        />
                      </div>
                      <p className={`text-xs mt-1 ${passwordStrength.color}`}>
                        {passwordStrength.label}
                      </p>
                    </div>
                  )}
                </div>

                <PasswordInput
                  label="Confirme a Senha"
                  value={confirmPassword}
                  onChange={(val) => {
                    setConfirmPassword(val);
                    setConfirmTouched(true);
                    setInlineError("");
                  }}
                  placeholder="Repita a Master Password"
                  error={
                    confirmMismatch ? "As senhas não coincidem." : undefined
                  }
                  onCapsLock={setCapsLockOn}
                />

                {/* Caps Lock warning */}
                {capsLockOn && (
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Caps Lock está ativado
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    submitting ||
                    !password ||
                    !confirmPassword ||
                    confirmMismatch
                  }
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4 flex items-center justify-center"
                >
                  {submitting ? (
                    "Configurando..."
                  ) : (
                    <>
                      Concluir
                      <EnterHint
                        visible={
                          !!password && !!confirmPassword && !confirmMismatch
                        }
                      />
                    </>
                  )}
                </button>
              </form>
            </AnimatedPage>
          )}

          {/* ===================== UNLOCK ===================== */}
          {flowState === "unlock" && (
            <AnimatedPage flowKey={`unlock-${transitionKey}`}>
              <div className="text-center mb-8">
                <div className="mx-auto w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-slate-700/50">
                  <Lock className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-xl font-light mb-2">Vault Trancado</h2>
                <p className="text-sm text-slate-400">
                  Digite sua Master Password para acessar suas configurações e
                  servidores.
                </p>

                {/* Last access timestamp */}
                {lastAccess && (
                  <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <Clock className="w-3 h-3" />
                    <span>Última sessão: {formatRelativeTime(lastAccess)}</span>
                  </div>
                )}
              </div>
              <form onSubmit={handleUnlock} className="space-y-4">
                <PasswordInput
                  label="Master Password"
                  value={password}
                  onChange={(val) => {
                    setPassword(val);
                    setInlineError("");
                  }}
                  placeholder="Digite sua senha"
                  autoFocus
                  error={inlineError || undefined}
                  shake={shakeField}
                  onCapsLock={setCapsLockOn}
                />

                {/* Caps Lock warning */}
                {capsLockOn && (
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Caps Lock está ativado
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !password}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4 flex items-center justify-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  {submitting ? (
                    "Acessando..."
                  ) : (
                    <>
                      Destrancar Vault
                      <EnterHint visible={!!password} />
                    </>
                  )}
                </button>
              </form>
            </AnimatedPage>
          )}

          {/* ===================== UNLOCK SYNCED ===================== */}
          {flowState === "unlock_synced" && (
            <AnimatedPage flowKey={`unlock_synced-${transitionKey}`}>
              {/* Back button */}
              <button
                type="button"
                onClick={() => navigateTo("welcome")}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-6 group"
              >
                <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                Voltar
              </button>

              <div className="text-center mb-8">
                <div className="mx-auto w-16 h-16 bg-blue-900/50 rounded-full flex items-center justify-center mb-4 border border-blue-500/50">
                  <Cloud className="w-8 h-8 text-blue-400" />
                </div>
                <h2 className="text-xl font-light mb-2">Cofre Sincronizado</h2>
                <p className="text-sm text-slate-400">
                  Encontramos um Vault sincronizado no seu repositório. Digite a
                  Master Password original para restaurá-lo.
                </p>
              </div>
              <form onSubmit={handleUnlockSynced} className="space-y-4">
                <PasswordInput
                  label="Master Password Original"
                  value={password}
                  onChange={(val) => {
                    setPassword(val);
                    setInlineError("");
                  }}
                  placeholder="Digite sua senha"
                  autoFocus
                  error={inlineError || undefined}
                  shake={shakeField}
                  onCapsLock={setCapsLockOn}
                  extraClass="border-blue-500/30"
                />

                {/* Caps Lock warning */}
                {capsLockOn && (
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Caps Lock está ativado
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !password}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4 flex items-center justify-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  {submitting ? (
                    "Restaurando..."
                  ) : (
                    <>
                      Restaurar e Destrancar
                      <EnterHint visible={!!password} />
                    </>
                  )}
                </button>
              </form>
            </AnimatedPage>
          )}
        </div>
      </div>
      {/* end centered content */}
    </div>
  );
};

export default VaultGuard;
