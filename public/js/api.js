 
const APP_CONFIG = { REFRESH_SECONDS: 30 };
const API = {
    token: sessionStorage.getItem('ch_token') || '',
    setToken(t) { API.token = t || ''; t ? sessionStorage.setItem('ch_token', t) : sessionStorage.removeItem('ch_token'); },
    busy: 0, timer: null,
    show() { if (++API.busy === 1) API.timer = setTimeout(() => { const o = document.getElementById('busy'); if (o) o.style.display = 'flex'; document.body.classList.add('is-busy'); }, 250); },
    hide() { if (--API.busy <= 0) { API.busy = 0; clearTimeout(API.timer); const o = document.getElementById('busy'); if (o) o.style.display = 'none'; document.body.classList.remove('is-busy'); } },
    async call(action, data = {}, quiet = false) {
        let res, json;
        if (!quiet) API.show();
        try {
            res = await fetch('/api', {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json', 'X-Action': action }, API.token ? { Authorization: 'Bearer ' + API.token } : {}),
                body: JSON.stringify({ action, data })
            });
            json = await res.json();
        } catch (e) {
            throw new Error('Unable to connect. Please check your internet connection and try again.');
        } finally { if (!quiet) API.hide(); }
        if (!json.ok) {
            const err = new Error(json.error || 'Something went wrong. Please try again.');
            err.code = json.code || '';
            if (err.code === 'SESSION') API.setToken('');
            throw err;
        }
        return json.data;
    }
};
