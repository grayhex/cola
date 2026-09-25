"use client";
import {
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Pencil,
  Trash2,
  ExternalLink,
  Ellipsis,
} from "./icons.jsx";
import { groupedComponents } from "../../lib/garage-layout.js";
import { useId, useState, useSyncExternalStore } from "react";
import { useSite } from "./site-provider.jsx";
import PartIcon from "./part-icon.jsx";
import {
  experienceHref,
  landingSlug,
  partLandingPath,
} from "../../lib/experience-catalog.js";
import { useHydrated } from "./use-hydrated.js";
// Without a personal choice groups are open on wide screens and closed on phones.
const wideQuery = "(min-width: 701px)";
function subscribeWide(onChange) {
  const media = window.matchMedia(wideQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const wideNow = () => window.matchMedia(wideQuery).matches;
export default function GroupedComponents({
  bike,
  section,
  catalog,
  editable,
  onEdit,
  onDelete,
  onOrder,
  rub,
}) {
  const { personalSettings } = useSite();
  // Parts of a public bike have their own page (#74); others open the search.
  const partHref = (c) =>
    bike.is_public &&
    bike.id !== "demo" &&
    landingSlug(c.category) &&
    landingSlug(c.name)
      ? partLandingPath(c.category, c.name)
      : experienceHref({ component: c.name, componentCategory: c.category });
  const [expanded, setExpanded] = useState({});
  const wide = useSyncExternalStore(subscribeWide, wideNow, () => false);
  const hydrated = useHydrated();
  const isOpen = (id, state = expanded) =>
    state[id] ?? personalSettings.componentsExpanded ?? wide;
  // The server does not know the screen width: until hydration CSS opens
  // groups nobody has toggled on wide screens, so nothing jumps (#74).
  const byWidth = (id) =>
    !hydrated &&
    expanded[id] === undefined &&
    personalSettings.componentsExpanded == null;
  const instanceId = useId();
  const groups = groupedComponents(
    bike.components.filter((c) => c.section === section),
    catalog.componentGroups,
    bike.group_order || [],
  );
  const allGroupIds = groupedComponents(
    bike.components,
    catalog.componentGroups,
    bike.group_order || [],
  ).map((g) => g.id);
  const groupOrder = (index, direction) => {
    const ids = [...allGroupIds],
      a = ids.indexOf(groups[index].id),
      b = ids.indexOf(groups[index + direction].id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    return ids;
  };
  const showPrices =
    section === "build"
      ? bike.show_component_prices
      : bike.show_accessory_prices;
  return (
    <div className="component-groups">
      {groups.map((group, gi) => (
        <section className="component-group" key={group.id}>
          <div className="component-group-title">
            <h3>
              <button
                type="button"
                className="component-group-toggle"
                aria-expanded={isOpen(group.id)}
                aria-controls={instanceId + group.id}
                onClick={() =>
                  setExpanded((v) => ({
                    ...v,
                    [group.id]: !isOpen(group.id, v),
                  }))
                }
              >
                <PartIcon name={group.icon} size={18} />
                {group.name}
                <small>{group.components.length}</small>
                <ChevronDown size={16} />
              </button>
            </h3>
            {editable && (
              <div className="order-actions">
                <button
                  type="button"
                  className="icon"
                  aria-label={"Группа " + group.name + " выше"}
                  disabled={gi === 0}
                  onClick={() =>
                    onOrder({
                      groups: groupOrder(gi, -1),
                    })
                  }
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={"Группа " + group.name + " ниже"}
                  disabled={gi === groups.length - 1}
                  onClick={() =>
                    onOrder({
                      groups: groupOrder(gi, 1),
                    })
                  }
                >
                  <ArrowDown size={15} />
                </button>
              </div>
            )}
          </div>
          <div
            id={instanceId + group.id}
            {...(byWidth(group.id)
              ? { "data-open-by-width": "" }
              : { hidden: !isOpen(group.id) })}
          >
            {group.components.map((c, i) => (
              <div className="compact-part" key={c.id}>
                <div className="compact-part-main">
                  <small>{c.category}</small>
                  <strong>
                    <a
                      href={partHref(c)}
                      title="Сборки и записи с этим компонентом"
                    >
                      {c.name}
                    </a>
                  </strong>
                  {c.notes && <span className="part-notes">{c.notes}</span>}
                  {c.url && (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="part-link"
                    >
                      <ExternalLink size={12} />
                      Ссылка
                    </a>
                  )}
                </div>
                <div className="compact-part-actions">
                  {showPrices && c.price != null && (
                    <span className="price">{rub(c.price)}</span>
                  )}
                  {editable && (
                    <details>
                      <summary aria-label={"Действия: " + c.name}>
                        <Ellipsis size={18} aria-hidden="true" />
                      </summary>
                      <div className="part-menu">
                        {[-1, 1].map((d) => (
                          <button
                            key={d}
                            className="icon"
                            aria-label={c.name + (d < 0 ? " выше" : " ниже")}
                            disabled={
                              i + d < 0 || i + d >= group.components.length
                            }
                            onClick={() => {
                              const ids = bike.components.map((p) => p.id),
                                a = ids.indexOf(c.id),
                                b = ids.indexOf(group.components[i + d].id);
                              [ids[a], ids[b]] = [ids[b], ids[a]];
                              onOrder({ components: ids });
                            }}
                          >
                            {d < 0 ? (
                              <ArrowUp size={15} />
                            ) : (
                              <ArrowDown size={15} />
                            )}
                          </button>
                        ))}
                        <button
                          className="icon"
                          aria-label={"Изменить " + c.name}
                          onClick={() => onEdit(c)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon danger"
                          aria-label={"Удалить " + c.name}
                          onClick={() => onDelete(c)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
