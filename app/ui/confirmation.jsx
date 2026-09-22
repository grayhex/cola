"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "./confirmation.module.css";

function Confirmation({ request, settle }) {
  const id = useId(),
    dialog = useRef(null),
    cancel = useRef(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    const previous = document.activeElement,
      element = dialog.current;
    element.showModal();
    cancel.current?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const valid =
    !request.input || reason.trim().length >= (request.input.minLength || 1);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      role="alertdialog"
      aria-labelledby={id + "-title"}
      aria-describedby={id + "-message"}
      onCancel={(event) => {
        event.preventDefault();
        settle(false);
      }}
    >
      <h2 id={id + "-title"}>{request.title || "Подтвердите действие"}</h2>
      <p id={id + "-message"}>{request.message}</p>
      {request.input && (
        <label className="field">
          <span>{request.input.label}</span>
          <input
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      <div className={styles.actions}>
        <button
          ref={cancel}
          type="button"
          className="button secondary"
          onClick={() => settle(false)}
        >
          {request.cancelLabel || "Отмена"}
        </button>
        <button
          type="button"
          className={"button " + (request.danger ? styles.danger : "")}
          disabled={!valid}
          onClick={() => settle(request.input ? reason.trim() : true)}
        >
          {request.confirmLabel || "Продолжить"}
        </button>
      </div>
    </dialog>
  );
}

// Each caller owns its pending decision. Unmount cancels it; no stale continuation
// can approve a destructive action after leaving the page. No browser confirm/prompt.
export function useConfirmation() {
  const [request, setRequest] = useState(null);
  const pending = useRef(null),
    sequence = useRef(0);
  const settle = useCallback((value) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(value);
  }, []);
  useEffect(
    () => () => {
      pending.current?.(false);
      pending.current = null;
    },
    [],
  );
  const ask = useCallback(
    (message, options = {}) =>
      new Promise((resolve) => {
        pending.current?.(false);
        pending.current = resolve;
        setRequest({ ...options, message, id: ++sequence.current });
      }),
    [],
  );
  return [
    ask,
    request && (
      <Confirmation key={request.id} request={request} settle={settle} />
    ),
  ];
}
