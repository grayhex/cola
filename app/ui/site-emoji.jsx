"use client";
import { useSite } from "./site-provider.jsx";
import { defaultEmojis } from "../../lib/ui-emoji.js";
export default function SiteEmoji({ name, settings, className = "" }) {
  const site = useSite();
  return (
    <span className={"site-emoji " + className} aria-hidden="true">
      {(settings || site.settings).emojis?.[name] ||
        defaultEmojis[name] ||
        defaultEmojis.add}
    </span>
  );
}
