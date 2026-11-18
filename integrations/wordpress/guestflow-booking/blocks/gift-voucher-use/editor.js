/**
 * « Utiliser un bon cadeau » block editor UI (build-free, plain ES — no JSX). Server-rendered: save() returns null.
 */
(function () {
  if (!window.wp || !wp.blocks) return;
  var el = wp.element.createElement;
  var __ = wp.i18n.__;
  var useBlockProps = wp.blockEditor.useBlockProps;

  wp.blocks.registerBlockType('guestflow/gift-voucher-use', {
    edit: function () {
      return el('div', useBlockProps(),
        el('div', { className: 'gf-block gf-editor-preview', style: { padding: '1rem', border: '1px dashed #c3c4c7', borderRadius: '8px' } },
          el('strong', {}, __('Utiliser un bon cadeau', 'guestflow-booking')),
          el('p', { style: { margin: '.5rem 0 0', color: '#6b7280' } },
            __('Le code du bon, le choix du créneau et la confirmation s’affichent ici sur le site.', 'guestflow-booking'))
        )
      );
    },
    save: function () { return null; },
  });
})();
