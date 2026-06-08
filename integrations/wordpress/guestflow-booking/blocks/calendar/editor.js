/**
 * Calendar block editor UI (build-free, plain ES via wp.element.createElement — no JSX).
 * Server-rendered block: save() returns null. Attributes come from block.json.
 */
(function () {
  if (!window.wp || !wp.blocks) return;
  var el = wp.element.createElement;
  var __ = wp.i18n.__;
  var useBlockProps = wp.blockEditor.useBlockProps;
  var InspectorControls = wp.blockEditor.InspectorControls;
  var PanelBody = wp.components.PanelBody;
  var TextControl = wp.components.TextControl;
  var RangeControl = wp.components.RangeControl;

  wp.blocks.registerBlockType('guestflow/calendar', {
    edit: function (props) {
      var a = props.attributes;
      return el('div', useBlockProps(),
        el(InspectorControls, {},
          el(PanelBody, { title: __('Réglages du calendrier', 'guestflow-booking'), initialOpen: true },
            el(TextControl, {
              label: __('ID du logement (0 = défaut)', 'guestflow-booking'),
              type: 'number', value: a.propertyId || 0,
              onChange: function (v) { props.setAttributes({ propertyId: parseInt(v, 10) || 0 }); },
            }),
            el(RangeControl, {
              label: __('Mois affichés', 'guestflow-booking'),
              min: 1, max: 3, value: a.monthsToShow || 2,
              onChange: function (v) { props.setAttributes({ monthsToShow: v }); },
            })
          )
        ),
        el('div', { className: 'gf-block gf-editor-preview', style: { padding: '1rem', border: '1px dashed #c3c4c7', borderRadius: '8px' } },
          el('strong', {}, '📅 ' + __('Calendrier de disponibilités GuestFlow', 'guestflow-booking')),
          el('p', { style: { margin: '.5rem 0 0', color: '#6b7280' } },
            a.propertyId ? (__('Logement', 'guestflow-booking') + ' #' + a.propertyId) : __('Logement par défaut', 'guestflow-booking'))
        )
      );
    },
    save: function () { return null; },
  });
})();
