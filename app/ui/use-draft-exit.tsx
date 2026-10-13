"use client";
import { useEffect } from "react";
import { useConfirmation } from "./confirmation.tsx";

export function useDraftExit(dirty: boolean) {
  const [ask, confirmation] = useConfirmation();
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const mayDiscard = () =>
    !dirty ||
    ask("Не сохранять изменения?", {
      title: "Отменить редактирование?",
      confirmLabel: "Не сохранять",
      cancelLabel: "Продолжить редактирование",
    });
  return { mayDiscard, confirmation };
}
