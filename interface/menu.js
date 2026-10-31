// Le menu de BiRTEC, chargé par la coquille commune de KTEC (page /birtec/).
// Pour ajouter un écran : créer son bloc (blocs/<nom>/vue.js) puis l'ajouter à la liste blocs.

import constructeur from '../blocs/constructeur/vue.js'
import indicateur from '../blocs/indicateur/vue.js'
import assistant from '../blocs/assistant/vue.js'
import base from '../blocs/base/vue.js'
import rapports from '../blocs/rapports/vue.js'
import connaissances from '../blocs/connaissances/vue.js'
import indicateurs from '../blocs/indicateurs/vue.js'
import schema from '../blocs/schema/vue.js'
import configuration from '../blocs/configuration/vue.js'
import aide from '../blocs/aide/vue.js'
import { demanderMotDePasse } from '/socle/connexion.js'

// L'ordre est celui du menu. La constellation est le premier écran : c'est par elle qu'on commence.
export const blocs = [schema, constructeur, indicateur, rapports, indicateurs, base, connaissances, assistant, configuration, aide]
export { schema as accueil }
export const configurationBloc = 'configuration'
export const styles = 'interface/app.css'

// Premier lancement : la connexion MySQL est à renseigner. Ensuite : le mot de passe est demandé
// (une seule fois pour toutes les applications KTEC).
export function auDemarrage(etat) {
  if (!etat.connexion.configuree) location.hash = '#/configuration'
  else if (!etat.connexion.ouverte) demanderMotDePasse({ automatique: true })
}
