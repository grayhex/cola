"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "./garage/modal.tsx";
import styles from "./clubs.module.css";
export default function ClubFilters({
  search,
  city,
  format,
}: {
  search: string;
  city: string;
  format: string;
}) {
  const [interactive, setInteractive] = useState(false),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(search),
    [draftCity, setCity] = useState(city),
    [draftFormat, setFormat] = useState(format),
    router = useRouter();
  useEffect(() => {
    setInteractive(true);
  }, []);
  const submit = (c = city, f = format) => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (c.trim()) p.set("city", c.trim());
    if (f.trim()) p.set("format", f.trim());
    setOpen(false);
    router.push("/clubs" + (p.size ? "?" + p.toString() : ""));
  };
  const fields = (
    <>
      <label className={styles.field}>
        Город
        <input
          disabled={!interactive}
          name="city"
          maxLength={80}
          value={draftCity}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Любой город"
        />
      </label>
      <label className={styles.field}>
        Формат
        <input
          disabled={!interactive}
          name="format"
          maxLength={40}
          value={draftFormat}
          onChange={(e) => setFormat(e.target.value)}
          placeholder="Гравий, шоссе, город"
        />
      </label>
    </>
  );
  return (
    <>
      <form
        className={styles.filters}
        onSubmit={(e) => {
          e.preventDefault();
          submit(
            window.matchMedia("(max-width:600px)").matches ? city : draftCity,
            window.matchMedia("(max-width:600px)").matches
              ? format
              : draftFormat,
          );
        }}
      >
        <label className={styles.field}>
          Поиск
          <input
            disabled={!interactive}
            type="search"
            name="q"
            maxLength={100}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Название или слоган"
          />
        </label>
        <div className={styles.desktopFilters}>{fields}</div>
        <button
          className={"button secondary " + styles.mobileFilters}
          type="button"
          disabled={!interactive}
          onClick={() => {
            setCity(city);
            setFormat(format);
            setOpen(true);
          }}
        >
          Фильтры
          {city || format ? " · " + [city, format].filter(Boolean).length : ""}
        </button>
        <button className="button" disabled={!interactive}>
          Найти
        </button>
      </form>
      {(search || city || format) && (
        <div className={styles.filterSummary}>
          <span>
            {[search && "Поиск: " + search, city, format]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <Link href="/clubs">Сбросить</Link>
        </div>
      )}
      {open && (
        <Modal
          title="Фильтры клубов"
          onClose={() => {
            setCity(city);
            setFormat(format);
            setOpen(false);
          }}
        >
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              submit(draftCity, draftFormat);
            }}
          >
            {fields}
            <div className="planning-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setCity("");
                  setFormat("");
                }}
              >
                Очистить
              </button>
              <button className="button">Применить</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
