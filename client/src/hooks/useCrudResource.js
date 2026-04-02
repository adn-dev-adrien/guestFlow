import { useCallback, useState } from 'react';

export default function useCrudResource({ listFn, createFn, updateFn, deleteFn }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastArgs, setLastArgs] = useState([]);

  const reload = useCallback(async (...args) => {
    setLoading(true);
    setError('');
    try {
      setLastArgs(args);
      const data = await listFn(...args);
      setItems(Array.isArray(data) ? data : []);
      return data;
    } catch (e) {
      setError(e.message || 'Erreur de chargement');
      throw e;
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  const createItem = useCallback(async (payload, ...reloadArgs) => {
    setError('');
    const created = await createFn(payload);
    await reload(...(reloadArgs.length ? reloadArgs : lastArgs));
    return created;
  }, [createFn, reload, lastArgs]);

  const updateItem = useCallback(async (id, payload, ...reloadArgs) => {
    setError('');
    const updated = await updateFn(id, payload);
    await reload(...(reloadArgs.length ? reloadArgs : lastArgs));
    return updated;
  }, [updateFn, reload, lastArgs]);

  const removeItem = useCallback(async (id, ...reloadArgs) => {
    setError('');
    const deleted = await deleteFn(id);
    await reload(...(reloadArgs.length ? reloadArgs : lastArgs));
    return deleted;
  }, [deleteFn, reload, lastArgs]);

  return {
    items,
    setItems,
    loading,
    error,
    reload,
    createItem,
    updateItem,
    removeItem,
  };
}
