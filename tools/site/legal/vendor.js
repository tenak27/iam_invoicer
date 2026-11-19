// Remplit l'identité de l'éditeur et l'année dans les pages légales de tous les sites IAM Technology.
// Chargé par confidentialite / conditions / mentions-legales / cookies (une seule source d'informations).
(function () {
  var V = {
    name: 'IAM Technology',
    address: '',
    city: 'Ouagadougou',
    country: 'Burkina Faso',
    email: 'info@iamtechnology.store',
    phone: '+226 05 14 23 23',
    hours: 'du lundi au vendredi de 8 h à 18 h et le samedi de 8 h à 13 h'
  }
  document.querySelectorAll('[data-vendor]').forEach(function (el) {
    var key = el.getAttribute('data-vendor')
    var val = V[key]
    if (val == null) return
    if (el.getAttribute('data-vendor-href') === 'mailto') { el.href = 'mailto:' + V.email; el.textContent = V.email; return }
    if (key === 'phone' && el.tagName === 'A') { el.href = 'tel:' + val.replace(/\s/g, ''); el.textContent = val; return }
    el.textContent = val
  })
  var y = String(new Date().getFullYear())
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = y })
})()
