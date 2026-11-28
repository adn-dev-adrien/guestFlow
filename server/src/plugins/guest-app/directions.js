/**
 * The links behind every « Itinéraire » of the guest app (specs/guest-app/guest-app-local-amenities.md rule 7, booklet rule 18
 * `place`). Pure. The destination is the coordinates, or the address when a booklet place has no coordinates.
 * `google` is the web URL (it opens the installed navigation app on Android and works anywhere); `googleApp` and
 * `appleApp` are the URL schemes the app tries on Apple devices, Google Maps first, then Plans.
 */
function directionsLinks({ lat, lng, address }) {
  const target = Number.isFinite(lat) && Number.isFinite(lng) ? `${lat},${lng}` : encodeURIComponent(address);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${target}&travelmode=driving`,
    googleApp: `comgooglemaps://?daddr=${target}&directionsmode=driving`,
    appleApp: `maps://?daddr=${target}&dirflg=d`,
  };
}

module.exports = { directionsLinks };
