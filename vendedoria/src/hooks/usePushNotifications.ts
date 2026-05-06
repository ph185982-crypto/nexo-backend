"use client";

import { useState, useEffect, useCallback } from "react";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function subscribeAndSave(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const res = await fetch("/api/push/vapid-public-key");
    if (!res.ok) return false;
    const { publicKey } = await res.json() as { publicKey: string };

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as ArrayBuffer,
    });

    const saved = await fetch("/api/push/subscribe", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(sub),
    });
    return saved.ok;
  } catch {
    return false;
  }
}

export function usePushNotifications() {
  const [permissao, setPermissao] = useState<NotificationPermission>("default");
  const [suportado, setSuportado] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSuportado(ok);
    if (ok) setPermissao(Notification.permission);
  }, []);

  // Re-subscribe silently if already granted (e.g. after SW update)
  useEffect(() => {
    if (!suportado || permissao !== "granted") return;
    subscribeAndSave().catch(() => {});
  }, [suportado, permissao]);

  const ativar = useCallback(async (): Promise<"granted" | "denied" | "default"> => {
    if (!suportado) return "default";
    const perm = await Notification.requestPermission();
    setPermissao(perm);
    if (perm === "granted") await subscribeAndSave();
    return perm;
  }, [suportado]);

  return { permissao, suportado, ativar };
}
