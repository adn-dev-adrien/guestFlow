/**
 * Gift voucher block editor UI (build-free, plain ES — no JSX). Server-rendered: save() returns null.
 */
(function () {
  if (!window.wp || !wp.blocks) return;
  var el = wp.element.createElement;
  var __ = wp.i18n.__;
  var useBlockProps = wp.blockEditor.useBlockProps;

  wp.blocks.registerBlockType('guestflow/gift-voucher', {
    edit: function () {
      return el('div', useBlockProps(),
        el('div', { className: 'gf-block gf-editor-preview', style: { padding: '1rem', border: '1px dashed #c3c4c7', borderRadius: '8px' } },
          el('strong', {}, __('Bon cadeau GuestFlow', 'guestflow-booking')),
          el('p', { style: { margin: '.5rem 0 0', color: '#6b7280' } },
            __('Le formulaire d’achat s’affiche ici sur le site.', 'guestflow-booking'))
        )
      );
    },
    save: function () { return null; },
  });
})();
