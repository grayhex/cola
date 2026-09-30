import type { SocialPreview as SocialPreviewType } from "./social-preview.ts";
import { absolutePublicUrl } from "./public-urls.ts";
import { indexed, hidden } from "./indexing.ts";

export function previewText(value: unknown, limit = 200) {
  const text = String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~]+/g, " ")
    .replace(/[\p{Cc}&&\p{ASCII}]/gv, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + "…";
}

export function socialMetadata(
  preview: SocialPreviewType | null,
  env = process.env,
) {
  if (!preview)
    return {
      title: { absolute: "ColaBike" },
      description: "Сообщество велосипедистов.",
      robots: hidden,
      openGraph: {
        title: "ColaBike",
        description: "Сообщество велосипедистов.",
        siteName: "ColaBike",
        images: [],
      },
      twitter: { card: "summary_large_image", title: "ColaBike", images: [] },
    };
  const url = absolutePublicUrl(preview.path, env);
  const image = absolutePublicUrl(
    `/api/social-preview/${preview.kind}/${preview.link.public_id}/image`,
    env,
  );
  return {
    title: { absolute: preview.title },
    description: preview.description,
    // Only a page every guest can open reaches search engines (#74); a
    // closed listing opens by its link but stays out of search (#116).
    robots: preview.closed ? hidden : indexed,
    alternates: { canonical: url },
    openGraph: {
      type: preview.kind === "profile" ? "profile" : "website",
      title: preview.title,
      description: preview.description,
      url,
      siteName: "ColaBike",
      locale: "ru_RU",
      images: [{ url: image, alt: preview.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: preview.title,
      description: preview.description,
      images: [image],
    },
  };
}
