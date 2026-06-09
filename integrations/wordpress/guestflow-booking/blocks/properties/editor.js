/**
 * Properties block editor UI (build-free, plain ES — no JSX). Server-rendered: save() returns null.
 */
(function () {
  if (!window.wp || !wp.blocks) return;
  var el = wp.element.createElement;
  var __ = wp.i18n.__;
  var useBlockProps = wp.blockEditor.useBlockProps;
  var InspectorControls = wp.blockEditor.InspectorControls;
  var PanelBody = wp.components.PanelBody;
  var RangeControl = wp.components.RangeControl;
  var TextControl = wp.components.TextControl;

  wp.blocks.registerBlockType('guestflow/properties', {
    edit: function (props) {
      var a = props.attributes;
      return el('div', useBlockProps(),
        el(InspectorControls, {},
          el(PanelBody, { title: __('Réglages de la liste', 'guestflow-booking'), initialOpen: true },
            el(RangeControl, {
              label: __('Colonnes', 'guestflow-booking'),
              min: 2, max: 4, value: a.columns || 3,
              onChange: function (v) { props.setAttributes({ columns: v }); },
            }),
            el(TextControl, {
              label: __('URL de la page de réservation', 'guestflow-booking'),
              help: __('Vide = valeur des réglages. Les cartes ajoutent ?property=ID.', 'guestflow-booking'),
              type: 'url', value: a.bookingPageUrl || '',
              onChange: function (v) { props.setAttributes({ bookingPageUrl: v }); },
            })
          )
        ),
        el('div', { className: 'gf-block gf-editor-preview', style: { padding: '1rem', border: '1px dashed #c3c4c7', borderRadius: '8px' } },
          el('strong', {}, '🏠 ' + __('Liste des logements GuestFlow', 'guestflow-booking')),
          el('p', { style: { margin: '.5rem 0 0', color: '#6b7280' } }, __('Cartes (nom, capacité, à partir de X €/nuit).', 'guestflow-booking'))
        )
      );
    },
    save: function () { return null; },
  });
})();
