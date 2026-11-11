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

// ── Mascotte : elle le matin et le soir, lui l'après-midi et la nuit. Elle joue des scènes qui s'enchaînent
//    (salut, au travail devant l'ordinateur, danse, téléphone) : chaque scène alterne ses images et a son
//    mouvement (premium.css). Un clic passe à la scène suivante avec un mot dans une bulle ; elle se penche
//    vers le pointeur. Mouvement réduit demandé : image fixe, la scène ne change qu'au clic. ──
;(function () {
  var imgs = Array.prototype.slice.call(document.querySelectorAll('img.mascotte'))
  if (!imgs.length) return
  var h = new Date().getHours()
  var g = (h >= 6 && h < 12) || h >= 18 ? 'f' : 'h'
  var src = function (p) { return 'assets/mascotte/' + g + '-' + p + '.webp' }
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  var hello = h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir'
  var demo = document.querySelector('a[href*="demo"], [data-demo]')
  // Scène : images [nom, durée en ms], durée de la scène, mot dit au clic
  var SCENES = [
    { name: 'salut', frames: [['salut', 2600], ['ok', 1500], ['salut', 2200], ['montre', 1600]], last: 11000, say: demo ? 'Essayez la version démo, sans créer de compte' : 'Découvrez nos dix logiciels' },
    { name: 'ordi', frames: [['ordi1', 3400], ['ordi2', 1500]], last: 12000, say: 'Au travail : devis, factures et suivi, tout au même endroit' },
    { name: 'danse', frames: [['danse1', 460], ['danse2', 460]], last: 7000, say: 'Une tâche de moins, ça se fête' },
    { name: 'tel', frames: [['tel1', 3200], ['tel2', 1700]], last: 11000, say: 'Tout se suit aussi depuis le téléphone' },
  ]
  SCENES.forEach(function (s) { s.frames.forEach(function (f) { new Image().src = src(f[0]) }) })
  imgs.forEach(function (img, n) {
    var scene = 0, frame = 0, started = 0, timer, hide
    var bulle = document.createElement('span')
    bulle.className = 'mascotte-bulle'
    img.parentNode.insertBefore(bulle, img.nextSibling)
    var say = function (text) {
      bulle.textContent = text
      bulle.style.left = Math.max(70, img.offsetLeft - 100) + 'px'
      bulle.style.top = Math.max(8, img.offsetTop + img.offsetHeight * 0.08) + 'px'
      bulle.classList.add('on')
      clearTimeout(hide)
      hide = setTimeout(function () { bulle.classList.remove('on') }, 5200)
    }
    var step = function () {
      var s = SCENES[scene]
      img.src = src(s.frames[frame][0])
      if (reduce) return
      timer = setTimeout(function () {
        // Onglet en arrière-plan : la scène attend
        if (document.hidden) { step(); return }
        frame += 1
        if (frame >= s.frames.length) {
          frame = 0
          if (Date.now() - started > s.last) { play(scene + 1); return }
        }
        step()
      }, document.hidden ? 1500 : s.frames[frame][1])
    }
    var play = function (k, talk) {
      clearTimeout(timer)
      SCENES.forEach(function (s) { img.classList.remove('sc-' + s.name) })
      scene = k % SCENES.length
      frame = 0
      started = Date.now()
      img.classList.add('sc-' + SCENES[scene].name)
      if (!reduce && img.animate) img.animate([{ scale: 0.93 }, { scale: 1 }], { duration: 420, easing: 'cubic-bezier(.2, .9, .3, 1.2)' })
      if (talk) say(SCENES[scene].say)
      step()
    }
    img.addEventListener('click', function () { play(scene + 1, true) })
    // Le premier personnage salue à l'arrivée ; le second commence au travail
    play(n === 0 ? 0 : 1)
    if (n === 0) setTimeout(function () { say(hello + ' et bienvenue') }, 1400)
    if (reduce) return
    addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return
      var r = img.getBoundingClientRect()
      if (r.bottom < 0 || r.top > innerHeight) return
      var dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 600))
      img.style.setProperty('--mr', (dx * 3).toFixed(2) + 'deg')
      img.style.setProperty('--mx', (dx * 8).toFixed(1) + 'px')
    }, { passive: true })
  })
})()
