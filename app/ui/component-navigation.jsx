"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Shapes } from "lucide-react";
import ComponentIllustration from "./component-illustration.jsx";
import { useMotionFeedback } from "./motion.tsx";
import { plural } from "../../lib/plural.ts";
import {
  componentNavigation,
  componentCategoryPath,
  componentGroupAnchor,
  componentGroupPath,
} from "../../lib/component-navigation.ts";
import styles from "./component-navigation.module.css";

export function ComponentPath({ category, name, path, catalog }) {
  const group = componentNavigation(catalog, [category]).find((g) =>
    g.categories.includes(category),
  );
  return (
    <nav className={styles.breadcrumb} aria-label="Путь компонента">
      <ol>
        <li>
          <Link href="/components">
            <Shapes size={16} />
            Компоненты
          </Link>
        </li>
        {group && (
          <li>
            <ChevronRight size={14} />
            <Link href={componentGroupPath(group.id)}>
              <ComponentIllustration
                group={group.id}
                name={group.icon}
                size={20}
              />
              {group.name}
            </Link>
          </li>
        )}
        <li>
          <ChevronRight size={14} />
          <Link href={componentCategoryPath(category)}>
            <ComponentIllustration
              category={category}
              icons={catalog.icons}
              size={20}
            />
            {category}
          </Link>
        </li>
        <li>
          <ChevronRight size={14} />
          <Link href={path} aria-current="page">
            {name}
          </Link>
        </li>
      </ol>
    </nav>
  );
}

export default function ComponentNavigation({ catalog, categories, selected }) {
  const groups = componentNavigation(catalog, categories);
  const initial = groups.find((g) => g.categories.includes(selected))?.id || "";
  const [expanded, setExpanded] = useState(initial);
  const active = groups.find((g) => g.id === expanded);
  const panel = useMotionFeedback(expanded, { reveal: true });
  const signature = groups.map((g) => g.id).join("|");
  useEffect(() => {
    const sync = () => {
      let hash;
      try {
        hash = decodeURIComponent(location.hash.slice(1));
      } catch {
        return;
      }
      const id = signature
        .split("|")
        .find((g) => componentGroupAnchor(g) === hash);
      if (id) setExpanded(id);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [signature]);
  const links = (g) => (
    <ul className={styles.types}>
      {g.categories.map((c) => (
        <li key={c}>
          <Link
            href={componentCategoryPath(c)}
            aria-current={selected === c ? "page" : undefined}
          >
            <ComponentIllustration
              category={c}
              icons={catalog.icons}
              size={22}
            />
            {c}
            <ChevronRight size={14} />
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <section className={styles.navigation} aria-label="Категории компонентов">
      <div className={styles.groups}>
        {groups.map((g) => (
          <button
            key={g.id}
            id={componentGroupAnchor(g.id)}
            className={styles.group}
            type="button"
            aria-expanded={expanded === g.id}
            aria-controls="component-group-types"
            onClick={() => setExpanded(g.id)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setExpanded("");
            }}
          >
            <ComponentIllustration group={g.id} name={g.icon} size={40} />
            <span>
              <strong>{g.name}</strong>
              <small>
                {g.categories.length}{" "}
                {plural(g.categories.length, "тип", "типа", "типов")}{" "}
                компонентов
              </small>
            </span>
            <ChevronDown size={16} />
          </button>
        ))}
      </div>
      <div
        id="component-group-types"
        hidden={!active}
        className={styles.panel}
        ref={panel}
      >
        {active && (
          <>
            <h2>
              <ComponentIllustration
                group={active.id}
                name={active.icon}
                size={24}
              />
              {active.name}
            </h2>
            {links(active)}
          </>
        )}
      </div>
      <details className={styles.directory}>
        <summary>
          <Shapes size={18} />
          Все типы компонентов{" "}
          <span className="count">
            {groups.reduce((n, g) => n + g.categories.length, 0)}
          </span>
        </summary>
        <div className={styles.directoryGrid}>
          {groups.map((g) => (
            <section key={g.id} aria-label={g.name}>
              <h3>
                <ComponentIllustration group={g.id} name={g.icon} size={24} />
                {g.name}
              </h3>
              {links(g)}
            </section>
          ))}
        </div>
      </details>
    </section>
  );
}
