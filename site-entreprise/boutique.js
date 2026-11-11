// Produits et boutique du site d'IAM Technology. Les articles sont choisis dans IAM INVOICER (base de la
// société) et lus par GET {data-shop}/api/public/shop : ceux mis en avant (showcase) remplissent la section
// « Nos produits » de l'accueil (#produits), ceux vendus (shop) la page de la boutique (#boutique), avec
// panier et commande en POST {data-shop}/api/public/shop/order (devis en brouillon dans IAM INVOICER).
// Aucune donnée reçue n'est insérée comme du HTML : tout passe par textContent.
;(function () {
  var page = document.getElementById('boutique'), home = document.getElementById('produits')
  var box = page || home
  if (!box || !window.fetch) return
  var base = box.getAttribute('data-shop')
  var $ = function (id) { return document.getElementById(id) }
  var el = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  var shop = null, cart = {}, filter = ''
  // Espace insécable avant la devise : le montant ne se coupe jamais entre le nombre et « FCFA »
  var money = function (n) { return Math.round(n).toLocaleString('fr-FR') + ' ' + (shop.company.currency || 'FCFA') }
  var count = function () { return Object.keys(cart).reduce(function (s, k) { return s + cart[k] }, 0) }
  var total = function () { return shop.items.reduce(function (s, p) { return s + (cart[p.id] || 0) * p.price }, 0) }

  function card(p, i) {
    var a = el('article', 'shop-card')
    a.setAttribute('role', 'listitem')
    a.style.setProperty('--i', i)
    var pic = el('div', 'shop-img')
    if (p.image) {
      var img = el('img')
      img.src = base + '/api/public/shop/image/' + p.id
      img.alt = ''
      img.loading = 'lazy'
      img.decoding = 'async'
      pic.appendChild(img)
    } else pic.appendChild(el('span', '', p.name.charAt(0).toUpperCase()))
    a.appendChild(pic)
    var body = el('div', 'shop-body')
    if (p.category) body.appendChild(el('span', 'shop-cat', p.category))
    body.appendChild(el('h3', '', p.name))
    if (p.description) body.appendChild(el('p', 'shop-desc', p.description))
    if (!p.available) body.appendChild(el('span', 'shop-order', 'Sur commande'))
    var foot = el('div', 'shop-foot')
    var price = el('div', 'shop-price')
    price.appendChild(el('b', '', money(p.price)))
    price.appendChild(el('small', '', (p.taxed ? 'TTC, ' : '') + 'par ' + (p.unit || 'unité')))
    foot.appendChild(price)
    var slot = el('div')
    foot.appendChild(slot)
    // Accueil : un lien vers la boutique (ou vers le contact si l'article n'y est pas vendu)
    if (!page) {
      var go = el('a', 'shop-add', p.shop ? 'Commander' : 'Demander un prix')
      go.href = p.shop ? 'boutique.html?article=' + p.id : '#contact'
      slot.appendChild(go)
      body.appendChild(foot)
      a.appendChild(body)
      return a
    }
    function draw() {
      slot.textContent = ''
      var q = cart[p.id] || 0
      if (!q) {
        var add = el('button', 'shop-add', 'Ajouter')
        add.type = 'button'
        add.setAttribute('aria-label', 'Ajouter ' + p.name + ' au panier')
        add.addEventListener('click', function () { set(1) })
        slot.appendChild(add)
        return
      }
      var qty = el('div', 'shop-qty')
      var less = el('button', '', '−'), more = el('button', '', '+')
      less.type = more.type = 'button'
      less.setAttribute('aria-label', 'Retirer un ' + p.name)
      more.setAttribute('aria-label', 'Ajouter un ' + p.name)
      less.addEventListener('click', function () { set(q - 1) })
      more.addEventListener('click', function () { set(Math.min(999, q + 1)) })
      qty.appendChild(less); qty.appendChild(el('output', '', q)); qty.appendChild(more)
      slot.appendChild(qty)
    }
    function set(q) {
      if (q > 0) cart[p.id] = q; else delete cart[p.id]
      draw()
      bar()
    }
    draw()
    body.appendChild(foot)
    a.appendChild(body)
    return a
  }

  function grid() {
    var g = $('shop-grid')
    g.textContent = ''
    sold().filter(function (p) { return !filter || p.category === filter }).forEach(function (p, i) { g.appendChild(card(p, i)) })
  }
  function sold() { return shop.items.filter(function (p) { return p.shop }) }

  function filters() {
    var cats = sold().map(function (p) { return p.category }).filter(function (c, i, all) { return c && all.indexOf(c) === i })
    var f = $('shop-filters')
    f.textContent = ''
    if (cats.length < 2) return
    ;[''].concat(cats).forEach(function (c) {
      var b = el('button', '', c || 'Tout')
      b.type = 'button'
      b.setAttribute('aria-pressed', String(c === filter))
      b.addEventListener('click', function () { filter = c; filters(); grid() })
      f.appendChild(b)
    })
  }

  function bar() {
    var n = count()
    $('shop-cart').hidden = !n
    $('shop-cart-text').textContent = n + (n > 1 ? ' articles' : ' article') + ' · ' + money(total())
  }

  function open() {
    var lines = $('shop-lines')
    lines.textContent = ''
    shop.items.forEach(function (p) {
      if (!cart[p.id]) return
      var li = el('li')
      li.appendChild(el('span', '', cart[p.id] + ' × ' + p.name))
      li.appendChild(el('span', '', money(cart[p.id] * p.price)))
      lines.appendChild(li)
    })
    $('shop-total').textContent = money(total())
    $('shop-error').hidden = true
    $('shop-form').hidden = false
    $('shop-done').hidden = true
    var d = $('shop-dialog')
    if (d.showModal) d.showModal(); else d.setAttribute('open', '')
  }
  function close() { var d = $('shop-dialog'); if (d.close) d.close(); else d.removeAttribute('open') }

  function send(e) {
    e.preventDefault()
    var form = $('shop-form'), err = $('shop-error'), btn = $('shop-send')
    var v = function (n) { return (form.elements[n].value || '').trim() }
    var fail = function (text) { err.textContent = text; err.hidden = false }
    if (v('name').length < 2) return fail('Indiquez votre nom.')
    if (v('phone').replace(/\D/g, '').length < 8) return fail('Indiquez un numéro de téléphone valide.')
    var pay = form.querySelector('input[name="payment"]:checked')
    err.hidden = true
    btn.disabled = true
    btn.textContent = 'Envoi…'
    fetch(base + '/api/public/shop/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: v('name'), phone: v('phone'), email: v('email'), city: v('city'), note: v('note'), website: v('website'),
        payment: pay ? pay.value : '',
        items: Object.keys(cart).map(function (id) { return { id: Number(id), qty: cart[id] } })
      })
    })
      // Réponse illisible (page d'erreur du serveur) : traitée comme un refus, sans message technique
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: r.status === 429 ? 'Trop de demandes en peu de temps. Réessayez dans quelques minutes.' : '' } }) })
      .then(function (r) {
        if (!r.ok) {
          // Seul le message écrit pour le client est affiché (said) ; toute autre erreur reste générique
          var refused = new Error(r.error || 'La commande n’a pas pu être enregistrée. Réessayez ou appelez-nous.')
          refused.said = true
          throw refused
        }
        var d = r.data
        $('shop-done-text').textContent = 'Commande ' + d.order + ' : ' + money(d.total) + '.\n' +
          (d.payment ? 'Paiement choisi : ' + d.payment + '.\n' : '') +
          'Nous vous appelons pour confirmer' + (d.phone ? '. Vous pouvez aussi nous joindre au ' + d.phone : '') + '.'
        cart = {}
        grid(); bar()
        form.reset()
        form.hidden = true
        $('shop-done').hidden = false
      })
      .catch(function (x) { fail(x && x.said ? x.message : 'Connexion impossible. Vérifiez votre connexion puis réessayez, ou appelez-nous.') })
      .then(function () { btn.disabled = false; btn.textContent = 'Envoyer la commande' })
  }

  fetch(base + '/api/public/shop')
    .then(function (r) { return r.json() })
    .then(function (r) {
      shop = r.ok && r.data ? r.data : { open: false, items: [], payments: [], company: {} }
      var shown = function (attr, on) { Array.prototype.forEach.call(document.querySelectorAll('[' + attr + ']'), function (a) { a.hidden = !on }) }
      shown('data-shop-link', sold().length > 0)
      shown('data-products-link', shop.items.some(function (p) { return p.showcase }))
      if (!page) {
        // Accueil : les articles mis en avant
        var picks = shop.items.filter(function (p) { return p.showcase })
        if (!picks.length) return
        picks.forEach(function (p, i) { $('produits-grid').appendChild(card(p, i)) })
        home.hidden = false
        return
      }
      if (!sold().length) { $('shop-empty').hidden = false; return }
      if (shop.intro) $('shop-intro').textContent = shop.intro
      var list = $('shop-pay-list'), radios = $('shop-payments')
      shop.payments.forEach(function (p, i) {
        list.appendChild(el('li', '', p))
        var label = el('label'), input = el('input')
        input.type = 'radio'; input.name = 'payment'; input.value = p; input.checked = i === 0
        label.appendChild(input); label.appendChild(el('span', '', p))
        radios.appendChild(label)
      })
      $('shop-pay').hidden = false
      // Arrivée depuis « Commander » sur l'accueil : l'article est déjà dans le panier
      var asked = Number((/[?&]article=(\d+)/.exec(location.search) || [])[1])
      if (asked && sold().some(function (p) { return p.id === asked })) cart[asked] = 1
      filters(); grid(); bar()
      $('shop-checkout').addEventListener('click', open)
      $('shop-close').addEventListener('click', close)
      $('shop-done-close').addEventListener('click', close)
      $('shop-form').addEventListener('submit', send)
      $('shop-dialog').addEventListener('click', function (e) { if (e.target === e.currentTarget) close() })
    })
    .catch(function () { if (page) $('shop-empty').hidden = false })
})()
