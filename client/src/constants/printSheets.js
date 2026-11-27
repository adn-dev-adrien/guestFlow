/**
 * The words and the choices of « Imprimer… » (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 22-27). The lists mirror the server's table of sheets
 * (`printLayout.js`); the server refuses anything else with the sentence the dialog shows under the field.
 */

export const PRINT_MODES = Object.freeze([
  Object.freeze({ value: 'recto-verso', label: 'Recto-verso' }),
  Object.freeze({ value: 'side-by-side', label: 'Côte à côte, à plier' }),
]);
export const PRINT_PER_SHEET = Object.freeze({ 'recto-verso': Object.freeze([1, 2, 4, 8]), 'side-by-side': Object.freeze([1, 2, 4]) });
export const PRINT_FLIPS = Object.freeze([
  Object.freeze({ value: 'left-right', label: 'De gauche à droite' }),
  Object.freeze({ value: 'top-bottom', label: 'De haut en bas' }),
]);
export const PRINT_PREVIEWED_PAGES = 4;

export const PRINT_TEXTS = Object.freeze({
  defaultTitle: 'Imprimer',
  submit: 'Télécharger le PDF',
  mode: 'Mode',
  perSheet: 'Cartes par feuille',
  count: 'Nombre de cartes',
  countHelp: 'De 1 à 200.',
  flip: 'Retournement de la feuille',
  flipHelp: 'Le geste qui retourne la feuille pour imprimer le verso.',
  preview: 'Aperçu',
  previewFailed: 'L’aperçu n’a pas pu être calculé.',
  printFailed: 'Le PDF n’a pas pu être préparé.',
  sheet: (number) => `Feuille ${number}`,
  pages: (count, shown) => `${count} page${count > 1 ? 's' : ''}${count > shown ? `, les ${shown} premières montrées` : ''}.`,
});
