"use client";
import {
  ChevronUp,
  ChevronDown,
  Pencil,
  Trash2,
  ExternalLink,
} from "./icons.jsx";
import { groupedComponents } from "../../lib/garage-layout.js";
import PartIcon from "./part-icon.jsx";
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
            <PartIcon name={group.icon} size={20} />
            <h3>{group.name}</h3>
            <small>{group.components.length}</small>
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
                  <ChevronUp size={15} />
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
                  <ChevronDown size={15} />
                </button>
              </div>
            )}
          </div>
          {group.components.map((c, i) => (
            <div className="compact-part" key={c.id}>
              <div className="compact-part-main">
                <small>{c.category}</small>
                <strong>{c.name}</strong>
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
                    <summary aria-label={"Действия: " + c.name}>···</summary>
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
                            <ChevronUp size={15} />
                          ) : (
                            <ChevronDown size={15} />
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
        </section>
      ))}
    </div>
  );
}
