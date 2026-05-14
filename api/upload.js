const FormData = require('form-data');
const fetch = require('node-fetch');

const SITES = {
  banyuwangi: 'https://konten-banyuwangi.viva.co.id',
  bali: 'https://konten-bali.viva.co.id',
  mindset: 'https://konten-mindset.viva.co.id',
};

function grabCookies(res) {
  const raw = res.headers.raw()['set-cookie'] || [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

function combineCookies(a, b) {
  const m = {};
  (a || '').split('; ').concat((b || '').split('; ')).forEach(c => {
    if (!c) return;
    const eq = c.indexOf('=');
    if (eq > 0) m[c.substring(0, eq)] = c;
  });
  return Object.values(m).join('; ');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).json({ok:true});

  try {
    const body = req.body;
    if (!body || !body.session || !body.image) {
      return res.status(200).json({ ok: false, error: 'session & image required' });
    }
    const siteKey = body.site || 'banyuwangi';
    const BASE = SITES[siteKey] || SITES.banyuwangi;
    let sess = body.session;

    const listRes = await fetch(BASE + '/gallery', { headers: { Cookie: sess } });
    const listHtml = await listRes.text();
    sess = combineCookies(sess, grabCookies(listRes));
    const oldIds = [...listHtml.matchAll(/detailImage_(\d+)/g)].map(m => m[1]);

    const upRes = await fetch(BASE + '/gallery/upload', { headers: { Cookie: sess } });
    const upHtml = await upRes.text();
    sess = combineCookies(sess, grabCookies(upRes));
    const tokenMatch = upHtml.match(/name="_token"\s+value="([^"]+)"/);
    if (!tokenMatch) return res.status(200).json({ ok: false, error: 'Token not found' });

    const b64Match = body.image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!b64Match) return res.status(200).json({ ok: false, error: 'Invalid image' });
    const mime = b64Match[1];
    const imgBuf = Buffer.from(b64Match[2], 'base64');
    const ext = mime.includes('png') ? 'png' : 'jpg';

    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const fd = new FormData();
    fd.setBoundary(boundary);
    fd.append('_token', tokenMatch[1]);
    fd.append('image', imgBuf, { filename: 'upload.' + ext, contentType: mime, knownLength: imgBuf.length });
    fd.append('caption', (body.caption || 'Photo').substring(0, 100));
    fd.append('description', body.description || 'Photo');
    fd.append('author', body.author || 'Dovalent');
    fd.append('source', body.source || '');
    fd.append('checkbox_contributor', '1');
    fd.append('contributor[]', '');

    const upHeaders = fd.getHeaders();
    upHeaders['Cookie'] = sess;
    upHeaders['Referer'] = BASE + '/gallery/upload';
    upHeaders['Origin'] = BASE;
    upHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    upHeaders['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
    upHeaders['sec-fetch-dest'] = 'document';
    upHeaders['sec-fetch-mode'] = 'navigate';
    upHeaders['sec-fetch-site'] = 'same-origin';
    upHeaders['sec-fetch-user'] = '?1';
    upHeaders['upgrade-insecure-requests'] = '1';
    upHeaders['cache-control'] = 'max-age=0';
    const fdBuffer = fd.getBuffer();
    upHeaders['Content-Length'] = String(fdBuffer.length);
    const uploadRes = await fetch(BASE + '/gallery/save', {
      method: 'POST', headers: upHeaders, body: fdBuffer, redirect: 'manual',
    });
    sess = combineCookies(sess, grabCookies(uploadRes));

    if (uploadRes.status !== 302) {
      const errText = await uploadRes.text();
      return res.status(200).json({ ok: false, error: 'Status ' + uploadRes.status, detail: errText.substring(0, 300) });
    }

    const newRes = await fetch(BASE + '/gallery', { headers: { Cookie: sess } });
    const newHtml = await newRes.text();
    sess = combineCookies(sess, grabCookies(newRes));
    const newIds = [...newHtml.matchAll(/detailImage_(\d+)/g)].map(m => m[1]);
    const diff = newIds.filter(id => !oldIds.includes(id));
    let newId = diff.length > 0 ? diff[0] : '';
    if (!newId && newIds.length) newId = String(Math.max(...newIds.map(Number)));

    let newUrl = '';
    if (newId) {
      const m = newHtml.match(new RegExp('<img[^>]*src="([^"]*)"[\\s\\S]*?detailImage_' + newId));
      if (m) newUrl = m[1];
    }

    return res.status(200).json({ ok: !!newId, id: newId, url: newUrl, session: sess });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
};
