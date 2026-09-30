"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, Send, Share2, MessageCircle } from "./icons.tsx";
import styles from "./share-button.module.css";

// Shares the canonical public address (#63, #72). Touch devices get the
// system sheet in one tap; elsewhere a menu offers copy, Telegram and VK.
// Pages pass a path only when everyone can open them (`sharePath` on the
// server), so private pages get no button.
export default function ShareButton({
  path,
  title = "ColaBike",
  className = "",
}: {
  path?: string | null;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false),
    [status, setStatus] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent | PointerEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(""), 2500);
    return () => clearTimeout(timer);
  }, [status]);
  if (!path) return null;
  const url = () => new URL(path, window.location.origin).href;
  async function share() {
    setStatus("");
    if (navigator.share && window.matchMedia?.("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title, url: url() });
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    setOpen((v) => !v);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url());
      setStatus("Ссылка скопирована");
    } catch {
      setStatus("Не удалось скопировать ссылку");
    }
    setOpen(false);
  }
  const target = (base: string, params: Record<string, string>) =>
    base + "?" + new URLSearchParams({ url: url(), ...params });
  return (
    <div
      className={styles.share + (className ? " " + className : "")}
      ref={box}
    >
      <button
        type="button"
        className={"button secondary share-button " + styles.button}
        data-hover="share"
        aria-label="Поделиться"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={share}
      >
        <Share2 size={17} aria-hidden="true" />
        <span>Поделиться</span>
      </button>
      {open && (
        <div className={styles.menu} role="menu" aria-label="Поделиться">
          <button type="button" role="menuitem" onClick={copy}>
            <Copy size={16} aria-hidden="true" />
            Скопировать ссылку
          </button>
          <a
            role="menuitem"
            href={target("https://t.me/share/url", { text: title })}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            <Send size={16} aria-hidden="true" />
            Telegram
          </a>
          <a
            role="menuitem"
            href={target("https://vk.com/share.php", { title })}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            <MessageCircle size={16} aria-hidden="true" />
            ВКонтакте
          </a>
        </div>
      )}
      <span className={styles.status} role="status">
        {status}
      </span>
    </div>
  );
}
