"use client";

import { useEffect, useState } from "react";

type ToastKind = "ok" | "err" | "";
type ToastItem = { id: number; message: string; kind: ToastKind };

const listeners = new Set<(item: ToastItem) => void>();
let nextId = 0;

/** Fire a toast from anywhere in the client bundle (errors, confirmations). */
export function toast(message: string, kind: ToastKind = "") {
  const item: ToastItem = { id: nextId++, message, kind };
  for (const listener of listeners) listener(item);
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener = (item: ToastItem) => {
      setItems((current) => [...current, item]);
      setTimeout(() => {
        setItems((current) => current.filter((other) => other.id !== item.id));
      }, 4500);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div id="toasts">
      {items.map((item) => (
        <div key={item.id} className={`toast ${item.kind}`}>
          {item.message}
        </div>
      ))}
    </div>
  );
}
