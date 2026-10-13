"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ArticleDto,
  ArticleSaved,
  JournalDraft,
  JournalDto,
  JournalSaved,
  ListingDraft,
  MarketDto,
  MarketSaved,
} from "./content-types.ts";

interface Drafts {
  article: {
    form: { title: string; body: string; topicId: string };
    record: ArticleSaved | null;
    photos: ArticleDto["photos"];
    dirty: boolean;
  };
  journal: {
    form: JournalDraft;
    files: File[];
    saved: (JournalSaved & Partial<JournalDto>) | null;
  };
  market: {
    form: ListingDraft;
    identity: MarketSaved | MarketDto | null | undefined;
    photos: MarketDto["photos"];
  };
}
type Snapshot<K extends keyof Drafts> = Drafts[K] & { error?: string };
type Stores = { [K in keyof Drafts]: Map<string, Snapshot<K>> };
const Context = createContext<{
  stores: Stores;
  tasks: Map<string, Promise<void>>;
} | null>(null);

// Survives client navigation and Back, but never a document unload. No storage,
// server/global cache or draft publication. A changed owner gets fresh maps.
export function ContentDraftProvider({
  ownerId,
  children,
}: {
  ownerId: string | null;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({
      ownerId,
      tasks: new Map<string, Promise<void>>(),
      stores: {
        article: new Map<string, Snapshot<"article">>(),
        journal: new Map<string, Snapshot<"journal">>(),
        market: new Map<string, Snapshot<"market">>(),
      },
    }),
    [ownerId],
  );
  return (
    <Context.Provider key={ownerId || "guest"} value={value}>
      {children}
    </Context.Provider>
  );
}

export function useContentDraft<K extends keyof Drafts>(kind: K, key: string) {
  const context = useContext(Context);
  if (!context) throw new Error("ContentDraftProvider is required");
  const cache: Map<string, Snapshot<K>> = context.stores[kind];
  const token = kind + ":" + key;
  const [pending] = useState(() => context.tasks.get(token));
  const [restored] = useState(() => cache.get(key));
  const forgotten = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const read = useCallback(() => cache.get(key), [cache, key]);
  const isMounted = useCallback(() => mounted.current, []);
  const begin = () => {
    let done = () => {};
    const task = new Promise<void>((resolve) => {
      done = resolve;
    });
    context.tasks.set(token, task);
    return () => {
      context.tasks.delete(token);
      done();
    };
  };
  const remember = useCallback(
    (draft: Snapshot<K> | undefined) => {
      if (forgotten.current) return;
      if (draft) cache.set(key, draft);
      else cache.delete(key);
    },
    [cache, key],
  );
  const forget = useCallback(() => {
    forgotten.current = true;
    cache.delete(key);
  }, [cache, key]);
  return { restored, remember, forget, pending, read, begin, isMounted };
}
