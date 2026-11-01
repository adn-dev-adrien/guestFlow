/**
 * dialogDismissContext — lets content drawn inside an app dialog (`details` of `confirm` / `alert`, `content` of
 * `openForm`) close that dialog as « Annuler » would: `DialogProvider` provides it around that content.
 * `ConflictList` uses it so an « Ouvrir » that navigates in place does not leave the dialog over the next page
 * (specs/payment-link-lifecycle.md rules 39, 46). Outside a dialog the value is null.
 */
import { createContext, useContext } from 'react';

export const DialogDismissContext = createContext(null);

export function useDialogDismiss() {
  return useContext(DialogDismissContext);
}
