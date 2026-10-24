// Comportements communs des sites, ajoutés en fin de page par tools/site/premium.mjs (site d'IAM
// INVOICER, d'IAM Technology et des logiciels) : le menu suit la section lue, et la carte de
// téléchargement de l'appareil du visiteur passe en tête.
;(function () {
  var all = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)) }

  // ── Menu : la section à l'écran est signalée (aria-current) ; sur ordinateur, une pastille glisse
  //    d'un lien à l'autre (elle apparaît sur place, sans venir du bord, quand elle était cachée) ──
  var menu = document.getElementById('menu')
  var links = menu ? all('a[href^="#"]', menu) : []
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
    addEventListener('resize', function () { if (current) place(current, true) })
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
