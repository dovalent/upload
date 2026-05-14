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
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const body = req.body;
    if (!body || !body.session || !body.image) {
      return res.json({ ok: false, error: 'session & image required' });
    }

    const siteKey = body.site || 'banyuwangi';
    const BASE = SITES[siteKey] || SITES.banyuwangi;
    let sess = body.session;

    // Step 1: Get old gallery IDs
    const listRes = await fetch(BASE + '/gallery', { headers: { Cookie: sess } });
    const listHtml = await listRes.text();
    sess = combineCookies(sess, grabCookies(listRes));
    const oldIds = [...listHtml.matchAll(/detailImage_(\d+)/g)].map(m => m[1]);

    // Step 2: Get upload form token
    const upRes = await fetch(BASE + '/gallery/upload', { headers: { Cookie: sess } });
    const upHtml = await upRes.text();
    const tokenMatch = upHtml.match(/name="_token"\s+value="([^"]+)"/);
    if (!tokenMatch) return res.json({ ok: false, error: 'Upload token not found' });
    sess = combineCookies(sess, grabCookies(upRes));

    // Step 3: Decode base64 image to Buffer
    const base64Match = body.image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!base64Match) return res.json({ ok: false, error: 'Invalid image format' });
    const mime = base64Match[1];
    const imgBuffer = Buffer.from(base64Match[2], 'base64');
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';

    // Step 4: Build FormData with form-data package (proper Node.js multipart)
    const fd = new FormData();
    fd.append('_token', tokenMatch[1]);
    fd.append('image', imgBuffer, {
      filename: 'photo.' + ext,
      contentType: mime,
    });
    fd.append('croppedImage', base64Match[2]);
    fd.append('caption', (body.caption || body.title || 'Photo').substring(0, 100));
    fd.append('description', (body.description || body.caption || body.title || 'Photo').substring(0, 500));
    fd.append('author', body.author || 'Dovalent');
    fd.append('source', body.source || '');

    // Step 5: Upload!
    const uploadRes = await fetch(BASE + '/gallery/save', {
      method: 'POST',
      headers: {
        ...fd.getHeaders(),
        Cookie: sess,
        Referer: BASE + '/gallery/upload',
        Origin: BASE,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: fd,
      redirect: 'manual',
    });

    const uploadStatus = uploadRes.status;
    sess = combineCookies(sess, grabCookies(uploadRes));

    if (uploadStatus !== 302) {
      const errText = await uploadRes.text();
      return res.json({ ok: false, error: 'Upload status: ' + uploadStatus, detail: errText.substring(0, 300) });
    }

    // Step 6: Find new image ID
    const newListRes = await fetch(BASE + '/gallery', { headers: { Cookie: sess } });
    const newListHtml = await newListRes.text();
    sess = combineCookies(sess, grabCookies(newListRes));
    const newIds = [...newListHtml.matchAll(/detailImage_(\d+)/g)].map(m => m[1]);
    const diff = newIds.filter(id => !oldIds.includes(id));

    let newId = diff.length > 0 ? diff[0] : '';
    if (!newId && newIds.length > 0) {
      newId = String(Math.max(...newIds.map(Number)));
    }

    // Get URL
    let newUrl = '';
    if (newId) {
      const urlMatch = newListHtml.match(new RegExp('<img[^>]*src="([^"]*)"[\\s\\S]*?detailImage_' + newId, 'i'));
      if (urlMatch) newUrl = urlMatch[1];
    }

    return res.json({ ok: !!newId, id: newId, url: newUrl, session: sess });

  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
};
