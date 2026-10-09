"use client";

import { cn } from "@/lib/utils";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ToastTone = "success" | "error" | "info";

type Toast = {
  id: number;
  tone: ToastTone;
  message: string;
  detail?: string;
};

type ToastValue = {
  toast: (message: string, options?: { tone?: ToastTone; detail?: string }) => void;
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
};

const ToastContext = createContext<ToastValue | undefined>(undefined);

const toneStyles: Record<ToastTone, string> = {
  success: "bg-success-surface text-ink",
  error: "bg-danger-surface text-ink",
  info: "bg-surface text-ink",
};

const toneIcon: Record<ToastTone, ReactNode> = {
  success: <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />,
  error: <CircleAlert aria-hidden className="size-5 shrink-0 text-danger" />,
  info: <Info aria-hidden className="size-5 shrink-0 text-primary" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback<ToastValue["toast"]>(
    (message, options) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current.slice(-2), { id, message, tone: options?.tone ?? "info", detail: options?.detail }]);
      window.setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo<ToastValue>(
    () => ({
      toast,
      success: (message, detail) => toast(message, { tone: "success", detail }),
      error: (message, detail) => toast(message, { tone: "error", detail }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-6 md:bottom-6 md:items-end"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "animate-rise pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-field px-4 py-3 shadow-card",
              toneStyles[item.tone],
            )}
          >
            {toneIcon[item.tone]}
            <div className="min-w-0 flex-1">
              <p className="text-caption font-medium">{item.message}</p>
              {item.detail ? <p className="text-caption text-muted">{item.detail}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss"
              className="text-muted transition hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used within ToastProvider");
  return value;
}
