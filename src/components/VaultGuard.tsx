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
    return { level: "weak", label: "", color: "", barColor: "rgba(255,255,255,0.1)", percent: 0 };
  }
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (password.length < 8) {
    return { level: "weak", label: "Muito curta", color: "#ff453a", barColor: "#ff453a", percent: 15 };
  }
  if (score <= 2) {
    return { level: "weak", label: "Fraca", color: "#ff453a", barColor: "#ff453a", percent: 25 };
  }
  if (score === 3) {
    return { level: "fair", label: "Razoável", color: "#ffd60a", barColor: "#ffd60a", percent: 50 };
  }
  if (score === 4) {
    return { level: "good", label: "Boa", color: "#0a84ff", barColor: "#0a84ff", percent: 75 };
  }
  return { level: "strong", label: "Forte", color: "#32d74b", barColor: "#32d74b", percent: 100 };
}

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

interface PasswordInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  label: string;
  error?: string;
  shake?: boolean;
  onCapsLock?: (active: boolean) => void;
  accentBlue?: boolean;
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
  accentBlue,
}) => {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);

  const handleKeyEvent = (e: React.KeyboardEvent) => {
    if (onCapsLock) onCapsLock(e.getModifierState("CapsLock"));
  };

  const borderColor = error
    ? "rgba(255,69,58,0.7)"
    : focused
    ? accentBlue
      ? "rgba(10,132,255,0.8)"
      : "rgba(10,132,255,0.8)"
    : "rgba(255,255,255,0.1)";

  return (
    <div>
      <label
        className="block text-[11px] font-medium mb-1.5"
        style={{ color: "rgba(235,235,245,0.45)" }}
      >
        {label}
      </label>
      <div className={shake ? "vault-shake" : ""}>
        <div
          className="relative rounded-xl overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: `0.5px solid ${borderColor}`,
            transition: "border-color 0.15s",
          }}
        >
          <KeyRound
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: "rgba(255,255,255,0.3)" }}
          />
          <input
            type={visible ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyEvent}
            onKeyUp={handleKeyEvent}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="w-full bg-transparent py-2.5 pl-10 pr-10 text-sm text-white focus:outline-none placeholder:text-white/20"
            placeholder={placeholder}
            autoFocus={autoFocus}
          />
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
            style={{ color: "rgba(255,255,255,0.3)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
            tabIndex={-1}
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {error && (
        <p
          className="mt-1.5 text-xs flex items-center gap-1"
          style={{ color: "#ff453a" }}
        >
          <AlertTriangle className="w-3 h-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
};

interface AnimatedPageProps {
  children: React.ReactNode;
  flowKey: string;
}

const AnimatedPage: React.FC<AnimatedPageProps> = ({ children, flowKey }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
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

const EnterHint: React.FC<{ visible: boolean }> = ({ visible }) => {
  if (!visible) return null;
  return (
    <span
      className="inline-flex items-center gap-1 ml-2 text-xs font-normal"
      style={{ opacity: 0.5 }}
    >
      <CornerDownLeft className="w-3 h-3" />
      Enter
    </span>
  );
};

// Window controls strip (shared between loading and full view)
const WindowControls: React.FC = () => (
  <div
    data-tauri-drag-region
    className="flex items-center justify-end shrink-0 h-9 px-2 select-none"
  >
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => appWindow.minimize()}
        className="w-7 h-7 inline-flex items-center justify-center rounded-lg transition-colors"
        style={{ color: "rgba(255,255,255,0.3)" }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,214,10,0.15)";
          (e.currentTarget as HTMLButtonElement).style.color = "#ffd60a";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.3)";
        }}
        title="Minimizar"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => appWindow.close()}
        className="w-7 h-7 inline-flex items-center justify-center rounded-lg transition-colors"
        style={{ color: "rgba(255,255,255,0.3)" }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,69,58,0.15)";
          (e.currentTarget as HTMLButtonElement).style.color = "#ff453a";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.3)";
        }}
        title="Fechar"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
);

const VaultGuard: React.FC<VaultGuardProps> = ({ children }) => {
  const [flowState, setFlowState] = useState<VaultFlowState>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [inlineError, setInlineError] = useState("");
  const [shakeField, setShakeField] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [lastAccess, setLastAccess] = useState<string | null>(null);
  const [transitionKey, setTransitionKey] = useState(0);

  const { error, success } = useToast() as any;
  const { login } = useAuth();

  const triggerShake = () => {
    setShakeField(true);
    setTimeout(() => setShakeField(false), 450);
  };

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

  const fetchLastAccess = useCallback(async () => {
    try {
      const ts = await invoke<string | null>("get_vault_last_access");
      setLastAccess(ts);
    } catch {
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
      if (msg.includes("Senha incorreta") || msg.includes("incorrect") || msg.includes("decrypt")) {
        setInlineError("Senha incorreta. Use a Master Password original deste cofre.");
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

  const confirmMismatch =
    confirmTouched && confirmPassword.length > 0 && password !== confirmPassword;
  const passwordStrength = evaluatePasswordStrength(password);

  const [isFullyUnlocked, setIsFullyUnlocked] = useState(false);

  useEffect(() => {
    invoke<boolean>("is_vault_configured").then((c) => {
      if (c) invoke<boolean>("is_vault_locked").then((l) => setIsFullyUnlocked(!l));
    });
    const handler = () => setIsFullyUnlocked(true);
    window.addEventListener("vault-unlocked", handler);
    return () => window.removeEventListener("vault-unlocked", handler);
  }, []);

  if (isFullyUnlocked) return <>{children}</>;

  if (flowState === "loading") {
    return (
      <div className="flex flex-col h-screen w-screen z-[9999] absolute inset-0" style={{ background: "#000" }}>
        <WindowControls />
        <div className="flex flex-1 items-center justify-center">
          <div
            className="w-8 h-8 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(255,255,255,0.1)", borderTopColor: "#0a84ff" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-screen w-screen z-[9999] absolute inset-0"
      style={{ background: "#000" }}
    >
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
        .vault-shake { animation: shake 0.4s ease-in-out; }
      `}</style>

      <WindowControls />

      {/* Centered content */}
      <div className="flex flex-1 items-center justify-center px-4">
        <div
          className="w-full max-w-[400px] p-8 relative overflow-hidden"
          style={{
            background: "rgba(28,28,30,0.88)",
            backdropFilter: "blur(40px) saturate(180%)",
            WebkitBackdropFilter: "blur(40px) saturate(180%)",
            border: "0.5px solid rgba(255,255,255,0.12)",
            borderRadius: "24px",
            boxShadow: "0 24px 64px rgba(0,0,0,0.7), inset 0 0 0 0.5px rgba(255,255,255,0.06)",
          }}
        >
          {/* ===================== WELCOME ===================== */}
          {flowState === "welcome" && (
            <AnimatedPage flowKey={`welcome-${transitionKey}`}>
              <div className="text-center">
                <div
                  className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
                  style={{ background: "rgba(10,132,255,0.12)", border: "0.5px solid rgba(10,132,255,0.25)" }}
                >
                  <ShieldAlert className="w-8 h-8 text-primary" />
                </div>
                <h1 className="text-[22px] font-semibold tracking-tight text-white mb-3">
                  Bem-vindo ao SSH Orchestrator
                </h1>
                <p className="text-sm mb-8" style={{ color: "rgba(235,235,245,0.5)", lineHeight: "1.6" }}>
                  Para garantir a segurança zero-knowledge das suas credenciais,
                  configure o seu cofre local.
                </p>

                <div className="space-y-3">
                  <button
                    onClick={handleLoginAndCheckSync}
                    disabled={submitting}
                    className="w-full py-3 px-4 text-sm font-semibold text-white rounded-xl flex items-center justify-center gap-3 transition-colors disabled:opacity-50"
                    style={{ background: "#0a84ff" }}
                    onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "#409cff"; }}
                    onMouseLeave={e => (e.currentTarget.style.background = "#0a84ff")}
                  >
                    {submitting ? (
                      <>
                        <div
                          className="w-4 h-4 rounded-full border-2 animate-spin"
                          style={{ borderColor: "rgba(255,255,255,0.2)", borderTopColor: "white" }}
                        />
                        <span>Aguardando autenticação...</span>
                      </>
                    ) : (
                      <>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                        </svg>
                        <span>Entrar com GitHub para Sincronizar</span>
                      </>
                    )}
                  </button>

                  {submitting && (
                    <p className="text-xs text-center" style={{ color: "rgba(235,235,245,0.35)" }}>
                      Uma janela do navegador foi aberta. Conclua o login por lá.
                    </p>
                  )}

                  <div className="relative flex items-center py-1">
                    <div className="flex-grow" style={{ height: "0.5px", background: "rgba(255,255,255,0.08)" }} />
                    <span className="flex-shrink-0 mx-4 text-xs" style={{ color: "rgba(235,235,245,0.3)" }}>
                      ou
                    </span>
                    <div className="flex-grow" style={{ height: "0.5px", background: "rgba(255,255,255,0.08)" }} />
                  </div>

                  <button
                    onClick={() => navigateTo("setup")}
                    disabled={submitting}
                    className="w-full py-3 px-4 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
                    style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.75)" }}
                    onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "rgba(255,255,255,0.14)"; }}
                    onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
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
              <button
                type="button"
                onClick={() => navigateTo("welcome")}
                className="flex items-center gap-1.5 text-xs font-medium mb-6 group transition-colors"
                style={{ color: "rgba(235,235,245,0.4)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(235,235,245,0.4)")}
              >
                <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                Voltar
              </button>

              <div className="text-center mb-6">
                <div
                  className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: "rgba(255,159,10,0.12)", border: "0.5px solid rgba(255,159,10,0.25)" }}
                >
                  <ShieldAlert className="w-8 h-8" style={{ color: "#ff9f0a" }} />
                </div>
                <h2 className="text-[20px] font-semibold tracking-tight text-white mb-2">
                  Criar Vault
                </h2>
                <p className="text-sm" style={{ color: "rgba(235,235,245,0.5)" }}>
                  Crie uma Master Password forte para proteger seus dados.
                </p>
              </div>

              {/* Warning box */}
              <div
                className="flex items-start gap-3 p-3 mb-5 rounded-xl"
                style={{ background: "rgba(255,159,10,0.08)", border: "0.5px solid rgba(255,159,10,0.25)" }}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#ff9f0a" }} />
                <p className="text-xs leading-relaxed" style={{ color: "rgba(255,214,10,0.8)" }}>
                  <span className="font-semibold">Esta senha não pode ser recuperada.</span>{" "}
                  Se perdê-la, será impossível acessar seus dados criptografados.
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
                    error={inlineError && !confirmMismatch ? inlineError : undefined}
                    shake={shakeField}
                    onCapsLock={setCapsLockOn}
                  />

                  {password.length > 0 && (
                    <div className="mt-2">
                      <div
                        className="h-1 w-full rounded-full overflow-hidden"
                        style={{ background: "rgba(255,255,255,0.08)" }}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{ width: `${passwordStrength.percent}%`, background: passwordStrength.barColor }}
                        />
                      </div>
                      <p className="text-xs mt-1 font-medium" style={{ color: passwordStrength.color }}>
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
                  error={confirmMismatch ? "As senhas não coincidem." : undefined}
                  onCapsLock={setCapsLockOn}
                />

                {capsLockOn && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: "#ffd60a" }}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Caps Lock está ativado
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !password || !confirmPassword || confirmMismatch}
                  className="w-full py-2.5 text-sm font-semibold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-2 flex items-center justify-center text-white"
                  style={{ background: "#0a84ff" }}
                  onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "#409cff"; }}
                  onMouseLeave={e => (e.currentTarget.style.background = "#0a84ff")}
                >
                  {submitting ? "Configurando..." : (
                    <>
                      Concluir
                      <EnterHint visible={!!password && !!confirmPassword && !confirmMismatch} />
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
                <div
                  className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: "rgba(10,132,255,0.12)", border: "0.5px solid rgba(10,132,255,0.25)" }}
                >
                  <Lock className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-[20px] font-semibold tracking-tight text-white mb-2">
                  Vault Bloqueado
                </h2>
                <p className="text-sm" style={{ color: "rgba(235,235,245,0.5)" }}>
                  Digite sua Master Password para acessar seus servidores.
                </p>

                {lastAccess && (
                  <div
                    className="mt-3 inline-flex items-center gap-1.5 text-xs"
                    style={{ color: "rgba(235,235,245,0.35)" }}
                  >
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

                {capsLockOn && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: "#ffd60a" }}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Caps Lock está ativado
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !password}
                  className="w-full py-2.5 text-sm font-semibold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-2 flex items-center justify-center gap-2 text-white"
                  style={{ background: "#0a84ff" }}
                  onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "#409cff"; }}
                  onMouseLeave={e => (e.currentTarget.style.background = "#0a84ff")}
                >
                  <Lock className="w-4 h-4" />
                  {submitting ? "Acessando..." : (
                    <>
                      Desbloquear
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
              <button
                type="button"
                onClick={() => navigateTo("welcome")}
                className="flex items-center gap-1.5 text-xs font-medium mb-6 group transition-colors"
                style={{ color: "rgba(235,235,245,0.4)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(235,235,245,0.4)")}
              >
                <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                Voltar
              </button>

              <div className="text-center mb-8">
                <div
                  className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: "rgba(100,210,255,0.1)", border: "0.5px solid rgba(100,210,255,0.25)" }}
                >
                  <Cloud className="w-8 h-8" style={{ color: "#64d2ff" }} />
                </div>
                <h2 className="text-[20px] font-semibold tracking-tight text-white mb-2">
                  Cofre Sincronizado
                </h2>
                <p className="text-sm" style={{ color: "rgba(235,235,245,0.5)" }}>
                  Encontramos um Vault no seu repositório. Digite a Master
                  Password original para restaurá-lo.
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
                  accentBlue
                />

                {capsLockOn && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: "#ffd60a" }}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Caps Lock está ativado
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !password}
                  className="w-full py-2.5 text-sm font-semibold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-2 flex items-center justify-center gap-2 text-white"
                  style={{ background: "#0a84ff" }}
                  onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "#409cff"; }}
                  onMouseLeave={e => (e.currentTarget.style.background = "#0a84ff")}
                >
                  <Lock className="w-4 h-4" />
                  {submitting ? "Restaurando..." : (
                    <>
                      Restaurar e Desbloquear
                      <EnterHint visible={!!password} />
                    </>
                  )}
                </button>
              </form>
            </AnimatedPage>
          )}
        </div>
      </div>
    </div>
  );
};

export default VaultGuard;
