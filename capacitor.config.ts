import type { CapacitorConfig } from '@capacitor/cli'

// Applications iOS et Android : l'interface web compilée (out/web) dans une
// coque native, connectée au serveur IAM INVOICER de la société.
const config: CapacitorConfig = {
  appId: 'com.iamtechnology.invoicer',
  appName: 'IAM INVOICER',
  webDir: 'out/web',
  backgroundColor: '#0b4f8a',
  android: {
    // Autorise un serveur http:// sur le réseau local (tests) ; en production, utilisez https://.
    allowMixedContent: true
  },
  ios: {
    contentInset: 'never',
    scheme: 'IAM INVOICER'
  },
  plugins: {
    // Android : marges de la barre d'état et de l'encoche exposées en variables CSS (--safe-area-inset-*),
    // y compris en paysage, là où la WebView ne fournit pas toujours env(safe-area-inset-*).
    SystemBars: { insetsHandling: 'css' }
  }
}

export default config
