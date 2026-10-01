"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { BikeWeekChoice } from "../../lib/bike-week.ts";
import { publicPath } from "../../lib/public-urls.ts";
import { errorMessage } from "../../lib/errors.ts";
import { socialApi } from "../ui/social-primitives.tsx";
import SmallImage from "../ui/small-image.tsx";
import styles from "../ui/bike-week.module.css";

export function BikeWeekLabel({ bike }: { bike: BikeWeekChoice }) {
  return (
    <div className={styles.bikeChoice}>
      <SmallImage
        className={styles.choicePhoto}
        src={bike.photo_id ? `/api/photos/${bike.photo_id}?width=160` : null}
      />
      <div>
        <Link href={publicPath("bike", bike)} prefetch={false}>
          {bike.name}
        </Link>
        <small>
          {bike.owner_name} · @{bike.username}
        </small>
        <small className={styles.choiceId}>{bike.id}</small>
      </div>
    </div>
  );
}

export default function BikeWeekPicker({
  week,
  value,
  onChange,
  disabled,
}: {
  week: string;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [bikes, setBikes] = useState<BikeWeekChoice[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setBikes(null);
    setError("");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ week, q: query });
      socialApi<{ bikes: BikeWeekChoice[] }>("bike-week/bikes?" + params)
        .then((data) => {
          if (active) setBikes(data.bikes);
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [week, query, revision]);
  return (
    <section aria-label="Ручной выбор велосипеда">
      <label className="field">
        <span>Найти публичный велосипед</span>
        <input
          type="search"
          maxLength={100}
          placeholder="Название, автор или ID"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange("");
          }}
        />
      </label>
      <p className="help">
        До 20 результатов. Публичные велосипеды с обложкой и пятью категориями
        комплектации, без отказа владельца на эту неделю. Баллы и перерыв не
        ограничивают ручной выбор.
      </p>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button
            className="quiet"
            type="button"
            onClick={() => setRevision((n) => n + 1)}
          >
            Повторить поиск
          </button>
        </p>
      ) : !bikes ? (
        <p role="status">Ищем велосипеды…</p>
      ) : !bikes.length ? (
        <p role="status">
          Нет подходящих велосипедов. Попробуйте другое название или автора.
        </p>
      ) : (
        <ul
          className={styles.candidates}
          aria-label="Результаты поиска велосипедов"
        >
          {bikes.map((bike) => (
            <li key={bike.id}>
              <BikeWeekLabel bike={bike} />
              <label className={styles.choiceRadio}>
                <input
                  type="radio"
                  name="manual-bike-week"
                  checked={value === bike.id}
                  disabled={disabled}
                  onChange={() => onChange(bike.id)}
                  aria-label={"Выбрать " + bike.name}
                />
                Выбрать
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
