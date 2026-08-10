const request = require('supertest');
const app = require('../src/app');

// The two POC apps (brief: "POC Deploy Brief — Pilot Hosting") are standalone
// HTML with their own in-page login. Every regression here has the same visible
// symptom: the SPA catch-all answers instead and React Router sends the field
// engineer to /admin/login, which they cannot get past.
const SVR = '/PesTrackv4.5.1.html';
const CSS = '/PesTrackCSSchedulerv0.16.html';

const titleOf = (res) => (String(res.text || '').match(/<title>([^<]*)<\/title>/) || [, ''])[1];

describe('standalone HTML apps', () => {
  test.each([
    ['SVR', SVR, 'PesTrack Site Visit Report'],
    ['CS Scheduler', CSS, 'PesTrack CS Scheduler'],
  ])('%s is served at its own file name', async (_name, url, title) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(titleOf(res)).toBe(title);
  });

  // planLink()/bundleLink() in the CS Scheduler build `base.replace(/\/+$/,'')
  // + '/#plan=…'`, so a PesTrack URL of `https://<site>/PesTrackv4.5.1.html`
  // requests `/PesTrackv4.5.1.html/` — WITH a trailing slash. express.static
  // does not serve that form. Every WhatsApp plan link depends on this test.
  test.each([
    ['trailing slash (how every plan link arrives)', `${SVR}/`],
    ['lowercase, no extension', '/pestrackv4.5.1'],
    ['uppercase extension', '/PesTrackv4.5.1.HTML'],
    ['?now= clock override before the hash', `${SVR}?now=2026-08-11T09:00`],
  ])('SVR resolves: %s', async (_name, url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(titleOf(res)).toBe('PesTrack Site Visit Report');
  });

  test('pages are revalidated, so a cached SPA shell cannot stick', async () => {
    const res = await request(app).get(SVR);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers.etag).toBeDefined(); // still cheap on repeat visits
  });

  test('the SPA still owns its own routes', async () => {
    for (const url of ['/', '/index.html', '/admin/login', '/admin/users']) {
      expect(titleOf(await request(app).get(url))).toBe('SOTAICO PesTrack – Site Findings');
    }
  });

  test('API routes are untouched', async () => {
    expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });

  // Only names discovered in public/ can ever be served: the request path is a
  // lookup key, never a path segment.
  test.each([
    '/..%2f..%2fpackage.json',
    '/%2e%2e/%2e%2e/server.js',
    '/..%2F..%2Fsrc%2Fapp.js',
  ])('does not serve %s from outside public/', async (url) => {
    const res = await request(app).get(url);
    expect(res.text).not.toMatch(/module\.exports|"name":\s*"pestrack-backend"/);
  });

  test('a malformed percent-escape does not throw', async () => {
    const res = await request(app).get('/%E0%A4%A');
    expect(res.status).toBe(200); // falls through to the SPA, not a 500
  });
});
