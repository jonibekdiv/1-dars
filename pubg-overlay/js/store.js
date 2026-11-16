/* Sync layer.
   - Supabase mode (config.js filled in): works over the internet, realtime.
   - Local mode (config.js empty): same browser only, for trying things out. */
const Store = (() => {
  const C = window.OVERLAY_CONFIG || {};
  const q = new URLSearchParams(location.search);
  const roomParam = (q.get('room') || '').toLowerCase();
  const room = roomParam || C.room || 'main';
  const useSb = !!(C.supabaseUrl && C.supabaseKey && window.supabase);
  const realtime = !window.OVERLAY_NO_REALTIME;      // the public page only polls, to keep realtime slots free
  const TABLE = 'overlay_state', KEYS = ['config', 'live', 'history', 'maps'];
  const listeners = {}, pending = {}, busy = {};
  let sb = null, bc = null, ch = null, statusCb = () => {};

  const emit = (key, data) => (listeners[key] || []).forEach(f => f(data));
  const lsKey = key => `pgo:${room}:${key}`;
  const setStatus = (s, msg) => statusCb(s, msg);
  const errText = e => e.code === '42501' ? 'Bu hisob admin emas — yozish taqiqlangan' : 'Saqlanmadi: ' + e.message;
  const lsGet = key => { try { return JSON.parse(localStorage.getItem(lsKey(key))); } catch (e) { return null; } };
  function lsSet(key, data) {
    try { localStorage.setItem(lsKey(key), JSON.stringify(data)); }
    catch (e) { setStatus('error', 'Brauzer xotirasi to\'ldi (rasmlar juda katta)'); return false; }
    if (bc) bc.postMessage({ key, data });
    return true;
  }

  async function load(key) {
    if (!useSb) return lsGet(key);
    const { data, error } = await sb.from(TABLE).select('data').eq('room', room).eq('key', key).maybeSingle();
    if (error) { setStatus('error', error.message); return null; }
    return data ? data.data : null;
  }

  async function flush(key) {
    if (busy[key]) return;
    busy[key] = true;
    while (pending[key] !== undefined) {
      const data = pending[key]; delete pending[key];
      const { error } = await sb.from(TABLE).upsert({ room, key, data, updated_at: new Date().toISOString() });
      if (error) { setStatus('error', errText(error)); if (pending[key] === undefined) pending[key] = data; await new Promise(r => setTimeout(r, 2000)); }
      else setStatus('ok');
    }
    busy[key] = false;
  }
  /* Plain write: last writer wins (settings, history) */
  function set(key, data) {
    if (!useSb) { lsSet(key, data); return; }
    pending[key] = data; flush(key);
  }

  /* Safe write for the live match: succeeds only if nobody changed it since version `expect`.
     Returns {ok:true}, or {ok:false, current} when another admin was faster, or {ok:false, error}. */
  /* Local mode: localStorage is not atomic between browser tabs, so the version check runs inside
     an IndexedDB read-write transaction (those are serialised across tabs); localStorage is the mirror. */
  let idb = null;
  const idbOpen = () => idb || (idb = new Promise((res, rej) => {
    const r = indexedDB.open('pgo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  async function localCas(key, expect, data) {
    let db; try { db = await idbOpen(); } catch (e) { db = null; }
    if (!db) {                                                  // no IndexedDB: best effort
      const cur = lsGet(key);
      if (cur && (cur._s || 0) !== (expect || 0)) return { ok: false, current: cur };
      return lsSet(key, data) ? { ok: true } : { ok: false, error: 'storage' };
    }
    return new Promise(res => {
      const tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv'), k = room + ':' + key;
      let out = { ok: false, error: 'idb' };
      const g = st.get(k);
      g.onsuccess = () => {
        let cur = g.result;
        if (cur === undefined) cur = lsGet(key);                // first write in this browser
        if (cur && (cur._s || 0) !== (expect || 0)) { out = { ok: false, current: cur }; return; }
        st.put(data, k); out = { ok: true };
      };
      tx.oncomplete = () => { if (out.ok && !lsSet(key, data)) out = { ok: false, error: 'storage' }; res(out); };
      tx.onerror = tx.onabort = () => res({ ok: false, error: 'idb' });
    });
  }
  function cas(key, expect, data) {
    if (!useSb) return localCas(key, expect, data);
    return (async () => {
      const upd = await sb.from(TABLE).update({ data, updated_at: new Date().toISOString() })
        .eq('room', room).eq('key', key).eq('data->>_s', String(expect || 0)).select('key');
      if (upd.error) { setStatus('error', errText(upd.error)); return { ok: false, error: upd.error.message }; }
      if (upd.data && upd.data.length) { setStatus('ok'); return { ok: true }; }
      const cur = await load(key);
      if (cur && cur._s !== undefined && (cur._s || 0) !== (expect || 0)) return { ok: false, current: cur };
      // no row yet (first write ever) or a legacy row without a version: write it outright
      const ins = await sb.from(TABLE).upsert({ room, key, data, updated_at: new Date().toISOString() });
      if (ins.error) { setStatus('error', errText(ins.error)); return { ok: false, error: ins.error.message }; }
      setStatus('ok'); return { ok: true };
    })();
  }

  /* Supabase client without the realtime subscription (enough for signing in and the tournament list) */
  function connect() { if (useSb && !sb) sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey); }
  let inited = false;
  async function init() {
    if (inited) return;
    inited = true;
    if (!useSb) {
      if (window.BroadcastChannel) {
        bc = new BroadcastChannel('pgo:' + room);
        bc.onmessage = e => emit(e.data.key, e.data.data);
      }
      window.addEventListener('storage', e => {
        if (e.key && e.key.startsWith(`pgo:${room}:`) && e.newValue) {
          try { emit(e.key.split(':')[2], JSON.parse(e.newValue)); } catch (err) { /* ignore */ }
        }
      });
      setStatus('local');
      return;
    }
    connect();
    if (!realtime) { setStatus('ok'); return; }
    ch = sb.channel('room-' + room)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `room=eq.${room}` }, p => {
        const r = p.new;
        if (!r || !r.key) return;
        // "live" is small and arrives in the payload; big docs (logos, photos) are re-fetched
        if (r.key === 'live' && r.data) emit('live', r.data);
        else if (listeners[r.key]) load(r.key).then(d => d && emit(r.key, d));
      })
      .subscribe(st => {
        if (st === 'SUBSCRIBED') { setStatus('ok'); KEYS.forEach(k => listeners[k] && load(k).then(d => d && emit(k, d))); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') setStatus('error', 'Aloqa uzildi, qayta ulanmoqda…');
      });
  }

  return {
    room, roomParam, mode: useSb ? 'supabase' : 'local', connect, init, load, set, cas,
    on(key, f) { (listeners[key] = listeners[key] || []).push(f); },
    onStatus(f) { statusCb = f; },
    /* Re-read state periodically (safety net for the overlay, the only channel for the public page) */
    poll(ms, keys) { if (useSb) setInterval(() => (keys || ['live', 'history']).forEach(k => load(k).then(d => d && emit(k, d))), ms); },
    /* Who has this tournament open right now: cb({admin, overlay}) — admin panels and OBS overlays */
    presence(id, kind, cb) {
      cb = cb || (() => {});
      const count = list => { const n = { admin: 0, overlay: 0 }; list.forEach(k => { n[k === 'overlay' ? 'overlay' : 'admin']++; }); return n; };
      if (useSb) {
        if (!ch) return;
        ch.on('presence', { event: 'sync' }, () => {
          const st = ch.presenceState();
          cb(count(Object.keys(st).map(k => ((st[k] || [])[0] || {}).kind)));
        });
        const go = () => ch.track({ id, kind }).catch(() => {});
        go(); setTimeout(go, 3000); setTimeout(go, 10000); setInterval(go, 60000);   // also after a reconnect
        return;
      }
      if (!window.BroadcastChannel) return;                 // local mode: other tabs of this browser
      const pc = new BroadcastChannel('pgo-pr:' + room), seen = {};
      pc.onmessage = e => { const m = e.data || {}; if (m.bye) delete seen[m.id]; else seen[m.id] = { kind: m.kind, t: Date.now() }; };
      const tick = () => {
        pc.postMessage({ id, kind });
        const now = Date.now(); Object.keys(seen).forEach(k => { if (now - seen[k].t > 6000) delete seen[k]; });
        cb(count([kind].concat(Object.keys(seen).map(k => seen[k].kind))));
      };
      tick(); setInterval(tick, 2000);
      window.addEventListener('pagehide', () => pc.postMessage({ id, bye: true }));
    },
    async user() { if (!useSb) return { email: 'local' }; const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); return error ? error.message : null; },
    /* Returns {error} or {needConfirm:true} when the email must be confirmed first */
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) return { error: error.message };
      if (data.session) return {};
      const err = await this.signIn(email, password);
      return err ? { needConfirm: true } : {};
    },
    async signOut() { if (useSb) await sb.auth.signOut(); },
    /* ---------- tournaments and their admins ---------- */
    /* {email, owner}: the owner manages every tournament and its admins */
    async me() {
      if (!useSb) return { email: 'local', owner: true };
      const u = await this.user(); if (!u) return null;
      const { data } = await sb.from('overlay_owners').select('email').eq('email', u.email.toLowerCase()).maybeSingle();
      return { email: u.email.toLowerCase(), owner: !!data };
    },
    /* tournaments this account may run (all of them for the owner) */
    async rooms() {
      if (!useSb) return [{ room, name: room.toUpperCase() }];
      const { data, error } = await sb.from('overlay_rooms').select('room,name,created_at').order('created_at');
      if (error) throw error;
      return data || [];
    },
    async createRoom(name) {
      const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'turnir';
      const id = base + '-' + Math.random().toString(36).slice(2, 6);
      const { error } = await sb.from('overlay_rooms').insert({ room: id, name: name.trim().toUpperCase() });
      return error ? { error: error.message } : { room: id };
    },
    async renameRoom(r, name) { const { error } = await sb.from('overlay_rooms').update({ name: name.trim().toUpperCase() }).eq('room', r); return error ? error.message : null; },
    /* deletes the tournament with all its data (teams, results, maps) */
    /* ---------- music files ---------- */
    /* Supabase: public file storage (folder = tournament). Local mode: IndexedDB of this browser. */
    async uploadMedia(file) {
      if (!useSb) {
        const id = 'idb:' + Math.random().toString(36).slice(2, 10), db = await idbOpen();
        await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(file, 'media:' + id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        return { url: id };
      }
      const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(-60);
      const path = `${room}/${Date.now().toString(36)}-${safe}`;
      const { error } = await sb.storage.from('overlay-media').upload(path, file, { contentType: file.type || 'audio/mpeg', upsert: false });
      if (error) return { error: /maximum allowed size|too large/i.test(error.message) ? 'Fayl juda katta (30 MB gacha)' : /mime|type/i.test(error.message) ? 'Bu audio formati qabul qilinmaydi (MP3, M4A, WAV, OGG)' : error.message };
      return { url: sb.storage.from('overlay-media').getPublicUrl(path).data.publicUrl };
    },
    async deleteMedia(url) {
      if (!url) return;
      if (url.startsWith('idb:')) { try { const db = await idbOpen(); db.transaction('kv', 'readwrite').objectStore('kv').delete('media:' + url); } catch (e) { /* ignore */ } return; }
      const m = /\/overlay-media\/(.+)$/.exec(url); if (m && sb) await sb.storage.from('overlay-media').remove([decodeURIComponent(m[1])]);
    },
    /* playable address of an uploaded track */
    async mediaUrl(url) {
      if (!url || !url.startsWith('idb:')) return url;
      try {
        const db = await idbOpen();
        const blob = await new Promise(res => { const g = db.transaction('kv').objectStore('kv').get('media:' + url); g.onsuccess = () => res(g.result); g.onerror = () => res(null); });
        return blob ? URL.createObjectURL(blob) : null;
      } catch (e) { return null; }
    },
    async deleteRoom(r) {
      try { const { data } = await sb.storage.from('overlay-media').list(r, { limit: 1000 }); if (data && data.length) await sb.storage.from('overlay-media').remove(data.map(f => r + '/' + f.name)); } catch (e) { /* files are best effort */ }
      const a = await sb.from('overlay_state').delete().eq('room', r); if (a.error) return a.error.message;
      const b = await sb.from('overlay_rooms').delete().eq('room', r); return b.error ? b.error.message : null;
    },
    async roomAdmins(r) {
      if (!useSb) return [];
      const { data } = await sb.from('overlay_room_admins').select('email').eq('room', r).order('added_at');
      return (data || []).map(x => x.email);
    },
    async addRoomAdmin(r, email) {
      const e = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return 'Email noto\'g\'ri';
      const { error } = await sb.from('overlay_room_admins').insert({ room: r, email: e });
      return error ? (error.code === '23505' ? 'Bu admin allaqachon qo\'shilgan' : error.message) : null;
    },
    async delRoomAdmin(r, email) { const { error } = await sb.from('overlay_room_admins').delete().eq('room', r).eq('email', email); return error ? error.message : null; }
  };
})();
