import { useCallback, useRef, useState } from 'react';

export default function useCrudResource({ listFn, createFn, updateFn, deleteFn }) {
  const listRef = useRef(listFn);
  const createRef = useRef(createFn);
  const updateRef = useRef(updateFn);
  const deleteRef = useRef(deleteFn);
  listRef.current = listFn;
  createRef.current = createFn;
  updateRef.current = updateFn;
  deleteRef.current = deleteFn;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const lastArgsRef = useRef([]);

  const reload = useCallback(async (...args) => {
    setLoading(true);
    setError('');
    try {
      lastArgsRef.current = args;
      const data = await listRef.current(...args);
      setItems(Array.isArray(data) ? data : []);
      return data;
    } catch (e) {
      setError(e.message || 'Erreur de chargement');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const createItem = useCallback(async (payload, ...reloadArgs) => {
    setError('');
    const created = await createRef.current(payload);
    await reload(...(reloadArgs.length ? reloadArgs : lastArgsRef.current));
    return created;
  }, [reload]);

  const updateItem = useCallback(async (id, payload, ...reloadArgs) => {
    setError('');
    const updated = await updateRef.current(id, payload);
    await reload(...(reloadArgs.length ? reloadArgs : lastArgsRef.current));
    return updated;
  }, [reload]);

  const removeItem = useCallback(async (id, ...reloadArgs) => {
    setError('');
    const deleted = await deleteRef.current(id);
    await reload(...(reloadArgs.length ? reloadArgs : lastArgsRef.current));
    return deleted;
  }, [reload]);

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
