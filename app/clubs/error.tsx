"use client";
import styles from "../ui/clubs.module.css";
export default function ClubError({ reset }: { reset: () => void }) {
  return (
    <section className={styles.page}>
      <h1>Не удалось загрузить клубы</h1>
      <p>Попробуйте ещё раз. Ваши фильтры останутся в адресе страницы.</p>
      <button className="button" onClick={reset}>
        Повторить
      </button>
    </section>
  );
}
