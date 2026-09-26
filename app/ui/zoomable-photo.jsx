"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "./icons.jsx";
import { useBackdropClose } from "./use-backdrop-close.js";
import styles from "./rich-text.module.css";

// An illustration in a text (#128): it fits the column and a small picture
// keeps its own size; a click opens the original over the page. The 1280 px
// variant has no srcset: size variants fit a square box, so a width
// descriptor would misstate the picture's size.
export default function ZoomablePhoto({ src, alt = "", srcSet, sizes }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.zoom}
        aria-haspopup="dialog"
        aria-label={"Открыть иллюстрацию целиком" + (alt ? ": " + alt : "")}
        onClick={() => setOpen(true)}
      >
        <img
          src={src + "?width=1280"}
          srcSet={srcSet}
          sizes={sizes}
          alt={alt}
          loading="lazy"
          decoding="async"
        />
      </button>
      {open &&
        // The window belongs to the page, not to the paragraph around the
        // picture: a <dialog> cannot sit inside a <p>.
        createPortal(
          <Lightbox
            src={src}
            alt={alt}
            onClosed={() => {
              setOpen(false);
              // WebKit does not focus a clicked button, so the browser
              // would not know where to return.
              trigger.current?.focus();
            }}
          />,
          document.body,
        )}
    </>
  );
}

// Exists only while open, so a page with many illustrations carries no
// hidden windows and the original loads on demand.
function Lightbox({ src, alt, onClosed }) {
  const dialog = useRef(null);
  const close = () => dialog.current?.close();
  const backdrop = useBackdropClose(close);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.lightbox}
      aria-label={alt || "Иллюстрация"}
      onClose={onClosed}
      {...backdrop}
    >
      <button
        type="button"
        className={"icon " + styles.lightboxClose}
        aria-label="Закрыть"
        onClick={close}
      >
        <X size={20} aria-hidden="true" />
      </button>
      <img src={src} alt={alt} decoding="async" />
    </dialog>
  );
}
