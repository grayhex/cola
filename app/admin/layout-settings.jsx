"use client";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import PartIcon from "../ui/part-icon.jsx";
import { iconNames } from "../../lib/part-icons.js";
import {
  moveItem,
  defaultBlocks,
  defaultGroups,
} from "../../lib/garage-layout.js";
export function BlockSettings({ settings, onChange }) {
  const blocks = settings.detailBlocks || defaultBlocks;
  return (
    <section className="admin-panel">
      <h2>Блоки карточки велосипеда</h2>
      <p className="help">
        Порядок применяется и на телефоне, и на компьютере. «О велосипеде» по
        умолчанию открыт.
      </p>
      {blocks.map((b, i) => (
        <article className="layout-block-editor" key={b.id}>
          <div className="panel-heading">
            <strong>{b.name}</strong>
            <div className="order-actions">
              <button
                className="icon"
                disabled={!i}
                aria-label={b.name + " выше"}
                onClick={() =>
                  onChange("detailBlocks", moveItem(blocks, i, -1))
                }
              >
                <ChevronUp size={16} />
              </button>
              <button
                className="icon"
                disabled={i === blocks.length - 1}
                aria-label={b.name + " ниже"}
                onClick={() => onChange("detailBlocks", moveItem(blocks, i, 1))}
              >
                <ChevronDown size={16} />
              </button>
            </div>
          </div>
          <label className="admin-toggle">
            Показывать блок
            <input
              type="checkbox"
              checked={b.enabled}
              onChange={(e) =>
                onChange(
                  "detailBlocks",
                  blocks.map((x) =>
                    x.id === b.id ? { ...x, enabled: e.target.checked } : x,
                  ),
                )
              }
            />
          </label>
          <label className="field">
            <span>Вид</span>
            <select
              value={b.variant}
              onChange={(e) =>
                onChange(
                  "detailBlocks",
                  blocks.map((x) =>
                    x.id === b.id ? { ...x, variant: e.target.value } : x,
                  ),
                )
              }
            >
              <option value="compact">Компактный</option>
              <option value="card">Карточка</option>
              <option value="plain">Без оформления</option>
            </select>
          </label>
          {["summary", "gallery"].includes(b.id) && (
            <label className="admin-toggle">
              Открыт по умолчанию
              <input
                type="checkbox"
                checked={b.open}
                onChange={(e) =>
                  onChange(
                    "detailBlocks",
                    blocks.map((x) =>
                      x.id === b.id ? { ...x, open: e.target.checked } : x,
                    ),
                  )
                }
              />
            </label>
          )}
        </article>
      ))}
      <h3>Содержимое «О велосипеде»</h3>
      {Object.entries({
        description: "Описание",
        metadata: "Год, размер, вес и цвет",
        manufacturer: "Ссылка на производителя",
        price: "Стоимость велосипеда",
      }).map(([key, label]) => (
        <label className="admin-toggle" key={key}>
          {label}
          <input
            type="checkbox"
            checked={settings.summaryFields?.[key] !== false}
            onChange={(e) =>
              onChange("summaryFields", {
                ...settings.summaryFields,
                [key]: e.target.checked,
              })
            }
          />
        </label>
      ))}
    </section>
  );
}
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
              <ChevronUp size={16} />
            </button>
            <button
              className="icon"
              disabled={i === groups.length - 1}
              aria-label={g.name + " ниже"}
              onClick={() => set(moveItem(groups, i, 1))}
            >
              <ChevronDown size={16} />
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
