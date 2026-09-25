"use client";
import { Plus, Trash2, ArrowUp, ArrowDown } from "../ui/icons.jsx";
import PartIcon from "../ui/part-icon.jsx";
import { iconNames } from "../../lib/part-icons.js";
import { moveItem, defaultGroups } from "../../lib/garage-layout.js";
export function GroupSettings({ catalog, onChange }) {
  const groups = catalog.componentGroups || defaultGroups;
  const set = (next) => onChange({ ...catalog, componentGroups: next });
  const categories = [
    ...new Set([
      ...catalog.partCategories.build,
      ...catalog.partCategories.accessories,
      ...defaultGroups.flatMap((g) => g.categories),
      ...groups.flatMap((g) => g.categories),
    ]),
  ];
  return (
    <section className="admin-panel">
      <h2>Группы компонентов</h2>
      <p className="help">
        Категория входит в одну группу. Компоненты без назначенной группы
        попадут в «Другое».
      </p>
      {groups.map((g, i) => (
        <details className="group-editor" key={g.id}>
          <summary>
            <PartIcon name={g.icon} size={20} />
            {g.name} · {g.categories.length}
          </summary>
          <div className="order-actions">
            <button
              className="icon"
              disabled={!i}
              aria-label={g.name + " выше"}
              onClick={() => set(moveItem(groups, i, -1))}
            >
              <ArrowUp size={16} />
            </button>
            <button
              className="icon"
              disabled={i === groups.length - 1}
              aria-label={g.name + " ниже"}
              onClick={() => set(moveItem(groups, i, 1))}
            >
              <ArrowDown size={16} />
            </button>
            <button
              className="icon danger"
              aria-label={"Удалить группу " + g.name}
              onClick={() => set(groups.filter((x) => x.id !== g.id))}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <label className="field">
            <span>Название</span>
            <input
              value={g.name}
              maxLength={150}
              onChange={(e) =>
                set(
                  groups.map((x) =>
                    x.id === g.id ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label className="field">
            <span>Иконка</span>
            <select
              value={g.icon}
              onChange={(e) =>
                set(
                  groups.map((x) =>
                    x.id === g.id ? { ...x, icon: e.target.value } : x,
                  ),
                )
              }
            >
              {iconNames.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <div className="category-checks">
            {categories.map((c) => (
              <label key={c}>
                <input
                  type="checkbox"
                  checked={g.categories.includes(c)}
                  onChange={(e) =>
                    set(
                      groups.map((x) => ({
                        ...x,
                        categories:
                          x.id === g.id
                            ? e.target.checked
                              ? [...x.categories, c]
                              : x.categories.filter((v) => v !== c)
                            : x.categories.filter((v) => v !== c),
                      })),
                    )
                  }
                />
                {c}
              </label>
            ))}
          </div>
        </details>
      ))}
      <button
        className="button secondary"
        onClick={() =>
          set([
            ...groups,
            {
              id: "group-" + crypto.randomUUID().slice(0, 8),
              name: "Новая группа",
              icon: "other",
              categories: [],
            },
          ])
        }
        disabled={groups.length >= 30}
      >
        <Plus size={16} />
        Добавить группу
      </button>
    </section>
  );
}
