/**
 * Booking block editor UI (build-free, plain ES — no JSX). Server-rendered: save() returns null.
 */
(function () {
  if (!window.wp || !wp.blocks) return;
  var el = wp.element.createElement;
  var __ = wp.i18n.__;
  var useBlockProps = wp.blockEditor.useBlockProps;
  var InspectorControls = wp.blockEditor.InspectorControls;
  var PanelBody = wp.components.PanelBody;
  var TextControl = wp.components.TextControl;
  var ToggleControl = wp.components.ToggleControl;

  wp.blocks.registerBlockType('guestflow/booking', {
    edit: function (props) {
      var a = props.attributes;
      return el('div', useBlockProps(),
        el(InspectorControls, {},
          el(PanelBody, { title: __('Réglages de la demande', 'guestflow-booking'), initialOpen: true },
            el(TextControl, {
              label: __('ID du logement (0 = défaut / ?property=)', 'guestflow-booking'),
              type: 'number', value: a.propertyId || 0,
              onChange: function (v) { props.setAttributes({ propertyId: parseInt(v, 10) || 0 }); },
            }),
            el(ToggleControl, {
              label: __('Proposer les options', 'guestflow-booking'),
              checked: a.showOptions !== false,
              onChange: function (v) { props.setAttributes({ showOptions: !!v }); },
            }),
            el(ToggleControl, {
              label: __('Paiement en ligne (séjour réglé en totalité, dates bloquées au paiement)', 'guestflow-booking'),
              checked: !!a.payOnline,
              onChange: function (v) { props.setAttributes({ payOnline: !!v }); },
            })
          )
        ),
        el('div', { className: 'gf-block gf-editor-preview', style: { padding: '1rem', border: '1px dashed #c3c4c7', borderRadius: '8px' } },
          el('strong', {}, '📝 ' + __('Devis & demande de réservation GuestFlow', 'guestflow-booking')),
          el('p', { style: { margin: '.5rem 0 0', color: '#6b7280' } },
            a.propertyId ? (__('Logement', 'guestflow-booking') + ' #' + a.propertyId) : __('Logement par défaut / ?property=ID', 'guestflow-booking'))
        )
      );
    },
    save: function () { return null; },
  });
})();
