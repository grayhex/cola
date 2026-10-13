"use client";
import { useEffect } from "react";
import { useConfirmation } from "./confirmation.tsx";

export function useDraftExit(dirty: boolean, shouldWarn: () => boolean) {
  const [ask, confirmation] = useConfirmation();
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!shouldWarn()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, shouldWarn]);
  const mayDiscard = () =>
    !dirty ||
    !shouldWarn() ||
    ask("Не сохранять изменения?", {
      title: "Отменить редактирование?",
      confirmLabel: "Не сохранять",
      cancelLabel: "Продолжить редактирование",
    });
  return { mayDiscard, confirmation };
}
