"use client";
import type {
  BikeDto,
  PublicComponent,
  SiteCatalog,
} from "../../../lib/contracts.ts";
import type { PartSection } from "./types.ts";
import { componentText } from "../../../services/bike-resolver/src/component-identity.ts";
import GroupedComponents from "../grouped-components.tsx";
import { Lock, Package, Plus } from "../icons.tsx";

const copy = {
  build: {
    title: "Комплектация",
    add: "Добавить компонент",
    emptyTitle: "Всё начинается с первой детали",
    emptyText: "Добавьте компоненты, из которых собран ваш велосипед.",
    cost: "Стоимость комплектации",
  },
  accessories: {
    title: "Аксессуары",
    add: "Добавить аксессуар",
    emptyTitle: "Место для полезных дополнений",
    emptyText: "Свет, сумки, велокомпьютер — всё, что берёте с собой.",
    cost: "Стоимость аксессуаров",
  },
} as const;

type SectionProps = {
  bike: BikeDto;
  catalog: SiteCatalog;
  editable: boolean;
  rub: (value: string | number) => string;
  t: (text: string) => string;
  onAdd: (section: PartSection) => void;
  onEdit: (part: PublicComponent) => void;
  onDelete: (part: PublicComponent) => void;
  onOrder: (order: { groups?: string[]; components?: string[] }) => void;
};

// One section of the build: its groups as cards, or a short empty state with
// the owner's «add» action. The price of the section is shown only where the
// owner made prices public.
function SpecificationSection({
  section,
  ...props
}: SectionProps & { section: PartSection }) {
  const { bike, catalog, editable, rub, t, onAdd, onEdit, onDelete, onOrder } =
    props;
  const text = copy[section];
  const parts = bike.components.filter((c) => c.section === section);
  const showPrices =
    section === "build"
      ? bike.show_component_prices
      : bike.show_accessory_prices;
  const priced = parts.some((c) => c.price != null);
  return (
    <>
      {parts.length ? (
        <GroupedComponents
          bike={bike}
          section={section}
          catalog={catalog}
          editable={editable}
          rub={rub}
          onEdit={onEdit}
          onDelete={onDelete}
          onOrder={onOrder}
        />
      ) : (
        <div className="empty-parts">
          <Package size={28} strokeWidth={1} aria-hidden="true" />
          <h3>{t(text.emptyTitle)}</h3>
          <p>{t(text.emptyText)}</p>
          {editable && (
            <button
              type="button"
              className="button secondary"
              onClick={() => onAdd(section)}
            >
              <Plus size={16} aria-hidden="true" />
              {t("Добавить")}
            </button>
          )}
        </div>
      )}
      {showPrices && priced && (
        <div className="cost">
          <Lock size={14} aria-hidden="true" />
          <span>{t(text.cost)}</span>
          <strong>
            {rub(parts.reduce((sum, c) => sum + Number(c.price || 0), 0))}
          </strong>
        </div>
      )}
    </>
  );
}

// The only full list of the bike's parts (#291): the build as group cards and,
// under it, the accessories as the same cards; the factory specification stays
// a labelled folded block of its own.
export default function BikeSpecifications(props: SectionProps) {
  const { bike, editable, t, onAdd } = props;
  const accessories = bike.components.filter(
    (c) => c.section === "accessories",
  );
  const addButton = (section: PartSection) => (
    <button
      type="button"
      className="text-link add-component"
      onClick={() => onAdd(section)}
    >
      <Plus size={16} aria-hidden="true" />
      {t(copy[section].add)}
    </button>
  );
  return (
    <section
      className="bike-panel specifications"
      id="specifications"
      aria-labelledby="specifications-title"
    >
      <div className="panel-heading">
        <h2 id="specifications-title">{t(copy.build.title)}</h2>
        {editable && addButton("build")}
      </div>
      {bike.factory_spec && (
        <details className="factory-source">
          <summary>
            Заводская комплектация · {bike.factory_spec.source.manufacturer}
          </summary>
          <p className="help">
            Текущие компоненты можно менять независимо от заводской
            комплектации.{" "}
            <a
              href={bike.factory_spec.source.url}
              target="_blank"
              rel="noreferrer"
            >
              Источник
            </a>
          </p>
          <dl className="resolver-preview">
            {bike.factory_spec.components.map((c, i) => (
              <div key={i}>
                <dt>{componentText(c.raw.label)}</dt>
                <dd>{componentText(c.raw.value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <SpecificationSection section="build" {...props} />
      {(accessories.length > 0 || editable) && (
        <div className="spec-accessories">
          <div className="panel-heading">
            <h3>
              {t(copy.accessories.title)} <small>{accessories.length}</small>
            </h3>
            {editable && addButton("accessories")}
          </div>
          <SpecificationSection section="accessories" {...props} />
        </div>
      )}
    </section>
  );
}
