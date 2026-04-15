"use client";

import { useState, useEffect } from "react";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function usePushNotifications() {
  const [permissao, setPermissao] = useState<NotificationPermission>("default");
  const [suportado, setSuportado] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSuportado("serviceWorker" in navigator && "PushManager" in window);
    if ("Notification" in window) {
      setPermissao(Notification.permission);
    }
    // Register SW
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((e) =>
        console.warn("[SW] Registro falhou:", e)
      );
    }
  }, []);

  async function ativar(): Promise<void> {
    if (!suportado) return;
    try {
      const perm = await Notification.requestPermission();
      setPermissao(perm);
      if (perm !== "granted") return;

      const reg = await navigator.serviceWorker.ready;

      const res = await fetch("/api/push/vapid-public-key");
      if (!res.ok) {
        console.warn("[Push] VAPID public key não disponível");
        return;
      }
      const { publicKey } = await res.json() as { publicKey: string };

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as ArrayBuffer,
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });

      console.log("[Push] Notificações ativadas");
    } catch (err) {
      console.error("[Push] Erro ao ativar:", err);
    }
  }

  return { permissao, suportado, ativar };
}
