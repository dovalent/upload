const FormData = require('form-data');
const fetch = require('node-fetch');
const { IncomingForm } = require('formidable');
const fs = require('fs');

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
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const body = req.body;
    if (!body || !body.session || !body.image) {
      return res.json({ ok: false, error: 'session & image required' });
    }
    const siteKey = body.site || 'banyuwangi';
    const BASE = SITES[siteKey] || SITES.banyuwangi;
    let sess = body.session;

    // Get old IDs
    const listRes = await fetch(BASE + '/gallery', { headers: { Cookie: sess } });
    const listHtml = await listRes.text();
    sess = combineCookies(sess, grabCookies(listRes));
    const oldIds = [...listHtml.matchAll(/detailImage_(\d+)/g)].map(m => m[1]);

    // Get upload token
    const upRes = await fetch(BASE + '/gallery/upload', { headers: { Cookie: sess } });
    const upHtml = await upRes.text();
    sess = combineCookies(sess, grabCookies(upRes));
    const tokenMatch = upHtml.match(/name="_token"\s+value="([^"]+)"/);
    if (!tokenMatch) return res.json({ ok: false, error: 'Token not found' });

    // Decode image
    const b64Match = body.image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!b64Match) return res.json({ ok: false, error: 'Invalid image' });
    const mime = b64Match[1];
    const imgBuf = Buffer.from(b64Match[2], 'base64');
    const ext = mime.includes('png') ? 'png' : 'jpg';

    // Build form with form-data
    const fd = new FormData();
    fd.append('_token', tokenMatch[1]);
    fd.append('image', imgBuf, { filename: 'upload.' + ext, contentType: mime, knownLength: imgBuf.length });
    fd.append('caption', (body.caption || 'Photo').substring(0, 100));
    fd.append('description', body.description || 'Photo');
    fd.append('author', body.author || 'Dovalent');
    fd.append('source', body.source || '');

    // Upload
    const upHeaders = fd.getHeaders();
    upHeaders['Cookie'] = sess;
    upHeaders['Referer'] = BASE + '/gallery/upload';
    upHeaders['Origin'] = BASE;
    upHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    upHeaders['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

    const uploadRes = await fetch(BASE + '/gallery/save', {
      method: 'POST',
      headers: upHeaders,
      body: fd,
      redirect: 'manual',
    });

    sess = combineCookies(sess, grabCookies(uploadRes));
    
    if (uploadRes.status !== 302) {
      const errText = await uploadRes.text();
      return res.json({ ok: false, error: 'Status ' + uploadRes.status, detail: errText.substring(0, 500) });
    }

    // Find new ID
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

    return res.json({ ok: !!newId, id: newId, url: newUrl, session: sess });
  } catch (err) {
    return res.json({ ok: false, error: err.message, stack: err.stack?.substring(0, 200) });
  }
};
