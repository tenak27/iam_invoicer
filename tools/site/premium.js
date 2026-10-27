// Comportements communs des sites, ajoutés en fin de page par tools/site/premium.mjs (site d'IAM
// INVOICER, d'IAM Technology et des logiciels) : barre du haut qui tient sur une ligne, menu qui suit
// la section lue, liste des logiciels de la gamme, carte de téléchargement de l'appareil du visiteur en tête.
;(function () {
  var all = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)) }

  // ── Barre du haut : quand tout ne tient pas sur une ligne, elle s'élargit (si l'écran le permet),
  //    puis se resserre (liens plus serrés, numéro de téléphone masqué), et en dernier recours passe au
  //    menu repliable, comme sur tablette ──
  var bar = document.getElementById('nav')
  var barIn = bar && bar.querySelector('.nav-in')
  var burger = bar && bar.querySelector('.menu-toggle')
  var fit = function () {
    if (!barIn || !burger) return
    bar.classList.remove('wide', 'tight', 'compact')
    if (getComputedStyle(burger).display !== 'none') return
    var over = function () { return barIn.scrollWidth > barIn.clientWidth + 1 }
    var steps = ['wide', 'tight', 'compact']
    for (var i = 0; i < steps.length && over(); i++) bar.classList.add(steps[i])
  }
  fit()
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit)
  addEventListener('load', fit)

  // ── Accueil : les mots qui tournent (#rot) tiennent dans la colonne du titre. La phrase la plus longue
  //    fixe une taille commune (aucun saut d'une phrase à l'autre) ; sur ordinateur, l'illustration
  //    empiète de quelques pixels sur la colonne, d'où la marge ──
  var rot = document.getElementById('rot')
  if (rot) {
    var fitRot = function () {
      rot.style.removeProperty('--rot-fit')
      var title = rot.closest('h1') || rot.parentElement
      var room = title.clientWidth - (innerWidth > 1040 ? 28 : 4)
      var widest = 0
      all('span', rot).forEach(function (s) {
        var range = document.createRange()
        range.selectNodeContents(s)
        widest = Math.max(widest, range.getBoundingClientRect().width)
      })
      if (room > 0 && widest > room) rot.style.setProperty('--rot-fit', (room / widest).toFixed(3))
    }
    fitRot()
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitRot)
    addEventListener('resize', fitRot)
  }

  // ── Menu : la section à l'écran est signalée (aria-current) ; sur ordinateur, une pastille glisse
  //    d'un lien à l'autre (elle apparaît sur place, sans venir du bord, quand elle était cachée) ──
  var menu = document.getElementById('menu')
  // Liens de sections seulement (pas les boutons du menu replié)
  var links = menu ? all(':scope > a[href^="#"]', menu) : []
  if (links.length && 'IntersectionObserver' in window) {
    var ind = document.createElement('span')
    ind.className = 'menu-ind'
    ind.setAttribute('aria-hidden', 'true')
    menu.appendChild(ind)
    var byId = {}
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a })
    var current = null
    var place = function (a, jump) {
      if (jump) ind.classList.add('jump')
      ind.style.width = a.offsetWidth + 'px'
      ind.style.transform = 'translateX(' + a.offsetLeft + 'px)'
      if (jump) { void ind.offsetWidth; ind.classList.remove('jump') }
    }
    var set = function (a) {
      if (a === current) return
      if (current) current.removeAttribute('aria-current')
      if (a) { a.setAttribute('aria-current', 'true'); place(a, !current) }
      ind.classList.toggle('on', !!a)
      current = a
    }
    // Une bande fine au milieu de l'écran : la section qui la traverse est celle qu'on lit
    var spy = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) set(byId[e.target.id] || null) })
    }, { rootMargin: '-45% 0px -54% 0px' })
    all('main section[id]').forEach(function (s) { spy.observe(s) })
    addEventListener('resize', function () { fit(); if (current) place(current, true) })
  } else addEventListener('resize', fit)

  // ── La gamme (gamme.mjs) : le bouton « Nos logiciels » ouvre la liste ; Échap, un clic à côté ou un
  //    lien la referment. Dans le menu replié, « Nos autres logiciels » ferme le menu et ouvre la liste ──
  var appsBtn = document.querySelector('.apps-toggle')
  var gamme = document.getElementById('gamme')
  if (appsBtn && gamme) {
    var opened = false
    var scrim = document.querySelector('.gamme-scrim')
    // Le panneau est hors de la barre (position fixe) : il se place sous elle, aligné sur son bord droit
    var placeGamme = function () {
      if (!barIn) return
      var r = barIn.getBoundingClientRect()
      gamme.style.top = (r.bottom + 10) + 'px'
      gamme.style.right = Math.max(12, innerWidth - r.right + 8) + 'px'
    }
    addEventListener('scroll', function () { if (opened) placeGamme() }, { passive: true })
    addEventListener('resize', function () { if (opened) placeGamme() })
    var openGamme = function (show, fromKeyboard) {
      opened = show
      if (show) placeGamme()
      gamme.hidden = !show
      if (scrim) scrim.hidden = !show
      appsBtn.setAttribute('aria-expanded', String(show))
      if (show) {
        if (menu && menu.classList.contains('open')) {
          menu.classList.remove('open')
          var mt = document.querySelector('.menu-toggle')
          if (mt) mt.setAttribute('aria-expanded', 'false')
        }
        if (fromKeyboard) { var first = gamme.querySelector('a'); if (first) first.focus() }
      }
    }
    appsBtn.addEventListener('click', function (e) { e.stopPropagation(); openGamme(!opened, e.detail === 0) })
    gamme.addEventListener('click', function (e) { if (e.target.closest('a')) openGamme(false) })
    document.addEventListener('click', function (e) { if (opened && !gamme.contains(e.target)) openGamme(false) })
    document.addEventListener('keydown', function (e) { if (opened && e.key === 'Escape') { openGamme(false); appsBtn.focus() } })
    all('[data-gamme]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); openGamme(true, e.detail === 0) }) })
    // Le menu replié qui s'ouvre referme la liste
    var mt2 = document.querySelector('.menu-toggle')
    if (mt2) mt2.addEventListener('click', function () { if (opened) openGamme(false) })
  }

  // ── Téléchargements : la carte de l'appareil du visiteur passe en tête, avec « Votre appareil » ──
  var ua = navigator.userAgent
  var ext = /Android/.test(ua) ? 'apk'
    : /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ipa'
    : /Macintosh/.test(ua) ? 'dmg'
    : /Windows/.test(ua) ? 'exe'
    : /Linux|X11/.test(ua) ? 'appimage' : ''
  if (ext) all('.dl-grid').forEach(function (grid) {
    var cards = all('.dl-card', grid)
    var mine = cards.filter(function (c) {
      var href = (c.getAttribute('href') || '').toLowerCase().split(/[?#]/)[0]
      return href.slice(-ext.length - 1) === '.' + ext
    })[0]
    if (!mine) return
    mine.classList.add('mine')
    mine.insertAdjacentHTML('afterbegin', '<em class="dl-mine">Votre appareil</em>')
    grid.classList.add('has-mine')
    grid.insertBefore(mine, grid.firstChild)
    // La cascade d'apparition suit le nouvel ordre
    all('.dl-card', grid).forEach(function (c, k) { c.style.setProperty('--d', k) })
  })
})()
