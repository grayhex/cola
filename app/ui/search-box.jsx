"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight, Bike, Route, Wrench } from "lucide-react";
import styles from "./search-box.module.css";
export default function SearchBox({
  initialQuery = "",
  filters = {},
  hero = false,
  contained = false,
  autoFocus = false,
  onNavigate,
  shortcuts = false,
}) {
  const [query, setQuery] = useState(initialQuery),
    [groups, setGroups] = useState([]),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1),
    [status, setStatus] = useState("");
  const input = useRef(null),
    root = useRef(null),
    id = useId(),
    router = useRouter();
  const filterKey = new URLSearchParams(filters).toString();
  const items = groups.flatMap((g) => g.items);
  useEffect(() => setQuery(initialQuery), [initialQuery]);
  useEffect(() => {
    if (!autoFocus) return;
    input.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    if (!shortcuts) return;
    const key = (e) => {
      if (e.target.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      if (
        e.key === "/" ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")
      ) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [shortcuts]);
  useEffect(() => {
    setActive(-1);
    setGroups([]);
    const term = query.trim();
    if (!term) {
      setStatus("");
      return;
    }
    const controller = new AbortController();
    setStatus("Ищем…");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          "/api/discovery/search?" +
            new URLSearchParams({ ...filters, q: term, suggest: "1" }),
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw Error();
        const data = await response.json();
        if (controller.signal.aborted) return;
        setGroups(data.groups);
        setStatus(
          data.total
            ? "Найдено: " + data.total
            : "Ничего не найдено. Попробуйте другой запрос.",
        );
      } catch (error) {
        if (error.name !== "AbortError")
          setStatus("Подсказки недоступны. Нажмите Enter для поиска.");
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, filterKey]);
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);
  function navigate(href) {
    setOpen(false);
    onNavigate?.();
    router.push(href);
  }
  function submit(e) {
    e.preventDefault();
    const term = query.trim();
    if (!term) return;
    navigate(
      active >= 0 && items[active]
        ? items[active].href
        : "/search?" + new URLSearchParams({ ...filters, q: term }),
    );
  }
  let index = -1;
  return (
    <div
      ref={root}
      className={`${styles.root} ${hero ? styles.hero : ""} ${contained ? styles.contained : ""}`}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget))
          setOpen(false);
      }}
    >
      <form role="search" onSubmit={submit} className={styles.control}>
        <Search size={21} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          name="q"
          role="combobox"
          aria-label="Найти велосипед, компонент или покатушку"
          aria-autocomplete="list"
          aria-expanded={open && !!query.trim()}
          aria-controls={id}
          aria-activedescendant={
            open && active >= 0 ? `${id}-${active}` : undefined
          }
          autoComplete="off"
          maxLength={150}
          value={query}
          placeholder="Найти велосипед, компонент или покатушку…"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              setActive(-1);
            }
            if (["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              setOpen(true);
              setActive((n) =>
                !items.length
                  ? -1
                  : n < 0
                    ? e.key === "ArrowDown"
                      ? 0
                      : items.length - 1
                    : (n + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                      items.length,
              );
            }
          }}
        />
        <button type="submit" aria-label="Найти" disabled={!query.trim()}>
          <ArrowRight size={20} aria-hidden="true" />
        </button>
      </form>
      {open && query.trim() && (
        <div className={styles.popover}>
          <div id={id} role="listbox" aria-label="Результаты поиска">
            {groups.map((group) => (
              <div key={group.type} role="group" aria-label={group.label}>
                <div className={styles.group} aria-hidden="true">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const n = ++index,
                    Icon = { bike: Bike, ride: Route, component: Wrench }[
                      item.type
                    ];
                  return (
                    <div
                      key={item.type + item.id}
                      id={`${id}-${n}`}
                      role="option"
                      aria-selected={active === n}
                      className={styles.option}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => navigate(item.href)}
                      onPointerMove={() => setActive(n)}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.subtitle}
                          {item.metadata.distanceM != null
                            ? ` · ${(item.metadata.distanceM / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км`
                            : ""}
                        </small>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className={styles.status} role="status">
            {status}
          </p>
          <button
            className={styles.all}
            type="button"
            onClick={() =>
              navigate(
                "/search?" +
                  new URLSearchParams({ ...filters, q: query.trim() }),
              )
            }
          >
            Все результаты <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
