"use client";
import dynamic from "next/dynamic";
import { defaultBlocks } from "../../../lib/garage-layout.js";
import { landingSlug, modelLandingPath } from "../../../lib/experience-catalog.js";
import { BikeLabels } from "../bike-labels.jsx";
import { AuthorLink } from "../social-primitives.jsx";
import Photo from "../bike-photo.jsx";
import BikeActions from "../bike-actions.jsx";
import GroupedComponents from "../grouped-components.jsx";
import { BikeGame } from "../achievements.jsx";
import RideList from "../ride-list.jsx";
import JournalList from "../journal-list.jsx";
import { ArrowLeft, ChevronRight, Plus, X, Package, Lock } from "../icons.jsx";
import api from "./api.js";

// Keep the reader's page independent of the comment editor bundle.
const Discussion = dynamic(() => import("../discussion.jsx"), { ssr: false });
const rub = (v) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(Number(v));

export default function BikeDetail({
  Main,
  bike,
  share,
  settings,
  catalog,
  t,
  user,
  editable,
  detailReaction,
  busy,
  photo,
  setPhoto,
  tab,
  setTab,
  setSelected,
  setModal,
  file,
  auth,
  run,
  refresh,
  setNotice,
}) {
  const blocks = settings.detailBlocks || defaultBlocks;
  const block = (id) =>
    blocks.find((b) => b.id === id) || defaultBlocks.find((b) => b.id === id);
  // The page layout fixes where each block goes (#121, #127); settings
  // switch blocks off and pick their look.
  const blockProps = (id) => ({
    hidden: !block(id).enabled,
    "data-variant": block(id).variant,
  });
  const modelName = [bike?.brand, bike?.model, bike?.trim]
    .filter(Boolean)
    .join(" ");
  // A public build is counted on its model's page (#74); a private one only
  // leads to the search.
  const modelHref =
    bike?.is_public && landingSlug(bike.brand) && landingSlug(bike.model)
      ? modelLandingPath(bike.brand, bike.model)
      : "/experience?" +
        new URLSearchParams({
          brand: bike?.brand || "",
          model: bike?.model || "",
        });
  // Without the "О велосипеде" block, the owner's text, public price and
  // manufacturer link stay visible under the title.
  const intro = bike &&
    !block("summary").enabled && {
      description:
        settings.summaryFields?.description !== false && bike.description,
      price:
        bike.show_bike_price &&
        bike.price != null &&
        settings.summaryFields?.price !== false,
      link:
        settings.summaryFields?.manufacturer !== false && bike.manufacturer_url,
    };
  return (
    <Main className="detail bike-detail">
      <div className="breadcrumbs">
        {!share ? (
          <button
            className="quiet"
            onClick={() => {
              setSelected(null);
              setPhoto(null);
            }}
          >
            <ArrowLeft size={16} />
            {t("Мои велосипеды")}
          </button>
        ) : (
          <span>
            {share ? (
              <AuthorLink author={bike.author} />
            ) : (
              t("Пример вашего будущего гаража")
            )}
          </span>
        )}
        <ChevronRight size={14} />
        <a href={modelHref} title="Опыт владельцев этой модели">
          {bike.brand} {bike.model}
        </a>
      </div>
      <div
        className="bike-heading configurable-block"
        {...blockProps("heading")}
      >
        <div>
          <div className="bike-detail-title-row">
            <h1>{bike.name || modelName}</h1>
          </div>
          {/* The name almost always carries the year: it goes into the
              labels next to the size and the weight (#131). Brand and
              model stay in the specification (#121). */}
          <div className="bike-heading-labels">
            <BikeLabels bike={bike} />
          </div>
        </div>
        <div className="detail-actions">
          {share && <AuthorLink author={bike.author} />}
          {!editable && !share && (
            <button
              className="button secondary"
              onClick={() => auth("register")}
            >
              {t("Добавить свой байк")}
              <Plus size={17} />
            </button>
          )}
        </div>
        {intro && (intro.description || intro.price || intro.link) && (
          <div className="bike-intro">
            {intro.description && <p>{bike.description}</p>}
            {(intro.price || intro.link) && (
              <p className="bike-intro-facts">
                {intro.price && (
                  <span>
                    {t("Стоимость велосипеда")}:{" "}
                    <strong>{rub(bike.price)}</strong>
                  </span>
                )}
                {intro.link && (
                  <a
                    className="part-link"
                    href={bike.manufacturer_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("Сайт производителя")}
                  </a>
                )}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="bike-meta-line" hidden={!block("heading").enabled}>
        {bike.color && <span>{bike.color}</span>}
        {settings.showMileage && (
          <span>
            {Number(bike.mileage || 0).toLocaleString("ru-RU")} км
          </span>
        )}
      </div>
      <div
        className="showcase configurable-block"
        {...blockProps("photos")}
      >
        <div className="photo-stage">
          <span className="photo-index">
            {String(
              Math.max(
                1,
                bike.photos.findIndex((p) => p.id === photo?.id) + 1,
              ),
            ).padStart(2, "0")}{" "}
            / {String(Math.max(1, bike.photos.length)).padStart(2, "0")}
          </span>
          <button
            className="photo-open"
            onClick={() => setModal({ type: "photoView" })}
          >
            {/* The photo's description (or the placeholder text) ends
                the name, so the visible text is part of it (#119). */}
            <span className="visually-hidden">
              {t("Открыть фото целиком")}:{" "}
            </span>
            <Photo
              bike={bike}
              photo={photo}
              className="hero-photo"
              sizes="(max-width: 700px) 100vw, 40vw"
              priority
            />
          </button>
          {(photo || bike.photos[0])?.source_page_url && (
            <a
              className="photo-credit"
              href={(photo || bike.photos[0]).source_page_url}
              target="_blank"
              rel="noreferrer"
            >
              Источник фотографии
            </a>
          )}
          {bike.id === "demo" && !settings.demoImageId && (
            <a
              className="photo-credit"
              href="https://www.canyon.com/en-si/outlet-bikes/gravel-bikes/grizl-al-7-raw/50051247.html"
              target="_blank"
              rel="noreferrer"
            >
              {t("Фото: Canyon · пример сборки")}
            </a>
          )}
        </div>
      </div>
      {/* Outside the photos block, so hiding the photo keeps the tools. */}
      <BikeActions
        bike={bike}
        title={bike.name || modelName}
        editable={editable}
        reaction={detailReaction}
        busy={busy}
        onAddPhoto={() => file.current.click()}
        onFindPhoto={() => setModal({ type: "photoSearch" })}
        onAccess={() => setModal({ type: "share" })}
        onEdit={() => setModal({ type: "bike", bike })}
        onDelete={() => setModal({ type: "deleteBike" })}
        t={t}
      />
      <details
        className="bike-summary configurable-block"
        {...blockProps("summary")}
        open={block("summary").open}
      >
        <summary>{t("О велосипеде")}</summary>
        <span className="eyebrow">{t("ПАСПОРТ ВЕЛОСИПЕДА")}</span>
        <h2>
          {t("Собран")}
          <br />
          {t("под себя.")}
        </h2>
        <p hidden={settings.summaryFields?.description === false}>
          {bike.description ||
            t(
              "У каждого велосипеда своя история. Добавьте пару слов о вашем.",
            )}
        </p>

        <div className="summary-bottom">
          <span>{String(bike.components.length).padStart(2, "0")}</span>
          {t("деталей в конфигурации")}
        </div>
        {bike.manufacturer_url &&
          settings.summaryFields?.manufacturer !== false && (
            <a
              className="part-link"
              href={bike.manufacturer_url}
              target="_blank"
              rel="noreferrer"
            >
              {t("Сайт производителя")}
            </a>
          )}
        {bike.show_bike_price &&
          bike.price != null &&
          settings.summaryFields?.price !== false && (
            <p>
              {t("Стоимость велосипеда")}:{" "}
              <strong>{rub(bike.price)}</strong>
            </p>
          )}
      </details>
      {bike.photos.length > 0 && (
        <details
          className="gallery-details configurable-block"
          {...blockProps("gallery")}
          open={block("gallery").open}
        >
          <summary>Фотографии · {bike.photos.length}</summary>
          <div className="gallery">
            {bike.photos.map((p) => (
              <div className="thumb-wrap" key={p.id}>
                <button
                  className={
                    "thumb " +
                    ((photo?.id || bike.photos[0].id) === p.id
                      ? "active"
                      : "")
                  }
                  aria-label={t("Показать фотографию")}
                  onClick={() => setPhoto(p)}
                >
                  <Photo bike={bike} photo={p} sizes="160px" />
                </button>
                {editable && (
                  <div className="thumb-actions">
                    <button
                      className="quiet"
                      disabled={busy || p.is_cover}
                      onClick={() =>
                        run(async () => {
                          await api(
                            `bikes/${bike.id}/photos/${p.id}`,
                            "PATCH",
                          );
                          await refresh();
                          setNotice(t("Обложка обновлена"));
                        })
                      }
                    >
                      {p.is_cover ? t("Обложка") : t("На обложку")}
                    </button>
                    <button
                      className="icon"
                      aria-label={t("Удалить фото")}
                      onClick={() =>
                        setModal({ type: "deletePhoto", photo: p })
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
      <section
        className="specifications configurable-block"
        {...blockProps("specifications")}
      >
        {bike.factory_spec && (
          <details className="factory-source">
            <summary>
              Заводская комплектация ·{" "}
              {bike.factory_spec.source.manufacturer}
            </summary>
            <p className="help">
              Текущие компоненты можно менять независимо от заводской
              комплектации.{" "}
              <a
                href={bike.factory_spec.source.url}
                target="_blank"
                rel="noreferrer"
              >
                Источник
              </a>
            </p>
            <dl className="resolver-preview">
              {bike.factory_spec.components.map((c, i) => (
                <div key={i}>
                  <dt>{c.raw.label}</dt>
                  <dd>{c.raw.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        <div className="tabs-row">
          <div
            className="tabs"
            role="tablist"
            aria-label={t("Разделы конфигурации")}
          >
            {[
              ["build", t("Комплектация")],
              ["accessories", t("Аксессуары")],
            ].map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                aria-controls="parts-panel"
                id={"tab-" + key}
                onClick={() => setTab(key)}
                className={tab === key ? "active" : ""}
              >
                {label}
                <span>
                  {bike.components.filter((p) => p.section === key).length}
                </span>
              </button>
            ))}
          </div>
          {editable && (
            <button
              className="text-link add-component"
              title={
                tab === "build"
                  ? t("Добавить компонент")
                  : t("Добавить аксессуар")
              }
              onClick={() => setModal({ type: "part", section: tab })}
            >
              <Plus size={17} />
              {t("Добавить")}{" "}
              {tab === "build" ? t("компонент") : t("аксессуар")}
            </button>
          )}
        </div>
        <div
          id="parts-panel"
          role="tabpanel"
          aria-labelledby={"tab-" + tab}
        >
          <div className="spec-label">
            <span>
              {tab === "build"
                ? t("ОСНОВА И ДЕТАЛИ")
                : t("ВСЁ ДЛЯ ПОЕЗДКИ")}
            </span>
            <span>{t("АКТУАЛЬНАЯ КОНФИГУРАЦИЯ")}</span>
          </div>
          {bike.components.filter((c) => c.section === tab).length ? (
            <GroupedComponents
              bike={bike}
              section={tab}
              catalog={catalog}
              editable={editable}
              rub={rub}
              onEdit={(c) =>
                setModal({ type: "part", part: c, section: c.section })
              }
              onDelete={(c) => setModal({ type: "deletePart", part: c })}
              onOrder={(order) =>
                run(async () => {
                  await api("bikes/" + bike.id + "/order", "PUT", order);
                  await refresh();
                })
              }
            />
          ) : (
            <div className="empty-parts">
              <Package size={28} strokeWidth={1} />
              <h3>
                {tab === "build"
                  ? t("Всё начинается с первой детали")
                  : t("Место для полезных дополнений")}
              </h3>
              <p>
                {tab === "build"
                  ? t(
                      "Добавьте компоненты, из которых собран ваш велосипед.",
                    )
                  : t(
                      "Свет, сумки, велокомпьютер — всё, что берёте с собой.",
                    )}
              </p>
              {editable && (
                <button
                  className="button secondary"
                  onClick={() => setModal({ type: "part", section: tab })}
                >
                  <Plus size={16} />
                  {t("Добавить")}
                </button>
              )}
            </div>
          )}
        </div>
        {(tab === "build"
          ? bike.show_component_prices
          : bike.show_accessory_prices) &&
          bike.components.some(
            (c) => c.section === tab && c.price != null,
          ) && (
            <div className="cost">
              <Lock size={14} />
              <span>{t("Стоимость выбранного раздела")}</span>
              <strong>
                {rub(
                  bike.components
                    .filter((c) => c.section === tab)
                    .reduce((s, c) => s + Number(c.price || 0), 0),
                )}
              </strong>
            </div>
          )}
      </section>
      {bike.is_public && (
        <BikeGame
          key={JSON.stringify([
            bike.id,
            bike.likes,
            bike.weight,
            bike.category,
            bike.show_bike_price,
            bike.price,
            bike.scores,
            bike.photos.length,
          ])}
          bike={bike}
          user={user}
        />
      )}
      {bike.is_public && <RideList bikeId={bike.id} latest />}
      {/* Sibling keys must differ: with two equal keys React loses one
          fiber on update and leaves a stale copy of its DOM behind. */}
      {bike.id !== "demo" && (
        <JournalList
          key={"journal:" + bike.id}
          bike={bike}
          owner={bike.is_owner}
          editable={editable}
        />
      )}
      {bike.is_public && (
        <Discussion key={"discussion:" + bike.id} bike={bike} user={user} />
      )}
    </Main>
  );
}
