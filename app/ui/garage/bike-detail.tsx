"use client";
import type * as React from "react";
import { useState } from "react";
import type {
  BikeDto,
  ViewerDto,
  PublicPhoto,
  SiteSettings,
  SiteCatalog,
  UserPreferences,
} from "../../../lib/contracts.ts";
import type {
  BikeSetter,
  PhotoSetter,
  ModalSetter,
  Run,
  MainElement,
} from "./types.ts";
import type { useBikeReaction } from "../use-bike-reaction.ts";
import type { PhotoProblem } from "../../../lib/photo-upload.ts";
import dynamic from "next/dynamic";
import Link from "next/link";
import { detailLayout } from "../../../lib/garage-layout.ts";
import { overviewPanels } from "../../../lib/bike-passport.ts";
import { experienceHref } from "../../../lib/experience-catalog.ts";
import BikeGallery from "./bike-gallery.tsx";
import BikeIdentity from "./bike-identity.tsx";
import BikeOverview from "./bike-overview.tsx";
import BikeSpecifications from "./bike-specifications.tsx";
import { BikeTabList, BikeTabPanel } from "./bike-tabs.tsx";
import { useBikeTab } from "./use-bike-tab.ts";
import { BikeGame } from "../achievements.tsx";
import RideList from "../ride-list.tsx";
import JournalList from "../journal-list.tsx";
import JournalBuildPrompt from "../journal-build-prompt.tsx";
import { ArrowLeft, ChevronRight } from "../icons.tsx";
import api from "./api.ts";

// Keep the reader's page independent of the comment editor bundle.
const Discussion = dynamic(() => import("../discussion.tsx"), { ssr: false });
// The window of the backdrop removal is read only when the owner opens it.
const BackgroundRemovalDialog = dynamic(
  () => import("../background-removal-dialog.tsx"),
  { ssr: false },
);
const rub = (v: string | number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(Number(v));

// The page of one bike, public and in the account (#291): the picture and the
// identity side by side as the header, then tabs (#366): the overview with the
// passport and the awards, the build, rides, the owner's entries and comments,
// one at a time.
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
  photoProblems,
  dismissPhotoProblems,
  setSelected,
  setModal,
  file,
  auth,
  run,
  refresh,
  setNotice,
}: {
  Main: MainElement;
  bike: BikeDto;
  share?: string;
  settings: Omit<SiteSettings, "componentsExpanded"> & UserPreferences;
  catalog: SiteCatalog;
  t: (text: string) => string;
  user: ViewerDto | null;
  editable: boolean;
  detailReaction: ReturnType<typeof useBikeReaction>;
  busy: boolean;
  photo: PublicPhoto | null;
  setPhoto: PhotoSetter;
  // Photos the owner tried to add and the site refused, shown at the button.
  photoProblems: PhotoProblem[];
  dismissPhotoProblems: () => void;
  setSelected: BikeSetter;
  setModal: ModalSetter;
  file: React.RefObject<HTMLInputElement | null>;
  auth: (mode?: "login" | "register") => void;
  run: Run;
  refresh: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  // The saved blocks switch parts of a fixed composition on and off.
  const layout = detailLayout(settings.detailBlocks);
  const modelName = [bike.brand, bike.model, bike.trim]
    .filter(Boolean)
    .join(" ");
  // A public build is counted on its model's page (#74); a private one only
  // leads to the search.
  const modelHref =
    bike.is_public && bike.catalog_model_id
      ? "/bike-models/" + bike.catalog_model_id
      : "/experience?" +
        new URLSearchParams({
          brand: bike.brand || "",
          model: bike.model || "",
        });
  const [rideTotal, setRideTotal] = useState<number | null>(null);
  // The photo whose backdrop is being taken off (#370).
  const [cutting, setCutting] = useState<PublicPhoto | null>(null);
  // Never retain a selected photo which was removed by a refreshed DTO.
  const activePhoto =
    bike.photos.find((p) => p.id === photo?.id) || bike.photos[0] || null;
  const panels = overviewPanels(
    bike,
    {
      showMileage: settings.showMileage,
      summaryFields: settings.summaryFields,
    },
    rub,
  );
  const actions = {
    bike,
    title: bike.name || modelName,
    editable,
    reaction: detailReaction,
    onFindPhoto: () => setModal({ type: "photoSearch" }),
    onAccess: () => setModal({ type: "share" }),
    onEdit: () => setModal({ type: "bike", bike }),
    onDelete: () => setModal({ type: "deleteBike" }),
    t,
  };
  // A visitor has nothing to read in an empty build; the owner has the
  // «add» actions there.
  const specifications =
    layout.specifications && (editable || bike.components.length > 0);
  // Only the tabs the viewer may read are there. The awards belong to the
  // overview: it stays for them when the description and the passport are off.
  const tabs = (
    [
      [
        panels.about || panels.passport || bike.is_public,
        "overview",
        t("Обзор"),
      ],
      [specifications, "specifications", t("Комплектация")],
      [bike.is_public, "bike-rides", t("Покатушки")],
      [bike.id !== "demo", "journal", t("Записи")],
      [bike.is_public, "discussion", t("Комментарии")],
    ] as const
  )
    .filter(([visible]) => visible)
    .map(([, id, label]) => ({ id, label }));
  const { active, select, list } = useBikeTab(tabs.map((tab) => tab.id));
  return (
    <>
      <Main className="detail bike-detail">
        <nav className="breadcrumbs" aria-label={t("Путь к велосипеду")}>
          {!share ? (
            <button
              className="quiet"
              onClick={() => {
                setSelected(null);
                setPhoto(null);
              }}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              {t("Мои велосипеды")}
            </button>
          ) : (
            <Link href="/bikes">{t("Велосипеды")}</Link>
          )}
          {bike.brand && (
            <>
              <ChevronRight size={14} aria-hidden="true" />
              <a
                href={experienceHref({ brand: bike.brand })}
                title="Опыт владельцев этой марки"
              >
                {bike.brand}
              </a>
            </>
          )}
          {bike.model && (
            <>
              <ChevronRight size={14} aria-hidden="true" />
              <a href={modelHref} title="Опыт владельцев этой модели">
                {[bike.model, bike.trim].filter(Boolean).join(" ")}
              </a>
            </>
          )}
        </nav>
        <div className="bike-hero">
          {(layout.photos || editable) && (
            <BikeGallery
              bike={bike}
              photo={activePhoto}
              thumbnails={layout.thumbnails}
              showPicture={layout.photos}
              editable={editable}
              busy={busy}
              t={t}
              onSelect={setPhoto}
              onOpen={() => {
                setPhoto(activePhoto);
                setModal({ type: "photoView" });
              }}
              onCover={(p) =>
                run(async () => {
                  await api(`bikes/${bike.id}/photos/${p.id}`, "PATCH");
                  await refresh();
                  setNotice(t("Обложка обновлена"));
                })
              }
              onDelete={(p) => setModal({ type: "deletePhoto", photo: p })}
              onAdd={() => file.current?.click()}
              onRemoveBackground={setCutting}
              onRestoreOriginal={(p) =>
                run(async () => {
                  const back = await api<{ id: string }>(
                    `bikes/${bike.id}/photos/${p.id}/background`,
                    "DELETE",
                  );
                  await refresh();
                  // The photo has a new ID: the one the person looks at stays.
                  setPhoto({ ...p, id: back.id, has_original: false });
                  setNotice(t("Исходное фото возвращено"));
                })
              }
              problems={photoProblems}
              onDismissProblems={dismissPhotoProblems}
              demoCredit={bike.id === "demo" && !settings.demoImageId}
            />
          )}
          <BikeIdentity
            bike={bike}
            catalog={catalog}
            actions={actions}
            metrics={layout.metrics}
            // The quote is the description: it follows the setting that
            // makes the description public.
            quote={layout.metrics && panels.about}
            specifications={specifications}
            rideTotal={rideTotal}
            likes={detailReaction.likes ?? bike.likes}
            onSection={(id) => select(id, true)}
            onRegister={
              !editable && !share ? () => auth("register") : undefined
            }
            t={t}
          />
        </div>
        <BikeTabList
          tabs={tabs}
          active={active}
          onSelect={(id) => select(id)}
          label={t("Разделы велосипеда")}
          listRef={list}
        />
        {/* The offer to tell about a changed build is seen in any tab. */}
        <JournalBuildPrompt bike={bike} editable={editable} />
        {tabs.some((tab) => tab.id === "overview") && (
          <BikeTabPanel id="overview" active={active === "overview"}>
            {(panels.about || panels.passport) && (
              <BikeOverview
                bike={bike}
                panels={panels}
                editable={editable}
                onEdit={actions.onEdit}
                t={t}
              />
            )}
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
          </BikeTabPanel>
        )}
        {specifications && (
          <BikeTabPanel
            id="specifications"
            active={active === "specifications"}
          >
            <BikeSpecifications
              bike={bike}
              catalog={catalog}
              editable={editable}
              rub={rub}
              t={t}
              onAdd={(section) => setModal({ type: "part", section })}
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
          </BikeTabPanel>
        )}
        {bike.is_public && (
          <BikeTabPanel id="bike-rides" active={active === "bike-rides"}>
            <RideList
              key={"rides:" + bike.id}
              bikeId={bike.id}
              latest
              preview
              compact
              onTotal={setRideTotal}
            />
          </BikeTabPanel>
        )}
        {/* Sibling keys must differ: with two equal keys React loses one
          fiber on update and leaves a stale copy of its DOM behind. */}
        {bike.id !== "demo" && (
          <BikeTabPanel id="journal" active={active === "journal"}>
            <JournalList
              key={"journal:" + bike.id}
              bike={bike}
              owner={bike.is_owner}
              preview
            />
          </BikeTabPanel>
        )}
        {bike.is_public && (
          <BikeTabPanel id="discussion" active={active === "discussion"}>
            <Discussion
              key={"discussion:" + bike.id}
              bike={bike}
              user={user}
              variant="panel"
              count={bike.comments}
            />
          </BikeTabPanel>
        )}
      </Main>
      {cutting && (
        <BackgroundRemovalDialog
          source={{
            kind: "photo",
            bikeId: bike.id,
            photoId: cutting.id,
            beforeUrl: `/api/photos/${cutting.id}?width=1280`,
          }}
          apply={async ({ preview }) => {
            const done = await api<{ id: string }>(
              `bikes/${bike.id}/photos/${cutting.id}/background`,
              "PUT",
              { previewId: preview.id },
            );
            await refresh();
            setPhoto({ ...cutting, id: done.id, has_original: true });
            setNotice(t("Фон удалён. Исходное фото сохранено."));
          }}
          onClose={() => setCutting(null)}
        />
      )}
    </>
  );
}
