// Shared by the model and part landing routes (#74): one request-cached
// load, the canonical redirect and metadata.
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { db } from "../../lib/db.js";
import { currentViewer } from "../../lib/viewer.js";
import { routeParam, absolutePublicUrl } from "../../lib/public-urls.js";
import { indexed, hidden } from "../../lib/indexing.js";
import { plural } from "../../lib/plural.js";
import { modelLanding, partLanding } from "../../lib/experience-landing.js";
import { landingSlug } from "../../lib/experience-catalog.js";

const loaders = { model: modelLanding, part: partLanding };
const load = cache(async (kind, first, second) =>
  loaders[kind](db, (await currentViewer())?.id || null, first, second),
);

// The page data, or a 404 when no public build matches. Other spellings of
// the same name move permanently to the canonical address.
export async function landing(kind, rawFirst, rawSecond) {
  const first = routeParam(rawFirst),
    second = routeParam(rawSecond);
  const data = await load(kind, first, second);
  if (!data) notFound();
  const canonical =
    kind === "model"
      ? [landingSlug(data.brand), landingSlug(data.model)]
      : [landingSlug(data.category), landingSlug(data.name)];
  if (!canonical[0] || !canonical[1]) notFound();
  if (first !== canonical[0] || second !== canonical[1])
    permanentRedirect(data.path);
  return data;
}

export function landingMetadata(data) {
  const builds = `${data.builds} ${plural(data.builds, "сборка", "сборки", "сборок")}`;
  const title = `${data.title} — опыт владельцев · ColaBike`;
  const description =
    data.kind === "model"
      ? `${builds} ${data.title} на ColaBike: комплектации, фото, записи журнала и покатушки владельцев.`
      : `${data.title} (${data.category.toLocaleLowerCase("ru")}) стоит в ${data.builds} ${plural(data.builds, "сборке", "сборках", "сборках")} на ColaBike: на каких велосипедах и что пишут владельцы.`;
  const url = absolutePublicUrl(data.path);
  return {
    title: { absolute: title },
    description,
    // Thin pages still open for people, but search engines wait for more.
    robots: data.indexed ? indexed : hidden,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      title,
      description,
      url,
      siteName: "ColaBike",
      locale: "ru_RU",
    },
    twitter: { card: "summary", title, description },
  };
}
