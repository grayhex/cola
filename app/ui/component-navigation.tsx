"use client";
import type { SiteCatalog } from "../../lib/contracts.ts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Shapes } from "lucide-react";
import ComponentIllustration from "./component-illustration.tsx";
import { useMotionFeedback } from "./motion.tsx";
import { plural } from "../../lib/plural.ts";
import {
  componentNavigation,
  componentCategoryPath,
  componentGroupAnchor,
  componentGroupPath,
} from "../../lib/component-navigation.ts";
import styles from "./component-navigation.module.css";

export function ComponentPath({
  category,
  name,
  path,
  catalog,
}: {
  category: string;
  name: string;
  path: string;
  catalog: SiteCatalog;
}) {
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

function GroupBranch({
  group,
  catalog,
  selected,
  expanded,
  onToggle,
  href,
  onSelect,
}: {
  group: ReturnType<typeof componentNavigation>[number];
  catalog: SiteCatalog;
  selected: string;
  expanded: boolean;
  onToggle: () => void;
  href: (category: string) => string;
  onSelect: () => void;
}) {
  const reveal = useMotionFeedback<HTMLUListElement>(expanded, {
    reveal: true,
  });
  const id = componentGroupAnchor(group.id);
  return (
    <li>
      <button
        id={id}
        className={styles.group}
        type="button"
        aria-expanded={expanded}
        aria-controls={id + "-types"}
        onClick={onToggle}
      >
        <ComponentIllustration group={group.id} name={group.icon} size={26} />
        <span>
          <strong>{group.name}</strong>
          <small>
            {group.categories.length}{" "}
            {plural(group.categories.length, "тип", "типа", "типов")}
          </small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <ul
        id={id + "-types"}
        className={styles.types}
        hidden={!expanded}
        ref={reveal}
      >
        {group.categories.map((c) => (
          <li key={c}>
            <Link
              href={href(c)}
              scroll={false}
              aria-current={selected === c ? "page" : undefined}
              onClick={onSelect}
            >
              <ComponentIllustration
                category={c}
                icons={catalog.icons}
                size={20}
              />
              {c}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
export default function ComponentNavigation({
  catalog,
  categories,
  selected = "",
  href = componentCategoryPath,
}: {
  catalog: SiteCatalog;
  categories: string[];
  selected?: string;
  href?: (category: string) => string;
}) {
  const groups = componentNavigation(catalog, [...categories, selected]);
  const parent = groups.find((g) => g.categories.includes(selected))?.id;
  const [expanded, setExpanded] = useState<string[]>(parent ? [parent] : []);
  const [mobile, setMobile] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const signature = groups.map((g) => g.id).join("|");
  useEffect(() => {
    if (parent)
      setExpanded((ids) => (ids.includes(parent) ? ids : [...ids, parent]));
  }, [parent, selected]);
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
      if (id) {
        setExpanded((ids) => (ids.includes(id) ? ids : [...ids, id]));
        setMobile(true);
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [signature]);
  const select = () => {
    if (mobile) {
      setMobile(false);
      trigger.current?.focus({ preventScroll: true });
    }
  };
  return (
    <nav className={styles.navigation} aria-label="Категории компонентов">
      <button
        ref={trigger}
        type="button"
        className={styles.mobileTrigger}
        aria-expanded={mobile}
        aria-controls="component-tree"
        onClick={() => setMobile((v) => !v)}
      >
        <Shapes size={18} aria-hidden="true" />
        Категории
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div
        id="component-tree"
        className={styles.tree}
        data-mobile-open={mobile}
        onKeyDown={(e) => {
          if (e.key === "Escape" && mobile) {
            e.preventDefault();
            e.stopPropagation();
            select();
          }
        }}
      >
        <Link
          className={styles.all}
          href={href("")}
          scroll={false}
          aria-current={!selected ? "page" : undefined}
          onClick={select}
        >
          Все компоненты
        </Link>
        <ul className={styles.groups}>
          {groups.map((g) => (
            <GroupBranch
              key={g.id}
              group={g}
              catalog={catalog}
              selected={selected}
              expanded={expanded.includes(g.id)}
              href={href}
              onSelect={select}
              onToggle={() =>
                setExpanded((ids) =>
                  ids.includes(g.id)
                    ? ids.filter((id) => id !== g.id)
                    : [...ids, g.id],
                )
              }
            />
          ))}
        </ul>
      </div>
      <p className={styles.activeType} aria-live="polite">
        {selected || "Все компоненты"}
      </p>
    </nav>
  );
}
