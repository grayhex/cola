"use client";
import { useSite } from "./site-provider.tsx";

/**
 * The words of the note «нужна регистрация» (#378): a site text, edited in the
 * administrator's «Тексты сайта» like the others (`uiCopy`); an emptied text
 * is an empty string, and the note is not shown.
 */
export function useRegistrationText() {
  const { t } = useSite();
  return t("нужна регистрация").trim();
}

// The short line under a guest's «Хочу кататься» and «Организовать покатушку»
// (#378). With `marker` it is the footnote of a title that carries the same
// «*» (#382): the sign stands before the words, and the words stay the
// administrator's text, in `data-registration-note`, with no copy of them
// anywhere.
export default function RegistrationNote({
  className = "",
  id,
  marker = false,
}: {
  className?: string;
  id?: string;
  marker?: boolean;
}) {
  const text = useRegistrationText();
  if (!text) return null;
  if (marker)
    return (
      <p id={id} className={"registration-note " + className}>
        <span aria-hidden="true">* </span>
        <span data-registration-note="">{text}</span>
      </p>
    );
  return (
    <p
      id={id}
      className={"registration-note " + className}
      data-registration-note=""
    >
      {text}
    </p>
  );
}
