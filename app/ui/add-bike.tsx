"use client";
import type * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { addBikeHref } from "../../lib/navigation.ts";
import { useSite } from "./site-provider.tsx";

// «Добавить велосипед» from anywhere (#378): the wizard opens over the page
// the rider is on, no trip to the account first. One host for the whole site;
// the wizard's code (the same `BikeWizard` the account uses) loads on the first
// request, and a failed load is told in place with a retry, the page stays.
type Created = (bikeId: string) => void;
interface AddBike {
  /** Opens the wizard over the current page; `onCreated` hears of a new bike. */
  open: (options?: { onCreated?: Created }) => void;
  /** The wizard's code is on its way: a second request waits. */
  loading: boolean;
}
const loadDialog = () => import("./add-bike-dialog.tsx");
const AddBikeContext = createContext<AddBike | null>(null);

export function AddBikeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"idle" | "loading" | "failed" | "open">(
    "idle",
  );
  const loaded = useRef<Awaited<ReturnType<typeof loadDialog>> | null>(null);
  const created = useRef<Created | undefined>(undefined);
  const busy = useRef(false);
  const open = useCallback((options?: { onCreated?: Created }) => {
    if (busy.current) return;
    created.current = options?.onCreated;
    if (loaded.current) {
      setState("open");
      return;
    }
    busy.current = true;
    setState("loading");
    loadDialog().then(
      (chunk) => {
        busy.current = false;
        loaded.current = chunk;
        setState("open");
      },
      () => {
        busy.current = false;
        setState("failed");
      },
    );
  }, []);
  const api = useMemo(
    () => ({ open, loading: state === "loading" }),
    [open, state],
  );
  const Dialog = state === "open" ? loaded.current?.default : null;
  return (
    <AddBikeContext.Provider value={api}>
      {children}
      {Dialog && (
        <Dialog
          onClose={() => setState("idle")}
          onCreated={(id) => created.current?.(id)}
        />
      )}
      {state === "loading" && (
        <p role="status" className="add-bike-status">
          Открываем мастер…
        </p>
      )}
      {state === "failed" && (
        <div role="alert" className="add-bike-status">
          <span>
            Не удалось открыть мастер. Проверьте соединение и попробуйте ещё
            раз.
          </span>
          <button
            type="button"
            className="button small"
            onClick={() => open({ onCreated: created.current })}
          >
            Повторить
          </button>
          <button
            type="button"
            className="quiet small"
            onClick={() => setState("idle")}
          >
            Закрыть
          </button>
        </div>
      )}
    </AddBikeContext.Provider>
  );
}
/** The host's request; without a host (a test page, an old tree) it is a plain link. */
export function useAddBike(): AddBike {
  return (
    useContext(AddBikeContext) || {
      open: () => window.location.assign(addBikeHref),
      loading: false,
    }
  );
}
const plain = (event: React.MouseEvent) =>
  event.button !== 0 ||
  event.metaKey ||
  event.ctrlKey ||
  event.shiftKey ||
  event.altKey;
/**
 * A link «Добавить велосипед». For a signed-in rider on any page but the
 * account it opens the wizard over the page; a new window, a middle click, a
 * guest and the account itself keep the address (the account opens its own
 * wizard in place, and refreshes its list).
 */
export function AddBikeLink({
  onCreated,
  onClick,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "href"> & {
  onCreated?: Created;
}) {
  const add = useAddBike();
  const { viewer } = useSite();
  const pathname = usePathname();
  return (
    <Link
      {...props}
      href={addBikeHref}
      // Intercepted for a signed-in rider: nothing to fetch ahead.
      prefetch={false}
      aria-busy={add.loading || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || plain(event)) return;
        if (!viewer || pathname === "/account") return;
        event.preventDefault();
        add.open({ onCreated });
      }}
    >
      {children}
    </Link>
  );
}
