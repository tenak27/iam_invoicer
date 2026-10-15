// Console de l'éditeur, servie à /admin/ sur le serveur qui héberge plusieurs sociétés :
// créer la base en ligne d'une société, lui attribuer une licence, suspendre, réactiver,
// supprimer, tenir le registre des licences. Page autonome (ni dépendance, ni fichier
// externe) : elle n'affiche rien sans connexion et ne parle qu'à /api/login et /api/admin/.
// Tout texte venu du serveur est inséré par textContent, jamais interprété comme du HTML.

const CSS = `
:root { --bg:#f3f5fa; --surface:#fff; --line:#dde2ec; --text:#1c2333; --muted:#5d6475; --blue:#1d6fd6; --blue-d:#1550a8; --gold:#e2a81f; --green:#128052; --red:#c9393a; --side:#232a3d; --r:12px; }
@media (prefers-color-scheme: dark) { :root { --bg:#141824; --surface:#1e2433; --line:#323a4e; --text:#e9ecf4; --muted:#a3abbd; --side:#10141e; } }
* { box-sizing: border-box; }
body { margin:0; font:15px/1.5 "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; background:var(--bg); color:var(--text); }
button, input, select, textarea { font:inherit; color:inherit; }
h1, h2, h3, p { margin:0; }
.weave { height:4px; background:repeating-linear-gradient(90deg, var(--blue) 0 22px, var(--gold) 22px 30px, var(--green) 30px 44px, var(--gold) 44px 52px); }
.top { background:var(--side); color:#fff; }
.top-in { max-width:1180px; margin:0 auto; padding:14px 20px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.top h1 { font-size:18px; font-weight:700; letter-spacing:.01em; }
.top h1 span { font-weight:400; opacity:.8; }
.top .who { margin-left:auto; font-size:13.5px; opacity:.9; }
.tabs { display:flex; gap:6px; }
.tab { border:none; background:none; color:#cfd6e6; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; }
.tab[aria-selected=true] { background:var(--blue); color:#fff; }
main { max-width:1180px; margin:0 auto; padding:22px 20px 60px; }
.bar { display:flex; align-items:center; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
.bar h2 { font-size:20px; }
.bar .grow { flex:1; }
.card { background:var(--surface); border-radius:var(--r); box-shadow:0 1px 3px rgba(20,30,60,.08), 0 6px 18px -10px rgba(20,30,60,.25); padding:18px 20px; animation:in .35s ease-out backwards; }
@keyframes in { from { opacity:0; transform:translateY(10px); } }
.btn { color:var(--text); display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:38px; padding:0 16px; border-radius:8px; border:1px solid var(--line); background:var(--surface); cursor:pointer; font-weight:600; transition:transform .12s, box-shadow .2s, background .15s; }
.btn:hover { box-shadow:0 4px 12px -6px rgba(20,30,60,.4); }
.btn:active { transform:scale(.97); }
.btn:disabled { opacity:.55; cursor:default; }
.btn.primary { background:var(--blue); border-color:var(--blue); color:#fff; }
.btn.primary:hover { background:var(--blue-d); }
.btn.danger { color:var(--red); border-color:var(--red); }
.btn.small { min-height:32px; padding:0 11px; font-size:13.5px; }
.btn:focus-visible, .tab:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible { outline:3px solid rgba(29,111,214,.45); outline-offset:2px; }
.wrap { overflow-x:auto; }
table { width:100%; border-collapse:collapse; }
th { text-align:left; font-size:12.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); padding:8px 10px; border-bottom:2px solid var(--line); white-space:nowrap; }
td { padding:11px 10px; border-bottom:1px solid var(--line); vertical-align:middle; }
tr:last-child td { border-bottom:none; }
tbody tr { animation:in .35s ease-out backwards; }
td.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.name { font-weight:600; }
.sub { color:var(--muted); font-size:13px; }
a { color:var(--blue); }
.badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12.5px; font-weight:700; white-space:nowrap; }
.b-ok { background:rgba(18,128,82,.14); color:var(--green); }
.b-off { background:rgba(201,57,58,.14); color:var(--red); }
.b-warn { background:rgba(226,168,31,.2); color:#8a5a00; }
@media (prefers-color-scheme: dark) { .b-warn { color:#f0c14b; } .b-ok { color:#4fd39a; } .b-off { color:#ff9a94; } a { color:#7fb2f5; } }
.empty { text-align:center; color:var(--muted); padding:34px 10px; }
.grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:14px; }
.field { display:flex; flex-direction:column; gap:5px; min-width:0; }
.field.full { grid-column:1 / -1; }
.field > span { font-size:13.5px; font-weight:600; }
.field small { color:var(--muted); }
input, select, textarea { width:100%; min-height:40px; padding:8px 11px; border:1px solid var(--line); border-radius:8px; background:var(--surface); }
textarea { min-height:84px; resize:vertical; font-family:Consolas, monospace; font-size:13px; }
dialog { border:none; border-radius:16px; padding:0; width:min(680px, calc(100vw - 24px)); max-height:calc(100dvh - 24px); background:var(--surface); color:var(--text); box-shadow:0 30px 70px -20px rgba(0,0,0,.5); }
dialog[open] { animation:pop .28s cubic-bezier(.34,1.4,.64,1); }
@keyframes pop { from { opacity:0; transform:translateY(18px) scale(.94); } }
dialog::backdrop { background:rgba(15,20,35,.55); backdrop-filter:blur(3px); }
.d-head { display:flex; align-items:center; gap:12px; padding:18px 22px; border-bottom:1px solid var(--line); }
.d-head h3 { font-size:18px; flex:1; }
.d-body { padding:18px 22px; display:flex; flex-direction:column; gap:16px; overflow:auto; }
.d-foot { display:flex; justify-content:flex-end; gap:10px; padding:14px 22px; border-top:1px solid var(--line); flex-wrap:wrap; }
.x { border:none; background:none; font-size:22px; line-height:1; cursor:pointer; color:var(--muted); width:36px; height:36px; border-radius:50%; }
.x:hover { background:var(--bg); }
.kv { display:grid; grid-template-columns:auto 1fr; gap:6px 16px; }
.kv dt { color:var(--muted); }
.kv dd { margin:0; font-weight:600; overflow-wrap:anywhere; }
.box { padding:12px 14px; border-radius:10px; background:rgba(29,111,214,.09); }
.box.warn { background:rgba(226,168,31,.16); }
.box.err { background:rgba(201,57,58,.12); color:var(--red); }
.secret { font-family:Consolas, monospace; font-size:14px; overflow-wrap:anywhere; user-select:all; }
.actions { display:flex; gap:8px; flex-wrap:wrap; }
.login { max-width:420px; margin:9vh auto 0; }
.login h2 { font-size:22px; margin-bottom:4px; }
.login .card { display:flex; flex-direction:column; gap:14px; margin-top:18px; }
.switch { display:flex; gap:6px; background:var(--bg); border-radius:10px; padding:4px; }
.switch button { flex:1; border:none; background:none; padding:8px; border-radius:8px; cursor:pointer; font-weight:600; color:var(--muted); }
.switch button[aria-pressed=true] { background:var(--surface); color:var(--text); box-shadow:0 1px 3px rgba(20,30,60,.15); }
.toast { position:fixed; left:50%; bottom:22px; transform:translateX(-50%); background:#1c2333; color:#fff; padding:11px 18px; border-radius:10px; box-shadow:0 14px 30px -12px rgba(0,0,0,.6); animation:in .25s ease-out; z-index:50; max-width:calc(100vw - 24px); }
.toast.err { background:var(--red); }
.hide { display:none !important; }
@media (max-width:640px) { .grid { grid-template-columns:1fr; } .top .who { margin-left:0; width:100%; } }
@media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
`

// Script de la page : écrit sans gabarits de chaîne pour rester lisible dans ce fichier.
const JS = String.raw`
(function () {
  'use strict'
  var KEY = 'iam.admin.session'
  var token = sessionStorage.getItem(KEY) || ''
  var me = null
  var tenants = []
  var licences = []
  var view = 'societes'
  var TIERS = { essentiel: 'Essentiel', pro: 'Pro', entreprise: 'Entreprise', 'sur-mesure': 'Sur mesure' }
  var app = document.getElementById('app')

  function h(tag, attrs) {
    var el = document.createElement(tag)
    for (var k in attrs || {}) {
      var v = attrs[k]
      if (v === null || v === undefined || v === false) continue
      if (k === 'class') el.className = v
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v)
      else if (k === 'text') el.textContent = v
      else if (k === 'value') el.value = v
      else el.setAttribute(k, v === true ? '' : v)
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i]
      if (c === null || c === undefined || c === false) continue
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x) })
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    }
    return el
  }
  function put(el) {
    var kids = []
    for (var i = 1; i < arguments.length; i++) if (arguments[i] !== null && arguments[i] !== undefined && arguments[i] !== false) kids.push(arguments[i])
    el.replaceChildren.apply(el, kids)
  }
  function toast(text, err) {
    var t = h('div', { class: 'toast' + (err ? ' err' : ''), role: 'status', text: text })
    document.body.appendChild(t)
    setTimeout(function () { t.remove() }, err ? 6000 : 3200)
  }
  function api(method, path, body, noAuth) {
    var headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token && !noAuth) headers.Authorization = 'Bearer ' + token
    return fetch(path, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Réponse inattendue du serveur (HTTP ' + r.status + ').' } }).then(function (j) { j.status = r.status; return j }) })
      .catch(function () { return { ok: false, error: 'Serveur injoignable. Vérifiez la connexion Internet.' } })
      .then(function (j) {
        if (j.ok) return j.data
        if (j.status === 401 && !noAuth && me) logout(true)
        throw new Error(j.error || 'Erreur')
      })
  }
  function run(p, okText) {
    return p.then(function (d) { if (okText) toast(okText); return d }, function (e) { toast(e.message, true); return undefined })
  }
  function fmtDate(s) { return s ? new Date(String(s).length <= 10 ? s + 'T12:00:00' : s).toLocaleDateString('fr-FR') : '' }
  function fmtSize(n) { return n === null || n === undefined ? '' : n > 1e9 ? (n / 1e9).toFixed(1) + ' Go' : (n / 1e6).toFixed(1).replace('.', ',') + ' Mo' }
  function copy(text) { navigator.clipboard.writeText(text).then(function () { toast('Copié.') }, function () { toast('Copie impossible : sélectionnez le texte.', true) }) }
  function field(label, input, hint, full) { return h('label', { class: 'field' + (full ? ' full' : '') }, h('span', { text: label }), input, hint ? h('small', { text: hint }) : null) }
  function urlOf(slug) { return location.origin + '/t/' + slug }

  function dialog(title, body, foot) {
    var d = h('dialog', { 'aria-label': title },
      h('div', { class: 'd-head' }, h('h3', { text: title }), h('button', { class: 'x', 'aria-label': 'Fermer', onclick: function () { d.close() }, text: '×' })),
      h('div', { class: 'd-body' }, body),
      foot ? h('div', { class: 'd-foot' }, foot) : null)
    d.addEventListener('close', function () { d.remove() })
    document.body.appendChild(d)
    d.showModal()
    return d
  }

  // ── Connexion ──
  function logout(expired) {
    if (token && !expired && me && me.by === 'compte') fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(function () {})
    token = ''
    me = null
    sessionStorage.removeItem(KEY)
    renderLogin(expired ? 'Session expirée ou accès refusé : reconnectez-vous.' : '')
  }
  function enter(t) {
    token = t
    return api('GET', '/api/admin/me').then(function (m) {
      me = m
      sessionStorage.setItem(KEY, token)
      renderApp()
    })
  }
  function renderLogin(message) {
    var mode = 'compte'
    var user = h('input', { autocomplete: 'username', value: 'tenak27', spellcheck: 'false' })
    var pass = h('input', { type: 'password', autocomplete: 'current-password' })
    var tok = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false' })
    var fCompte = h('div', { class: 'grid', style: 'grid-template-columns:1fr' }, field('Identifiant', user), field('Mot de passe', pass, 'Compte administrateur de l’éditeur sur la base principale de ce serveur.'))
    var fJeton = h('div', { class: 'hide' }, field("Jeton d'administration", tok, 'Valeur ADMIN_TOKEN du serveur (fichier deploy/.env).'))
    var bC = h('button', { type: 'button', 'aria-pressed': 'true', text: 'Compte éditeur' })
    var bJ = h('button', { type: 'button', 'aria-pressed': 'false', text: 'Jeton du serveur' })
    function set(m) { mode = m; bC.setAttribute('aria-pressed', m === 'compte'); bJ.setAttribute('aria-pressed', m === 'jeton'); fCompte.classList.toggle('hide', m !== 'compte'); fJeton.classList.toggle('hide', m !== 'jeton') }
    bC.onclick = function () { set('compte') }
    bJ.onclick = function () { set('jeton') }
    var err = h('div', { class: 'box err' + (message ? '' : ' hide'), role: 'alert', text: message || '' })
    var go = h('button', { class: 'btn primary', type: 'submit', text: 'Se connecter' })
    var form = h('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault()
      go.disabled = true
      var p = mode === 'jeton'
        ? enter(tok.value.trim())
        : api('POST', '/api/login', { username: user.value, password: pass.value, device: 'Console éditeur' }, true).then(function (d) { return enter(d.token) })
      p.catch(function (e2) {
        token = ''
        err.textContent = /refusé|invalide/.test(e2.message) && mode === 'compte' ? 'Ce compte ne peut pas administrer le serveur : seul le compte administrateur « tenak27 » de la base principale y est autorisé.' : e2.message
        err.classList.remove('hide')
      }).then(function () { go.disabled = false })
    } }, h('div', { class: 'switch' }, bC, bJ), fCompte, fJeton, err, go)
    put(app, h('div', { class: 'weave' }), h('main', {}, h('div', { class: 'login' }, h('h2', { text: 'Console de l’éditeur' }), h('p', { class: 'sub', text: 'IAM INVOICER · sociétés hébergées et licences' }), form)))
    ;(mode === 'compte' ? pass : tok).focus()
  }

  // ── Application ──
  function renderApp() {
    var tabs = [['societes', 'Sociétés'], ['licences', 'Licences']].map(function (t) {
      return h('button', { class: 'tab', role: 'tab', 'aria-selected': String(view === t[0]), onclick: function () { view = t[0]; renderApp() }, text: t[1] })
    })
    var content = h('main', {})
    put(app, 
      h('header', { class: 'top' }, h('div', { class: 'top-in' },
        h('h1', {}, 'IAM INVOICER ', h('span', { text: '· console de l’éditeur' })),
        h('div', { class: 'tabs', role: 'tablist' }, tabs),
        h('div', { class: 'who' }, me.name + ' · v' + me.version + ' '),
        h('button', { class: 'btn small', onclick: function () { logout(false) }, text: 'Déconnexion' }))),
      h('div', { class: 'weave' }), content)
    if (view === 'societes') renderTenants(content)
    else renderLicences(content)
  }

  function licenceOptions(select, none) {
    put(select, h('option', { value: '', text: none }))
    licences.filter(function (l) { return !l.revoked }).forEach(function (l) {
      select.appendChild(h('option', { value: String(l.id), text: l.number + ' — ' + l.company + ' (' + (TIERS[l.tier] || l.tier) + (l.expires ? ', jusqu’au ' + fmtDate(l.expires) : ', perpétuelle') + ')' }))
    })
  }

  function renderTenants(root) {
    var body = h('tbody', {})
    var count = h('span', { class: 'sub' })
    put(root, 
      h('div', { class: 'bar' }, h('h2', { text: 'Sociétés hébergées' }), count, h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: load, text: 'Actualiser' }),
        h('button', { class: 'btn primary', onclick: newTenant, text: '+ Nouvelle société' })),
      h('div', { class: 'card' }, h('div', { class: 'wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Société', 'Adresse', 'État', 'Licence', 'Taille', 'Créée le', ''].map(function (t) { return h('th', { text: t }) }))), body))))
    function load() {
      return Promise.all([run(api('GET', '/api/admin/tenants')), api('GET', '/api/admin/licences').catch(function () { return [] })]).then(function (r) {
        tenants = r[0] || []
        licences = r[1] || []
        count.textContent = tenants.length + ' société(s)'
        put(body)
        if (!tenants.length) body.appendChild(h('tr', {}, h('td', { colspan: '7', class: 'empty', text: 'Aucune société pour l’instant. Créez la première avec « Nouvelle société ».' })))
        tenants.forEach(function (t, i) {
          var tr = h('tr', { style: 'animation-delay:' + Math.min(i * 30, 300) + 'ms' },
            h('td', {}, h('div', { class: 'name', text: t.name }), h('div', { class: 'sub', text: t.contact || '' })),
            h('td', {}, h('a', { href: urlOf(t.slug) + '/', target: '_blank', rel: 'noopener', text: '/t/' + t.slug })),
            h('td', {}, h('span', { class: 'badge ' + (t.status === 'active' ? 'b-ok' : 'b-off'), text: t.status === 'active' ? 'Active' : 'Suspendue' })),
            h('td', {}, t.licence_number ? h('span', { text: t.licence_number }) : h('span', { class: 'badge b-warn', text: 'Évaluation' })),
            h('td', { class: 'num', text: fmtSize(t.size) }),
            h('td', { text: fmtDate(t.created_at) }),
            h('td', { class: 'num' }, h('button', { class: 'btn small', onclick: function () { openTenant(t.slug, load) }, text: 'Gérer' })))
          body.appendChild(tr)
        })
      })
    }
    function newTenant() {
      var name = h('input', { required: true, placeholder: 'Raison sociale exacte' })
      var slug = h('input', { placeholder: 'déduit du nom', spellcheck: 'false' })
      var contact = h('input', { placeholder: 'Téléphone ou e-mail' })
      var notes = h('input', {})
      var lic = h('select', {})
      licenceOptions(lic, 'Aucune pour l’instant (évaluation de 30 jours)')
      var key = h('textarea', { placeholder: 'ou collez ici une clé de licence émise sur votre poste', spellcheck: 'false' })
      var save = h('button', { class: 'btn primary', text: 'Créer la base' })
      var d = dialog('Nouvelle société', h('div', { class: 'grid' },
        field('Raison sociale', name, 'La licence est établie à ce nom : il doit être celui que la société saisira.', true),
        field('Identifiant d’adresse', slug, 'Lettres minuscules, chiffres et « _ ».'), field('Contact', contact),
        field('Note interne', notes, null, true),
        field('Licence du registre', lic, null, true), field('Clé de licence', key, null, true)),
        [h('button', { class: 'btn', onclick: function () { d.close() }, text: 'Annuler' }), save])
      save.onclick = function () {
        if (!name.value.trim()) return name.focus()
        save.disabled = true
        var body = { name: name.value, slug: slug.value || undefined, contact: contact.value || undefined, notes: notes.value || undefined }
        if (lic.value) body.licence_id = Number(lic.value)
        else if (key.value.trim()) body.licence_key = key.value.trim()
        run(api('POST', '/api/admin/tenants', body)).then(function (c) {
          save.disabled = false
          if (!c) return
          d.close()
          load()
          var url = urlOf(c.slug)
          dialog('Base créée : ' + c.name, [
            h('div', { class: 'box' }, 'À transmettre à la société : l’adresse et le code d’activation. Le code est demandé une seule fois, à la première configuration.'),
            h('dl', { class: 'kv' }, h('dt', { text: 'Adresse' }), h('dd', { class: 'secret', text: url }), h('dt', { text: 'Code d’activation' }), h('dd', { class: 'secret', text: c.setup_code })),
            h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: function () { copy('Adresse : ' + url + '\nCode d’activation : ' + c.setup_code) }, text: 'Copier l’adresse et le code' })),
            h('details', {}, h('summary', { text: 'Accès direct à la base PostgreSQL (sauvegardes, outils)' }),
              h('dl', { class: 'kv', style: 'margin-top:10px' }, h('dt', { text: 'Base et utilisateur' }), h('dd', { class: 'secret', text: c.db_name }), h('dt', { text: 'Mot de passe' }), h('dd', { class: 'secret', text: c.db_password }), h('dt', { text: 'Serveur' }), h('dd', { text: c.db_host + ':' + c.db_port })),
              h('p', { class: 'sub', text: 'Ce mot de passe n’est affiché que maintenant.' }))])
        })
      }
      name.focus()
    }
    load()
  }

  // Créer et attribuer en un clic une licence au nom de la société (raison sociale déjà configurée)
  function quickLicence(t, slug, done) {
    var box = h('div', {})
    if (!me.canIssue) return put(box, h('h3', { style: 'font-size:15px', text: 'Créer une licence pour cette société' }), h('div', { class: 'box warn', text: 'Émission impossible depuis ce serveur : la clé privée de l’éditeur n’y est pas installée.' })), box
    var company = h('input', { value: t.company || t.name })
    var tier = h('select', {}, Object.keys(TIERS).filter(function (k) { return k !== 'sur-mesure' }).map(function (k) { return h('option', { value: k, text: TIERS[k], selected: k === 'pro' }) }))
    var users = h('input', { type: 'number', min: '0', placeholder: 'celui du palier' })
    var months = h('select', {}, [['12', '1 an'], ['1', '1 mois'], ['6', '6 mois'], ['24', '2 ans'], ['36', '3 ans'], ['', 'Perpétuelle']].map(function (o) { return h('option', { value: o[0], text: o[1] }) }))
    var go = h('button', { class: 'btn primary', text: 'Créer et attribuer' })
    go.onclick = function () {
      if (!company.value.trim()) return company.focus()
      var expires = null
      if (months.value) { var x = new Date(); x.setMonth(x.getMonth() + Number(months.value)); expires = x.toISOString().slice(0, 10) }
      go.disabled = true
      run(api('POST', '/api/admin/licences', { company: company.value.trim(), tier: tier.value, users: users.value, expires: expires, contact: t.contact || '' })).then(function (l) {
        if (!l) { go.disabled = false; return }
        licences.push(l)
        return run(api('POST', '/api/admin/tenants/' + slug + '/licence', { licence_id: l.id })).then(function (r) {
          go.disabled = false
          if (!r) return
          toast(r.warning ? 'Licence ' + r.number + ' créée et installée, mais pas encore active : ' + r.warning : 'Licence ' + r.number + ' créée et attribuée.', !!r.warning)
          done()
        })
      })
    }
    return put(box, h('h3', { style: 'font-size:15px', text: 'Créer une licence pour cette société' }),
      h('div', { class: 'grid' }, field('Au nom de', company, 'Raison sociale exacte de la société'), field('Palier', tier), field('Utilisateurs', users), field('Durée', months)),
      h('div', { class: 'actions' }, go)), box
  }

  function openTenant(slug, reload) {
    var body = h('div', { class: 'd-body', style: 'padding:0' }, h('p', { class: 'sub', text: 'Chargement…' }))
    var d = dialog('Société', body)
    function refresh() {
      return run(api('GET', '/api/admin/tenants/' + slug)).then(function (t) {
        if (!t) return
        d.querySelector('h3').textContent = t.name
        var L = t.licence
        var licBadge = !L ? h('span', { class: 'badge b-off', text: 'Base inaccessible' })
          : L.state === 'active' ? h('span', { class: 'badge b-ok', text: 'Licence ' + L.label + (L.number ? ' · ' + L.number : '') })
          : L.state === 'preinstalled' ? h('span', { class: 'badge b-ok', text: 'Licence ' + L.label + ' préinstallée · ' + L.number })
          : h('span', { class: 'badge ' + (L.state === 'trial' ? 'b-warn' : 'b-off'), text: L.label })
        var lic = h('select', {})
        licenceOptions(lic, 'Choisir une licence du registre…')
        var key = h('textarea', { placeholder: 'ou collez une clé de licence', spellcheck: 'false' })
        function act(action, okText, confirmText) {
          if (confirmText && !confirm(confirmText)) return
          run(api('POST', '/api/admin/tenants/' + slug + '/' + action, {}), okText).then(function (r) {
            if (r && r.setup_code) dialog('Nouveau code d’activation', h('p', { class: 'secret', text: r.setup_code }))
            if (r && r.sync_key) dialog('Clé de synchronisation', [h('p', { text: 'À saisir sur le serveur de l’entreprise (Société et paramètres → Données → Copie en ligne), avec l’adresse ' + urlOf(slug) + ' :' }), h('p', { class: 'secret', text: r.sync_key }), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: function () { copy('Adresse : ' + urlOf(slug) + '\nClé de synchronisation : ' + r.sync_key) }, text: 'Copier l’adresse et la clé' })), h('p', { class: 'sub', text: 'Affichée une seule fois. La base en ligne devient la copie de consultation du serveur de l’entreprise.' })])
            if (r && r.db_password) dialog('Nouveau mot de passe de la base', [h('p', { class: 'secret', text: r.db_password }), h('p', { class: 'sub', text: 'Affiché une seule fois. Les applications de la société ne sont pas concernées.' })])
            refresh()
            reload()
          })
        }
        put(body, 
          t.error ? h('div', { class: 'box err', text: 'Base inaccessible : ' + t.error }) : null,
          h('dl', { class: 'kv' },
            h('dt', { text: 'Adresse' }), h('dd', {}, h('a', { href: urlOf(slug) + '/', target: '_blank', rel: 'noopener', text: urlOf(slug) })),
            h('dt', { text: 'État' }), h('dd', {}, h('span', { class: 'badge ' + (t.status === 'active' ? 'b-ok' : 'b-off'), text: t.status === 'active' ? 'Active' : 'Suspendue' })),
            h('dt', { text: 'Configuration' }), h('dd', { text: t.configured ? 'Faite — raison sociale « ' + (t.company || '') + ' »' : 'En attente' + (t.setup_code ? ' · code d’activation ' + t.setup_code : '') }),
            h('dt', { text: 'Activité' }), h('dd', { text: (t.users || 0) + ' utilisateur(s) · ' + (t.documents || 0) + ' document(s) · ' + fmtSize(t.size) }),
            h('dt', { text: 'Licence' }), h('dd', {}, licBadge, L && L.expires ? ' jusqu’au ' + fmtDate(L.expires) : L && (L.state === 'active' || L.state === 'preinstalled') ? ' perpétuelle' : ''),
            h('dt', { text: 'Serveur d’entreprise' }), h('dd', { text: t.mirrored_at ? 'Copie reçue le ' + new Date(t.mirrored_at).toLocaleString('fr-FR') : t.has_sync_key ? 'Clé créée, aucune copie reçue pour l’instant' : 'Non : la société travaille directement en ligne' }),
            h('dt', { text: 'Contact' }), h('dd', { text: t.contact || '—' }),
            h('dt', { text: 'Note' }), h('dd', { text: t.notes || '—' })),
          L && L.state !== 'active' ? h('div', { class: 'box' + (L.state === 'preinstalled' ? '' : ' warn'), text: L.message }) : null,
          h('h3', { style: 'font-size:15px', text: 'Attribuer une licence' }),
          h('div', { class: 'grid' }, field('Licence du registre', lic, null, true), field('Clé de licence', key, null, true)),
          h('div', { class: 'actions' },
            h('button', { class: 'btn primary', onclick: function () {
              var payload = lic.value ? { licence_id: Number(lic.value) } : { licence_key: key.value.trim() }
              if (!lic.value && !key.value.trim()) return toast('Choisissez une licence du registre ou collez une clé.', true)
              run(api('POST', '/api/admin/tenants/' + slug + '/licence', payload)).then(function (r) {
                if (!r) return
                toast(r.warning ? 'Licence ' + r.number + ' installée, mais pas encore active.' : 'Licence ' + r.number + ' attribuée.', !!r.warning)
                refresh()
                reload()
              })
            }, text: 'Attribuer la licence' })),
          quickLicence(t, slug, function () { refresh(); reload() }),
          h('h3', { style: 'font-size:15px', text: 'Actions' }),
          h('div', { class: 'actions' },
            t.status === 'active'
              ? h('button', { class: 'btn', onclick: function () { act('suspend', 'Accès suspendu.', 'Suspendre l’accès de « ' + t.name + ' » ? Ses données sont conservées.') }, text: 'Suspendre' })
              : h('button', { class: 'btn', onclick: function () { act('resume', 'Accès rétabli.') }, text: 'Réactiver' }),
            !t.configured ? h('button', { class: 'btn', onclick: function () { act('setup-code', 'Nouveau code généré.') }, text: 'Nouveau code d’activation' }) : null,
            h('button', { class: 'btn', onclick: function () { act('sync-key', 'Clé de synchronisation créée.', t.has_sync_key ? 'Créer une nouvelle clé ? L’ancienne cessera de fonctionner : le serveur de l’entreprise devra recevoir la nouvelle.' : 'Créer une clé de synchronisation ? Le serveur installé dans l’entreprise pourra remplacer le contenu de cette base en ligne par sa copie.') }, text: t.has_sync_key ? 'Nouvelle clé de synchronisation' : 'Clé de synchronisation (serveur d’entreprise)' }),
            h('button', { class: 'btn', onclick: function () { act('password', 'Mot de passe changé.', 'Changer le mot de passe PostgreSQL de cette base ?') }, text: 'Nouveau mot de passe de base' }),
            h('button', { class: 'btn danger', onclick: function () {
              var typed = prompt('Suppression DÉFINITIVE de la base de « ' + t.name + ' » et de toutes ses données.\nFaites une sauvegarde avant.\n\nPour confirmer, saisissez l’identifiant : ' + slug)
              if (typed === null) return
              run(api('DELETE', '/api/admin/tenants/' + slug + '?confirm=' + encodeURIComponent(typed.trim())), 'Base supprimée.').then(function (r) { if (r !== undefined) { d.close(); reload() } })
            }, text: 'Supprimer la base' })))
        body.style.padding = '18px 22px'
      })
    }
    refresh()
  }

  function renderLicences(root) {
    var body = h('tbody', {})
    var count = h('span', { class: 'sub' })
    put(root, 
      h('div', { class: 'bar' }, h('h2', { text: 'Licences émises' }), count, h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: load, text: 'Actualiser' }),
        h('button', { class: 'btn primary', onclick: issue, text: '+ Nouvelle licence' })),
      me.canIssue ? null : h('div', { class: 'box warn', style: 'margin-bottom:16px' }, 'L’émission de licences n’est pas possible depuis ce serveur : la clé privée de l’éditeur n’y est pas installée. Émettez la licence sur votre poste (Administration → Émission de licences), puis collez sa clé dans la fiche de la société, onglet « Sociétés ».'),
      h('div', { class: 'card' }, h('div', { class: 'wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Numéro', 'Société', 'Palier', 'Utilisateurs', 'Émise le', 'Fin', 'État', ''].map(function (t) { return h('th', { text: t }) }))), body))))
    function load() {
      return run(api('GET', '/api/admin/licences')).then(function (list) {
        licences = list || []
        count.textContent = licences.length + ' licence(s)'
        put(body)
        if (!licences.length) body.appendChild(h('tr', {}, h('td', { colspan: '8', class: 'empty', text: 'Aucune licence au registre de ce serveur.' })))
        licences.forEach(function (l, i) {
          var expired = l.expires && l.expires < new Date().toISOString().slice(0, 10)
          body.appendChild(h('tr', { style: 'animation-delay:' + Math.min(i * 30, 300) + 'ms' },
            h('td', { class: 'name', text: l.number }),
            h('td', {}, h('div', { text: l.company }), h('div', { class: 'sub', text: [l.tax_id, l.contact].filter(Boolean).join(' · ') })),
            h('td', { text: TIERS[l.tier] || l.tier }),
            h('td', {}, h('div', { text: l.users ? String(l.users) : 'illimité' }), h('div', { class: 'sub', text: l.seats ? l.seats + ' poste(s)' : 'postes illimités' })),
            h('td', { text: fmtDate(l.issued) }),
            h('td', { text: l.expires ? fmtDate(l.expires) : 'perpétuelle' }),
            h('td', {}, h('span', { class: 'badge ' + (l.revoked ? 'b-off' : expired ? 'b-warn' : 'b-ok'), text: l.revoked ? 'Révoquée' : expired ? 'Expirée' : 'Valide' })),
            h('td', { class: 'num' }, h('div', { class: 'actions', style: 'justify-content:flex-end' },
              h('button', { class: 'btn small', onclick: function () { copy(l.licence_key) }, text: 'Copier la clé' }),
              h('button', { class: 'btn small', onclick: function () { if (confirm(l.revoked ? 'Rétablir la licence ' + l.number + ' ?' : 'Marquer la licence ' + l.number + ' comme révoquée au registre ?')) run(api('POST', '/api/admin/licences/' + l.id + '/revoke', {}), l.revoked ? 'Licence rétablie.' : 'Licence révoquée.').then(load) }, text: l.revoked ? 'Rétablir' : 'Révoquer' })))))
        })
      })
    }
    function issue() {
      if (!me.canIssue) return toast('Émission impossible depuis ce serveur : clé privée de l’éditeur absente.', true)
      var company = h('input', { required: true, placeholder: 'Exactement comme configurée chez la société' })
      var tax = h('input', {})
      var tier = h('select', {}, Object.keys(TIERS).filter(function (k) { return k !== 'sur-mesure' }).map(function (k) { return h('option', { value: k, text: TIERS[k], selected: k === 'pro' }) }))
      var users = h('input', { type: 'number', min: '0', placeholder: 'celui du palier (0 = illimité)' })
      var seats = h('input', { type: 'number', min: '0', placeholder: '0 = illimité' })
      var months = h('select', {}, [['12', '1 an'], ['1', '1 mois'], ['6', '6 mois'], ['24', '2 ans'], ['36', '3 ans'], ['', 'Perpétuelle']].map(function (o) { return h('option', { value: o[0], text: o[1] }) }))
      var contact = h('input', {})
      var assign = h('select', {}, h('option', { value: '', text: 'Ne pas attribuer maintenant' }), tenants.map(function (t) { return h('option', { value: t.slug, text: t.name + ' (/t/' + t.slug + ')' }) }))
      var save = h('button', { class: 'btn primary', text: 'Émettre la licence' })
      var d = dialog('Nouvelle licence', h('div', { class: 'grid' },
        field('Raison sociale', company, null, true), field('Identifiant fiscal (IFU)', tax, 'Facultatif'), field('Contact', contact),
        field('Palier', tier), field('Utilisateurs', users), field('Postes clients', seats, 'Appareils qui peuvent se connecter au serveur : base de la facturation.'), field('Durée', months), field('Attribuer à', assign, null, true)),
        [h('button', { class: 'btn', onclick: function () { d.close() }, text: 'Annuler' }), save])
      save.onclick = function () {
        if (!company.value.trim()) return company.focus()
        var expires = null
        if (months.value) { var x = new Date(); x.setMonth(x.getMonth() + Number(months.value)); expires = x.toISOString().slice(0, 10) }
        save.disabled = true
        run(api('POST', '/api/admin/licences', { company: company.value, tax_id: tax.value, tier: tier.value, users: users.value, seats: seats.value, expires: expires, contact: contact.value })).then(function (l) {
          save.disabled = false
          if (!l) return
          d.close()
          var next = assign.value ? run(api('POST', '/api/admin/tenants/' + assign.value + '/licence', { licence_id: l.id }), 'Licence attribuée à la société.') : Promise.resolve()
          next.then(load)
          dialog('Licence ' + l.number, [h('p', { text: 'Clé à transmettre à la société (Société et paramètres → Licence) :' }), h('p', { class: 'secret', text: l.licence_key }), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: function () { copy(l.licence_key) }, text: 'Copier la clé' }))])
        })
      }
      company.focus()
    }
    if (!tenants.length) api('GET', '/api/admin/tenants').then(function (t) { tenants = t }, function () {})
    load()
  }

  if (token) enter(token).catch(function () { logout(true) })
  else renderLogin('')
})()
`

export function adminPageHtml(version: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Console éditeur — IAM INVOICER ${version.replace(/[^0-9A-Za-z.-]/g, '')}</title>
<style>${CSS}</style></head>
<body><div id="app"></div><noscript>Cette console a besoin de JavaScript.</noscript>
<script>${JS}</script></body></html>`
}
