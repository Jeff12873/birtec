// « blocs/base/vue.js » dans BiRTEC éco+ : l'extraction des tables lit la base, donc elle se fait dans K.NOVA.
import { notifier } from '/socle/ui.js'

export async function extraireTables() {
  notifier('L’extraction des tables lit la base : faites-la dans K.NOVA.', 'erreur')
}
