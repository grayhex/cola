"use client";
import { useSite } from "./site-provider.tsx";

// The short line under a guest's «Хочу кататься» and «Организовать покатушку»
// (#378). Its words are a site text, edited in the administrator's «Тексты
// сайта» like the others (`uiCopy`); an emptied text shows nothing.
export default function RegistrationNote({
  className = "",
}: {
  className?: string;
}) {
  const { t } = useSite();
  const text = t("нужна регистрация").trim();
  if (!text) return null;
  return (
    <p className={"registration-note " + className} data-registration-note="">
      {text}
    </p>
  );
}
