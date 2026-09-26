"use client";
import dynamic from "next/dynamic";
import { publicPath } from "../../../lib/public-urls.js";
import EmailPolicyAction from "../email-policy-action.jsx";
import Photo from "../bike-photo.jsx";
import AuthWindow from "../auth-window.jsx";
import { Globe, Lock, Copy } from "../icons.jsx";
import Modal from "./modal.jsx";
import BikeForm from "./bike-form.jsx";
import PartForm from "./part-form.jsx";
import api from "./api.js";

// Keep the existing demand-loaded boundaries for forms and owner tools.
const AuthForm = dynamic(() => import("../auth-form.jsx"), { ssr: false });
const PhotoSearch = dynamic(() => import("../photo-search.jsx"), { ssr: false });
const BikeWizard = dynamic(() => import("../bike-wizard.jsx"), { ssr: false });

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
}) {
  return (
    <Modal
      title={
        {
          profile: "Личный кабинет",
          auth:
            modal.mode === "register"
              ? t("Регистрация")
              : t("С возвращением"),
          bike: modal.bike ? t("О велосипеде") : t("Новый велосипед"),
          part: modal.part
            ? t("Изменить деталь")
            : modal.section === "build"
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
          {error}<EmailPolicyAction message={error} />
        </div>
      )}
      {modal.type === "photoView" && (
        <Photo bike={bike} photo={photo} className="full-photo" full />
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
          bike={bike}
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
            const { bike: b } = await api("bikes/" + id);
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
              const result = await api(
                "bikes" + (modal.bike ? "/" + modal.bike.id : ""),
                modal.bike ? "PATCH" : "POST",
                data,
              );
              let factoryWarning = false;
              if (data.importFactory) {
                try {
                  const imported = await api(
                    "bikes/" +
                      (modal.bike?.id || result.id) +
                      "/factory-spec",
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
                const { bike: b } = await api("bikes/" + result.id);
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
                `bikes/${bike.id}/components` +
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
            {bike.is_public ? <Globe size={26} /> : <Lock size={26} />}
            <div>
              <h3>
                {bike.is_public
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
            className={"button " + (bike.is_public ? "secondary" : "")}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api(`bikes/${bike.id}/share`, "PATCH", {
                  is_public: !bike.is_public,
                });
                await refresh();
              })
            }
          >
            {bike.is_public
              ? t("Закрыть доступ")
              : t("Опубликовать на витрине")}
          </button>
          {bike.is_public && (
            <div className="share-copy">
              <input
                readOnly
                aria-label={t("Публичная ссылка")}
                value={
                  typeof window !== "undefined"
                    ? window.location.origin + publicPath("bike", bike)
                    : ""
                }
              />
              <button
                className="icon bordered"
                aria-label={t("Скопировать ссылку")}
                onClick={() =>
                  run(async () => {
                    await navigator.clipboard.writeText(
                      window.location.origin + publicPath("bike", bike),
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
                  let url = "bikes/" + bike.id;
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
