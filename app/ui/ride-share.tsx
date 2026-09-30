"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import ShareButton from "./share-button.tsx";
import { Copy } from "./icons.tsx";
import { useMotionFeedback } from "./motion.tsx";
import styles from "./ride-plan.module.css";

const RideQr = dynamic(
  () =>
    import("./ride-qr.tsx").catch(() => ({
      default: function QrUnavailable() {
        return (
          <p role="alert" className="error">
            Не удалось показать QR-код. Скопируйте ссылку.
          </p>
        );
      },
    })),
  { ssr: false, loading: () => <p role="status">Готовим QR-код…</p> },
);

/** The address as people read it; the QR itself keeps the encoded form. */
function readable(url) {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}
/** Link and QR of the ride's canonical page (#235). A public plan uses the
 * shared share menu; a closed one only copies the address, which opens for
 * invited people alone. Neither is a key to the page. */
export default function RideShare({ ride, sharePath }) {
  const [qr, setQr] = useState(false),
    [url, setUrl] = useState(""),
    [status, setStatus] = useState("");
  const reveal = useMotionFeedback(qr, { reveal: true });
  const copied = useMotionFeedback(status);
  useEffect(() => {
    // A closed plan has no public path; its page address is the canonical
    // one after the server's redirect. Query strings (?owner=1) never leave.
    setUrl(new URL(sharePath || location.pathname, location.origin).href);
  }, [sharePath]);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(""), 2500);
    return () => clearTimeout(timer);
  }, [status]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Ссылка скопирована");
    } catch {
      setStatus("Не удалось скопировать ссылку");
    }
  }
  const open = ride.isPublic !== false && ride.bikePublic !== false;
  return (
    <section className={styles.panel} aria-labelledby="ride-share-title">
      <h2 id="ride-share-title">Позвать знакомых</h2>
      <div className={styles.actions}>
        {open && sharePath ? (
          <ShareButton path={sharePath} title={ride.title} />
        ) : (
          <button
            type="button"
            className="button secondary"
            onClick={copy}
            disabled={!url}
          >
            <span ref={copied}>
              <Copy size={16} aria-hidden="true" />
            </span>
            Скопировать ссылку
          </button>
        )}
        <button
          type="button"
          className="button secondary"
          aria-expanded={qr}
          aria-controls="ride-qr"
          disabled={!url}
          onClick={() => setQr((v) => !v)}
        >
          {qr ? "Скрыть QR-код" : "QR-код"}
        </button>
        <span className={styles.status} role="status">
          {status}
        </span>
      </div>
      {qr && url && (
        <div id="ride-qr" className={styles.qr} ref={reveal}>
          <RideQr value={url} />
          <small>{readable(url)}</small>
        </div>
      )}
      <p className="help">
        {open
          ? "По ссылке и QR виден анонс: дата, формат, район и организатор. Место встречи и участники — только внутри."
          : "Покатушка по приглашению: ссылка откроется только приглашённым и сама доступа не даёт."}{" "}
        Превью, уже отправленные в мессенджеры, могут остаться у получателей
        даже после отмены или закрытия поездки.
      </p>
    </section>
  );
}
