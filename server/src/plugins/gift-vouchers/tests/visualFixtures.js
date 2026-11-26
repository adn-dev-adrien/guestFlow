// Pictures and multipart calls for the visual-library suites (specs/gift-vouchers/gift-voucher-campaigns.md rule 47). Not a test file.
const sharp = require('sharp');

/** A flat picture of `width` × `height` px, as a JPEG (or a PNG). */
const picture = (width = 1300, height = 1832, { format = 'jpeg', background = '#2f5d50' } = {}) => {
  const image = sharp({ create: { width, height, channels: 3, background } });
  return format === 'png' ? image.png().toBuffer() : image.jpeg().toBuffer();
};

/** A multipart request to the admin API: `fields` as text, `file` as the `file` part. → `{ status, body }` (the body is JSON, or the raw bytes). */
async function sendForm(server, method, path, { fields = {}, file = null, filename = 'visuel.jpg', type = 'image/jpeg' } = {}) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, String(value)));
  if (file) form.append('file', new Blob([file], { type }), filename);
  const res = await fetch(`${server.base}${path}`, { method, body: form });
  const kind = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: kind.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

/** A visual added through the API → its JSON. */
async function addVisual(server, { name = 'Façade', use = 'both', file } = {}) {
  const res = await sendForm(server, 'POST', '/api/gift-vouchers/visuals', { fields: { name, use }, file: file || await picture() });
  if (res.status !== 201) throw new Error(`visual refused: ${JSON.stringify(res.body)}`);
  return res.body;
}

module.exports = { picture, sendForm, addVisual };
