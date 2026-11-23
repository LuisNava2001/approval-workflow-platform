import { useCallback, useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/** Load data on mount and whenever `key` changes; `reload` re-runs the loader. */
export function useAsync<T>(loader: () => Promise<T>, key: string): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loader()
      .then((value) => {
        if (!active) return;
        setData(value);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason : new Error(String(reason)));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // `key` stands for the loader's inputs, so the loader itself is intentionally not a dependency.
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, error, loading, reload };
}
