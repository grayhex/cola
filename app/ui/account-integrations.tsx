"use client";
import type { AccountBikeDto } from "../../lib/contracts.ts";
import type { RideSettings, importGarmin } from "../../lib/rides.ts";
import type * as React from "react";
import { errorMessage } from "../../lib/errors.ts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import AccountSectionHead from "./account-section.tsx";
import ActivitySync from "./activity-sync.jsx";
import GarminImport from "./garmin-import.jsx";
import RideForm from "./ride-form.jsx";
import EmailPolicyAction from "./email-policy-action.tsx";
import { socialApi } from "./social-primitives.tsx";
import { selectableRideBikes } from "../../lib/bike-status.ts";

// «Интеграции и импорт» (#245): connecting sources and manual imports in one
// place, each a provider row — name, short helper, status, action — with the
// details opened on demand. Existing importers only; nothing new here.
function Row({
  id,
  title,
  helper,
  status,
  tone,
  action,
  children,
}: {
  id: string;
  title: string;
  helper: string;
  status: string;
  tone: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="integration-row" aria-labelledby={id} role="group">
      <div className="integration-copy">
        <h4 id={id}>{title}</h4>
        <p className="help">{helper}</p>
      </div>
      <span className="integration-status" data-tone={tone}>
        {status}
      </span>
      {action && <div className="integration-action">{action}</div>}
      {children}
    </div>
  );
}
export default function AccountIntegrations({
  bikes,
  onImported,
}: {
  bikes: AccountBikeDto[];
  onImported?: () => void;
}) {
  const [config, setConfig] = useState<RideSettings | null>(null),
    [open, setOpen] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const current = useMemo(() => selectableRideBikes(bikes), [bikes]);
  const action = useSearchParams()?.get("action") ?? null;
  const handled = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    socialApi<RideSettings>("rides/settings")
      .then((result) => {
        if (active) setConfig(result);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, []);
  // Deep links (old ?tab=rides&action=add|import are forwarded here) open
  // the matching importer once it can work.
  useEffect(() => {
    if (!["add", "import"].includes(action || "") || handled.current === action)
      return;
    if (!config?.enabled || !current.length) return;
    handled.current = action;
    setOpen(action);
  }, [action, config?.enabled, current.length]);
  function toggle(next: string) {
    const value = open === next ? null : next;
    setOpen(value);
    setNotice("");
    handled.current = value;
    const url = new URL(location.href);
    if (value) url.searchParams.set("action", value);
    else url.searchParams.delete("action");
    window.history.replaceState(null, "", url);
  }
  const unavailable = !config?.enabled || !current.length;
  const importButton = (kind: string, label: string) => (
    <button
      type="button"
      className="button secondary small"
      aria-expanded={open === kind}
      aria-controls={open === kind ? "integration-" + kind : undefined}
      disabled={unavailable}
      onClick={() => toggle(kind)}
    >
      {open === kind ? "Скрыть" : label}
    </button>
  );
  const done = (
    <Link className="text-link" href="/account?tab=rides">
      Мои покатушки
    </Link>
  );
  return (
    <section className="account-section" aria-labelledby="integrations-heading">
      <AccountSectionHead
        id="integrations-heading"
        title="Интеграции и импорт"
        helper="Подключённые сервисы и загрузка поездок с велокомпьютера. Новые поездки непубличные."
      />
      {error && (
        <p role="alert" className="error">
          {error}
          <EmailPolicyAction message={error} />
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice} {done}
        </p>
      )}
      {config && !config.enabled && (
        <p className="help">Загрузка покатушек временно выключена.</p>
      )}
      {config?.enabled && !current.length && (
        <p className="help">
          Импортированная поездка привязывается к текущему велосипеду.{" "}
          <Link className="text-link" href="/account?tab=bikes&action=add">
            Добавить велосипед
          </Link>
        </p>
      )}
      <div className="integrations">
        <ActivitySync bikes={bikes} onImported={onImported} />
        <section aria-labelledby="integration-garmin">
          <h3 id="integration-garmin">Garmin</h3>
          <div className="integration-list">
            <Row
              id="integration-garmin-csv"
              title="Garmin CSV"
              helper="Выгрузка занятий из Garmin Connect. Поездки сохранятся без треков, повторы пропускаются."
              status="Доступно"
              tone="ok"
              action={importButton("import", "Импортировать CSV")}
            >
              {open === "import" && (
                <div className="integration-detail" id="integration-import">
                  <GarminImport
                    bikes={current}
                    onCancel={() => toggle("import")}
                    onDone={async (
                      result: Awaited<ReturnType<typeof importGarmin>>,
                    ) => {
                      toggle("import");
                      setNotice(
                        `Импортировано: ${result.imported.length}. Уже загружены: ${result.skipped}.`,
                      );
                      onImported?.();
                    }}
                  />
                </div>
              )}
            </Row>
            {/* #225: no API access yet — a status, not a working switch. */}
            <Row
              id="integration-garmin-connect"
              title="Garmin Connect"
              helper="Автоматическая синхронизация появится, когда Garmin откроет доступ. Пока используйте CSV или файлы активности."
              status="Скоро"
              tone="muted"
            />
          </div>
        </section>
        <section aria-labelledby="integration-files">
          <h3 id="integration-files">Файлы активности</h3>
          <div className="integration-list">
            <Row
              id="integration-track"
              title="GPX / FIT / TCX"
              helper="Файл трека из велокомпьютера или приложения: посчитаем дистанцию, набор и скорость, скроем начало и конец по вашим настройкам."
              status={
                config
                  ? `До ${Math.round(config.maxGpxBytes / 1048576)} МБ`
                  : ""
              }
              tone="muted"
              action={importButton("add", "Загрузить файл")}
            >
              {open === "add" && config && (
                <div className="integration-detail" id="integration-add">
                  <RideForm
                    mode="add"
                    bikes={bikes}
                    config={config}
                    onCancel={() => toggle("add")}
                    onSaved={() => {
                      toggle("add");
                      setNotice("Покатушка сохранена.");
                      onImported?.();
                    }}
                  />
                </div>
              )}
            </Row>
          </div>
        </section>
      </div>
    </section>
  );
}
