// Liens de téléchargement toujours à jour (base commune des sites IAM : source
// iam-erp/tools/socle, recopiée par sync.mjs ; ne pas modifier ici).
// Chaque lien /telechargements/<fichier> du site est remplacé par le fichier le plus récent de même
// plateforme, même type et même processeur proposé par le serveur (/api/downloads), et le numéro
// de version affiché dans le lien suit. Sans réponse du serveur, les liens d'origine restent.
;(function () {
  var classify = function (name) {
    var n = String(name).toLowerCase()
    var ext = n.slice(n.lastIndexOf('.') + 1)
    var platform = ext === 'ipa' ? 'ios' : ext === 'apk' || ext === 'aab' ? 'android' : ext === 'dmg' || ext === 'pkg' || (ext === 'zip' && /mac|darwin|osx/.test(n)) ? 'macos' : ext === 'appimage' || ext === 'deb' ? 'linux' : 'windows'
    var arch = /universal/.test(n) ? 'universal' : /arm64|aarch64|apple-?silicon/.test(n) ? 'arm64' : /x64|x86_64|amd64|intel/.test(n) ? 'x64' : ''
    return { platform: platform, ext: ext, arch: arch, legacy: /ancien|legacy/.test(n), version: (/(\d+\.\d+\.\d+)/.exec(name) || [])[1] || '' }
  }
  var cmp = function (a, b) {
    var x = String(a || '0.0.0').split('.').map(Number), y = String(b || '0.0.0').split('.').map(Number)
    for (var i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
    return 0
  }
  var links = Array.prototype.slice.call(document.querySelectorAll('a[href*="/telechargements/"]'))
  if (!links.length || !window.fetch) return
  fetch('/api/downloads', { cache: 'no-cache' }).then(function (r) { return r.json() }).then(function (r) {
    var files = (r && r.ok && r.data && r.data.files) || []
    if (!files.length) return
    links.forEach(function (a) {
      var href = a.getAttribute('href')
      var name = decodeURIComponent(href.slice(href.indexOf('/telechargements/') + 17).split(/[?#]/)[0])
      var c = classify(name)
      var best = null
      files.forEach(function (f) {
        var d = classify(f.name)
        if (d.platform !== c.platform || d.ext !== c.ext || d.arch !== c.arch || d.legacy !== c.legacy) return
        if (!best || cmp(d.version, classify(best.name).version) > 0) best = f
      })
      if (!best || best.name === name) return
      a.setAttribute('href', best.url)
      var latest = classify(best.name).version
      // Numéro de version écrit dans le lien (texte et infobulle) : suit le fichier
      if (c.version && latest) {
        var walk = document.createTreeWalker(a, NodeFilter.SHOW_TEXT)
        for (var t = walk.nextNode(); t; t = walk.nextNode()) if (t.nodeValue.indexOf(c.version) >= 0) t.nodeValue = t.nodeValue.split(c.version).join(latest)
        if (a.title) a.title = a.title.split(c.version).join(latest)
      }
    })
  }).catch(function () {})
})()
