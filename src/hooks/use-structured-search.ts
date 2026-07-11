/**
 * @fileoverview Structured card-search hook (issue #1440).
 *
 * Wraps the existing `useSearchWorker` search API to translate a
 * Scryfall-style query string (`c:red t:instant cmc<=3`) into the
 * matching Orama `where` clause plus a leftover fuzzy `term`.
 *
 * Returns `{ results, parsed, isSearching }` so the consumer can
 * (a) display parse errors inline, (b) show a syntax-help tooltip
 * listing the supported keys, and (c) keep the same UX as the existing
 * fuzzy search when the query doesn't contain structured keys.
 *
 * The hook is intentionally thin — it does not own the index. The
 * `useSearchWorker` client transparently falls back to the main-thread
 * `cardSearchIndex` when the worker is unavailable, so this hook
 * stays correct in jsdom, SSR, and CSP-blocked contexts without any
 * branching.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchWorker } from "./use-search-worker";
import {
  parseCardQuery,
  type ParsedQuery,
  type QueryParseError,
} from "@/lib/search/query-parser";

export interface UseStructuredSearchOptions {
  /** Pagination size forwarded to the worker / index. Defaults to 40. */
  limit?: number;
  /** Skip the search call when the query is empty/whitespace. Default true. */
  skipEmpty?: boolean;
  /**
   * Override debounce window in ms. Defaults to 200 (faster than the
   * 300ms of the fuzzy search because the structured query tends to be
   * composed deliberately, not typed character-by-character).
   */
  debounceMs?: number;
}

export interface UseStructuredSearchResult {
  /**
   * `{ id, name }` hits returned by the underlying search. The shape
   * matches `useSearchWorker`'s return type — the consumer calls
   * `toMinimalCard()` on each hit to obtain a `MinimalCard`.
   */
  results: { id: string; name: string }[];
  /** Parsed query AST. Always populated after the first parse. */
  parsed: ParsedQuery;
  /** The most recent parse errors for the input query. */
  errors: QueryParseError[];
  /**
   * `true` when an in-flight search is pending. Use this for the same
   * skeleton UX the fuzzy path uses today.
   */
  isSearching: boolean;
  /**
   * Trigger a query. The default `useStructuredSearch` hook debounces
   * internally (returning `void` after kicking off the timer); use
   * `useStructuredSearchImmediate` if you need to await the result.
   */
  run: (query: string) => void | Promise<void>;
}

export function useStructuredSearch(
  options: UseStructuredSearchOptions = {},
): UseStructuredSearchResult {
  const { limit = 40, skipEmpty = true, debounceMs = 200 } = options;
  const { search } = useSearchWorker();

  const [parsed, setParsed] = useState<ParsedQuery>(() => parseCardQuery(""));
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const mountedRef = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

    const run = useCallback(
      async (q: string) => {
        const next = parseCardQuery(q);
        setParsed(next);

        if (skipEmpty && q.trim() === "") {
          setResults([]);
          setIsSearching(false);
          return;
        }

        const seq = ++seqRef.current;
        setIsSearching(true);
        try {
          // We pass `next.term` (the leftover free-text) plus
          // `next.where` so the index applies both layers. An empty
          // `term` is valid — Orama returns all documents matching the
          // `where` clause in that case.
          const hits = await search(next.term, {
            where: next.where,
            limit,
          });
          if (mountedRef.current && seq === seqRef.current) {
            setResults(hits);
          }
        } catch (err) {
          console.warn("[useStructuredSearch] search failed:", err);
          if (mountedRef.current && seq === seqRef.current) {
            setResults([]);
          }
        } finally {
          if (mountedRef.current && seq === seqRef.current) {
            setIsSearching(false);
          }
        }
      },
      [search, skipEmpty, limit],
    );

  // Debounced invocation of `run` whenever the consumer passes a new
  // query. The consumer can also call `run` directly to skip the
  // debounce (used by the "fill from external trigger" pathway).
  const debouncedRun = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void run(q);
      }, debounceMs);
    },
    [run, debounceMs],
  );

  return {
    results,
    parsed,
    errors: parsed.errors,
    isSearching,
    run: debouncedRun,
  };
}

/**
 * Imperative variant for components that want full control of when the
 * search is triggered. Use this from `useEffect` blocks that already
 * react to the input value. Returns the same shape minus the debouncer.
 */
export function useStructuredSearchImmediate(
  options: { limit?: number; skipEmpty?: boolean } = {},
): UseStructuredSearchResult & { runNow: (query: string) => Promise<void> } {
  const { limit = 40, skipEmpty = true } = options;
  const { search } = useSearchWorker();
  const [parsed, setParsed] = useState<ParsedQuery>(() => parseCardQuery(""));
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const mountedRef = useRef(true);
  const seqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runNow = useCallback(
    async (q: string) => {
      const next = parseCardQuery(q);
      setParsed(next);
      if (skipEmpty && q.trim() === "") {
        setResults([]);
        return;
      }
      const seq = ++seqRef.current;
      setIsSearching(true);
      try {
        const hits = await search(next.term, {
          where: next.where,
          limit,
        });
        if (mountedRef.current && seq === seqRef.current) setResults(hits);
      } catch (err) {
        console.warn("[useStructuredSearchImmediate] search failed:", err);
        if (mountedRef.current && seq === seqRef.current) setResults([]);
      } finally {
        if (mountedRef.current && seq === seqRef.current) setIsSearching(false);
      }
    },
    [search, skipEmpty, limit],
  );

  return {
    results,
    parsed,
    errors: parsed.errors,
    isSearching,
    run: runNow,
    runNow,
  };
}
