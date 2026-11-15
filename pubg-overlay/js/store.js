/* Sync layer.
   - Supabase mode (config.js filled in): works over the internet, realtime.
   - Local mode (config.js empty): same browser only, for trying things out. */
const Store = (() => {
  const C = window.OVERLAY_CONFIG || {};
  const q = new URLSearchParams(location.search);
  const room = q.get('room') || C.room || 'main';
  const useSb = !!(C.supabaseUrl && C.supabaseKey && window.supabase);
  const TABLE = 'overlay_state';
  const listeners = {}, pending = {}, busy = {};
  let sb = null, bc = null, statusCb = () => {};

  const emit = (key, data) => (listeners[key] || []).forEach(f => f(data));
  const lsKey = key => `pgo:${room}:${key}`;
  const setStatus = (s, msg) => statusCb(s, msg);

  async function load(key) {
    if (!useSb) {
      try { return JSON.parse(localStorage.getItem(lsKey(key))); } catch (e) { return null; }
    }
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
      if (error) { setStatus('error', error.code === '42501' ? 'Bu hisob admin emas — yozish taqiqlangan' : 'Saqlanmadi: ' + error.message); if (pending[key] === undefined) pending[key] = data; await new Promise(r => setTimeout(r, 2000)); }
      else setStatus('ok');
    }
    busy[key] = false;
  }

  function set(key, data) {
    if (!useSb) {
      try { localStorage.setItem(lsKey(key), JSON.stringify(data)); }
      catch (e) { setStatus('error', 'Brauzer xotirasi to\'ldi (rasmlar juda katta)'); }
      if (bc) bc.postMessage({ key, data });
      return;
    }
    pending[key] = data; flush(key);
  }

  async function init() {
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
    sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey);
    sb.channel('room-' + room)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `room=eq.${room}` }, p => {
        const r = p.new;
        if (!r || !r.key) return;
        // "live" is small and arrives in the payload; big docs (logos, photos) are re-fetched
        if (r.key === 'live' && r.data) emit('live', r.data);
        else load(r.key).then(d => d && emit(r.key, d));
      })
      .subscribe(st => {
        if (st === 'SUBSCRIBED') { setStatus('ok'); ['config', 'live', 'history'].forEach(k => load(k).then(d => d && emit(k, d))); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') setStatus('error', 'Aloqa uzildi, qayta ulanmoqda…');
      });
  }

  return {
    room, mode: useSb ? 'supabase' : 'local', init, load, set,
    on(key, f) { (listeners[key] = listeners[key] || []).push(f); },
    onStatus(f) { statusCb = f; },
    /* Safety net for the overlay: re-read state periodically in case a realtime event was missed */
    poll(ms) { if (useSb) setInterval(() => ['live', 'history'].forEach(k => load(k).then(d => d && emit(k, d))), ms); },
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
    async signOut() { if (useSb) await sb.auth.signOut(); }
  };
})();
