"use client";
import type * as React from "react";
import type {
  BikeDto,
  ViewerDto,
  PublicPhoto,
} from "../../../lib/contracts.ts";
import type {
  BikeSetter,
  PhotoSetter,
  ModalSetter,
  Run,
  GarageModalState,
} from "./types.ts";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import dynamic from "next/dynamic";
import { publicPath } from "../../../lib/public-urls.ts";
import EmailPolicyAction from "../email-policy-action.tsx";
import Photo from "../bike-photo.tsx";
import AuthWindow from "../auth-window.tsx";
import { Globe, Lock, Copy } from "../icons.tsx";
import Modal from "./modal.tsx";
import BikeForm from "./bike-form.tsx";
import PartForm from "./part-form.tsx";
import api from "./api.ts";

// Keep the existing demand-loaded boundaries for forms and owner tools.
const AuthForm = dynamic(() => import("../auth-form.tsx"), { ssr: false });
const PhotoSearch = dynamic(() => import("../photo-search.tsx"), {
  ssr: false,
});
const BikeWizard = dynamic(() => import("../bike-wizard.tsx"), { ssr: false });

export default function GarageModal({
  modal,
  bike,
  photo,
  t,
  busy,
  error,
  close,
  setError,
  setModal,
  run,
  refreshViewer,
  setSelected,
  setNotice,
  refresh,
  setDirty,
  setBusy,
  account,
  router,
  openBike,
  share,
  setPhoto,
}: {
  modal: GarageModalState;
  bike: BikeDto | null;
  photo: PublicPhoto | null;
  t: (text: string) => string;
  busy: boolean;
  error: string;
  close: () => Promise<void>;
  setError: (message: string) => void;
  setModal: ModalSetter;
  run: Run;
  refreshViewer: () => Promise<ViewerDto | null>;
  setSelected: BikeSetter;
  setNotice: (message: string) => void;
  refresh: () => Promise<void>;
  setDirty: (dirty: boolean) => void;
  setBusy: (busy: boolean) => void;
  account: boolean;
  router: AppRouterInstance;
  openBike: (bike: BikeDto) => void;
  share?: string;
  setPhoto: PhotoSetter;
}) {
  // Bike-dependent windows are opened from a selected bike. Creation/auth do
  // not read this snapshot. Keep the selection invariant at the UI boundary.
  const selectedBike = bike!;
  const editedBike = modal.type === "bike" ? modal.bike : undefined;
  const editedPart = modal.type === "part" ? modal.part : undefined;
  const mode = modal.type === "auth" ? modal.mode : "login";
  const section = modal.type === "part" ? modal.section : "build";
  return (
    <Modal
      title={
        {
          profile: "Личный кабинет",
          auth: mode === "register" ? t("Регистрация") : t("С возвращением"),
          bike: editedBike ? t("О велосипеде") : t("Новый велосипед"),
          part: editedPart
            ? t("Изменить деталь")
            : section === "build"
              ? t("Добавить компонент")
              : t("Добавить аксессуар"),
          share: t("Доступ к велосипеду"),
          photoSearch: "Выбор фотографий",
          photoView: t("Фотография велосипеда"),
          deleteBike: t("Удалить велосипед?"),
          deletePart: t("Удалить деталь?"),
          deletePhoto: t("Удалить фотографию?"),
        }[modal.type]
      }
      onClose={close}
      dismissible={modal.type !== "bike" || !!modal.bike}
    >
      {error && (
        <div className="error" role="alert">
          {error}
          <EmailPolicyAction message={error} />
        </div>
      )}
      {modal.type === "photoView" && (
        <Photo bike={selectedBike} photo={photo} className="full-photo" full />
      )}
      {modal.type === "auth" && (
        <AuthWindow mode={modal.mode}>
          <AuthForm
            mode={modal.mode}
            busy={busy}
            switchMode={() => {
              setError("");
              setModal({
                ...modal,
                mode: modal.mode === "login" ? "register" : "login",
              });
            }}
            onSubmit={(data) =>
              run(async () => {
                await api("auth/" + modal.mode, "POST", data);
                await refreshViewer();
                setSelected(null);
                setModal(null);
                setNotice(
                  modal.mode === "register"
                    ? t("Аккаунт готов. Добавьте свой первый байк.")
                    : t("Добро пожаловать"),
                );
              })
            }
          />
        </AuthWindow>
      )}
      {modal.type === "photoSearch" && (
        <PhotoSearch
          bike={selectedBike}
          onDone={async () => {
            await refresh();
            setModal(null);
            setNotice("Фотографии добавлены");
          }}
        />
      )}
      {modal.type === "bike" && !modal.bike && (
        <BikeWizard
          onDirtyChange={setDirty}
          onBusy={setBusy}
          onCreated={async (id) => {
            if (!account) {
              router.push("/account");
              return;
            }
            await refresh();
            const { bike: b } = await api<{ bike: BikeDto }>("bikes/" + id);
            openBike(b);
            setModal(null);
            setDirty(false);
            setNotice("Велосипед сохранён");
          }}
        />
      )}
      {modal.type === "bike" && modal.bike && (
        <BikeForm
          initial={modal.bike}
          busy={busy}
          onSubmit={(data) =>
            run(async () => {
              const result = await api<{ id: string }>(
                "bikes" + (modal.bike ? "/" + modal.bike!.id : ""),
                modal.bike ? "PATCH" : "POST",
                data,
              );
              let factoryWarning = false;
              if (data.importFactory) {
                try {
                  const imported = await api<{ status: string }>(
                    "bikes/" + (modal.bike?.id || result.id) + "/factory-spec",
                    "POST",
                    {
                      sourceUrl: data.factorySourceUrl,
                      candidateId: data.factoryCandidateId,
                      initializeCurrent: data.initializeCurrent === true,
                    },
                  );
                  factoryWarning = imported.status !== "resolved";
                } catch {
                  factoryWarning = true;
                }
              }
              await refresh();
              if (!modal.bike) {
                const { bike: b } = await api<{ bike: BikeDto }>(
                  "bikes/" + result.id,
                );
                openBike(b);
              }
              setModal(modal.bike ? null : { type: "photoSearch" });
              setNotice(
                factoryWarning
                  ? t(
                      "Велосипед сохранён. Заводскую комплектацию импортировать не удалось; повторите поиск позже.",
                    )
                  : t("Велосипед сохранён"),
              );
            })
          }
        />
      )}
      {modal.type === "part" && (
        <PartForm
          initial={modal.part}
          section={modal.section}
          busy={busy}
          onDirtyChange={setDirty}
          onSubmit={(data) =>
            run(async () => {
              await api(
                `bikes/${selectedBike.id}/components` +
                  (modal.part ? "/" + modal.part.id : ""),
                modal.part ? "PATCH" : "POST",
                data,
              );
              await refresh();
              setModal(null);
              setDirty(false);
              setNotice(t("Деталь сохранена"));
            })
          }
        />
      )}
      {modal.type === "share" && (
        <div className="share-form">
          <div className="share-status">
            {selectedBike.is_public ? <Globe size={26} /> : <Lock size={26} />}
            <div>
              <h3>
                {selectedBike.is_public
                  ? t("Опубликован на витрине")
                  : t("Личный велосипед")}
              </h3>
              <p>
                {t(
                  "Публичный велосипед виден всем на витрине. Почта скрыта; цены видны только при включённом отображении.",
                )}
              </p>
            </div>
          </div>
          <button
            className={"button " + (selectedBike.is_public ? "secondary" : "")}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api(`bikes/${selectedBike.id}/share`, "PATCH", {
                  is_public: !selectedBike.is_public,
                });
                await refresh();
              })
            }
          >
            {selectedBike.is_public
              ? t("Закрыть доступ")
              : t("Опубликовать на витрине")}
          </button>
          {selectedBike.is_public && (
            <div className="share-copy">
              <input
                readOnly
                aria-label={t("Публичная ссылка")}
                value={
                  typeof window !== "undefined"
                    ? window.location.origin + publicPath("bike", selectedBike)
                    : ""
                }
              />
              <button
                className="icon bordered"
                aria-label={t("Скопировать ссылку")}
                onClick={() =>
                  run(async () => {
                    await navigator.clipboard.writeText(
                      window.location.origin + publicPath("bike", selectedBike),
                    );
                    setNotice(t("Ссылка скопирована"));
                  })
                }
              >
                <Copy size={18} />
              </button>
            </div>
          )}
          <p className="help">
            {t("После закрытия доступа старая ссылка перестанет работать.")}
          </p>
        </div>
      )}
      {modal.type.startsWith("delete") && (
        <div>
          <p className="delete-text">
            {modal.type === "deleteBike"
              ? t(
                  "Велосипед, все его фотографии и детали будут удалены без возможности восстановления.",
                )
              : modal.type === "deletePart"
                ? `«${modal.part.name}» будет удалён из актуальной конфигурации.`
                : t("Фотография будет удалена из галереи.")}
          </p>
          <div className="form-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={close}
            >
              {t("Отмена")}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  let url = "bikes/" + selectedBike.id;
                  if (modal.type === "deletePart")
                    url += "/components/" + modal.part.id;
                  if (modal.type === "deletePhoto")
                    url += "/photos/" + modal.photo.id;
                  await api(url, "DELETE");
                  if (modal.type === "deleteBike") {
                    setSelected(null);
                    if (share) {
                      setModal(null);
                      router.replace("/account?tab=bikes");
                      return;
                    }
                  }
                  setPhoto(null);
                  await refresh();
                  setModal(null);
                  setNotice(t("Удалено"));
                })
              }
            >
              {busy ? t("Удаляем…") : t("Удалить")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
