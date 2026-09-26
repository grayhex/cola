import { notFound } from "next/navigation";
import { db } from "../../lib/db.js";
import {
  componentCatalog,
  componentCatalogInput,
} from "../../lib/component-catalog.js";
import { indexed } from "../../lib/indexing.js";
import ComponentCatalog from "../ui/component-catalog.jsx";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Компоненты · ColaBike",
  description:
    "Модели компонентов, публичные сборки и опыт владельцев. Поиск по категории и производителю.",
  robots: indexed,
};
export default async function Page({ searchParams }) {
  const input = componentCatalogInput.safeParse(await searchParams);
  if (!input.success) notFound();
  const data = await componentCatalog(db, input.data);
  return (
    <ComponentCatalog
      data={JSON.parse(JSON.stringify(data))}
      filters={input.data}
    />
  );
}
