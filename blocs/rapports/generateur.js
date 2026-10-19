// Construit un fichier .rptdesign (BIRT 4.x) à partir d'une description simple, écrite par le formulaire,
// par l'IA ou à la main.
//
// Un rapport est une page faite de blocs, les uns sous les autres :
// {
//   "titre": "Dépannages par ligne",
//   "sousTitre": "…", "orientation": "portrait" | "paysage",                     (facultatifs)
//   "parametres": [ { "nom": "debut", "libelle": "Du", "type": "date", "defaut": "2026-01-01" },
//                   { "nom": "ligne", "libelle": "Ligne", "type": "texte", "defaut": "", "optionnel": true,
//                     "liste": { "requete": "SELECT DISTINCT … AS valeur …" } } ],   (liste : choix dans une liste)
//   "blocs": [
//     { "type": "tableau", "titre": "…", "requete": "SELECT … WHERE d >= ? AND d <= ?", "liaisons": ["debut", "fin"],
//       "colonnes": [ { "champ": "heures", "libelle": "Heures", "format": "decimal", "total": "somme",
//                       "regles": [ { "operateur": ">", "valeur": 2, "couleur": "rouge" } ] } ],
//       "groupes": [ { "champ": "ligne", "libelle": "Ligne", "sousTotaux": true, "sautDePage": false } ] },
//     { "type": "graphique", "requete": "…", "forme": "barres", "categorie": "mois", "series": [{ "champ": "nombre", "libelle": "Nombre" }],
//       "serie": "type", "empile": false },
//     { "type": "croise", "requete": "…", "lignes": "ligne", "colonnes": "mois", "valeur": "nombre", "fonction": "somme" },
//     { "type": "chiffre", "requete": "…", "champ": "nombre", "libelle": "Dépannages ce mois", "format": "entier" },
//     { "type": "texte", "texte": "…" },
//     { "type": "saut" }
//   ]
// }
// « liaisons » : le paramètre de chaque « ? » de la requête du bloc, dans l'ordre.
// Formats : texte, entier, decimal, date, dateheure, pourcentage. Totaux : somme, moyenne, nombre, min, max.
//
// L'ancien format (un seul tableau : « requete », « colonnes », « groupes » au premier niveau) est toujours lu.
//
// Le mot de passe MySQL n'est jamais écrit dans le rapport : BiRTEC le fournit au moment de l'aperçu,
// et la GMAO utilise sa propre connexion.
//
// L'aspect et les conventions de connexion viennent de la « charte » du site (fichier .ktec, réglage
// « charte »), pour que les rapports ressemblent à ceux de la GMAO et s'y déposent tels quels :
// couleurs, police, feuille de style, logo, nom de la source de données, pilote, profil de connexion,
// paramètres cachés passés par la GMAO. Sans charte, un aspect neutre et une connexion simple.

import { modeleGraphique, FORMES } from './graphique.js'
import { tableauCroise } from './croise.js'

const VERSION_FORMAT = '3.2.23' // format des fichiers de BIRT Report Designer 4.8 (lu aussi par les versions suivantes)

export const CHARTE_PAR_DEFAUT = {
  couleurs: { titre: '#1F2937', entete: '#374151', texteEntete: '#FFFFFF', groupe: '#F3F4F6', ligne: '#DDDDDD' },
  police: 'sans-serif',
  feuilleStyle: '',        // ex. « _style.css » (dans les ressources du serveur BIRT)
  logo: '',                // expression JavaScript donnant l'adresse du logo, affiché en haut de page
  source: {
    nom: 'Données',
    pilote: 'com.mysql.cj.jdbc.Driver',
    optionsUrl: '',        // ajouté à l'adresse JDBC, ex. « ?useOldAliasMetadataBehavior=true »
    profilNom: '',         // profil de connexion BIRT : son nom,
    profilFichier: '',     // le fichier utilisé dans BIRT Designer,
    profilChemin: '',      // et l'expression JavaScript du fichier utilisé par le serveur BIRT
  },
  parametresCaches: [],    // [{ nom, type, defaut }] : paramètres passés par la GMAO dans l'adresse du rapport
}

// Thèmes au choix pour un rapport (« theme » de la description). « charte » = les couleurs de la charte du site.
export const THEMES = {
  charte: null,
  sobre: { couleurs: { titre: '#1F2937', entete: '#374151', texteEntete: '#FFFFFF', groupe: '#F3F4F6', ligne: '#DDDDDD' } },
  bleu: { couleurs: { titre: '#0B3D91', entete: '#1D4ED8', texteEntete: '#FFFFFF', groupe: '#DBEAFE', ligne: '#BFDBFE' } },
  vert: { couleurs: { titre: '#14532D', entete: '#1F5E3B', texteEntete: '#FFFFFF', groupe: '#E8F5EC', ligne: '#CFE8D7' } },
  orange: { couleurs: { titre: '#9A3412', entete: '#C2410C', texteEntete: '#FFFFFF', groupe: '#FFEDD5', ligne: '#FED7AA' } },
  impression: { couleurs: { titre: '#000000', entete: '#FFFFFF', texteEntete: '#000000', groupe: '#FFFFFF', ligne: '#000000' } },
}

// Couleurs des graphiques, par thème (la première est celle d'une série seule).
const PALETTES = {
  bleu: ['#1D4ED8', '#60A5FA', '#0EA5E9', '#1E3A8A', '#93C5FD', '#0369A1'],
  vert: ['#1F5E3B', '#4ADE80', '#15803D', '#86EFAC', '#065F46', '#A3E635'],
  orange: ['#C2410C', '#FB923C', '#F59E0B', '#7C2D12', '#FDBA74', '#B45309'],
  impression: ['#222222', '#777777', '#AAAAAA', '#444444', '#CCCCCC', '#999999'],
}

export function completerCharte(charte = {}) {
  const c = charte || {}
  return {
    ...CHARTE_PAR_DEFAUT,
    ...c,
    couleurs: { ...CHARTE_PAR_DEFAUT.couleurs, ...(c.couleurs || {}) },
    source: { ...CHARTE_PAR_DEFAUT.source, ...(c.source || {}) },
    parametresCaches: c.parametresCaches || [],
  }
}

const TYPES = {
  texte: { donnee: 'string', parametre: 'string' },
  entier: { donnee: 'integer', parametre: 'integer', nombre: '#,##0' },
  decimal: { donnee: 'decimal', parametre: 'decimal', nombre: '#,##0.00' },
  pourcentage: { donnee: 'decimal', parametre: 'decimal', nombre: '0.0 %', categorie: 'Percent' },
  date: { donnee: 'date', parametre: 'date', date: 'dd/MM/yyyy' },
  dateheure: { donnee: 'dateTime', parametre: 'dateTime', date: 'dd/MM/yyyy HH:mm' },
}

const FONCTIONS = { somme: 'SUM', moyenne: 'AVE', nombre: 'COUNT', min: 'MIN', max: 'MAX' }

export const TYPES_BLOCS = { tableau: 'Tableau', graphique: 'Graphique', croise: 'Tableau croisé', chiffre: 'Chiffre clé', texte: 'Texte', saut: 'Saut de page' }
export const BLOCS_DONNEES = ['tableau', 'graphique', 'croise', 'chiffre']

// Mise en évidence d'une cellule : opérateurs et couleurs (texte, fond).
const OPERATEURS_REGLES = { '>': 'gt', '>=': 'ge', '<': 'lt', '<=': 'le', '=': 'eq', '<>': 'ne', vide: 'null', non_vide: 'not-null' }
export const COULEURS_REGLES = {
  rouge: { color: '#B91C1C', backgroundColor: '#FEE2E2' },
  orange: { color: '#9A3412', backgroundColor: '#FFEDD5' },
  vert: { color: '#166534', backgroundColor: '#DCFCE7' },
  bleu: { color: '#1E40AF', backgroundColor: '#DBEAFE' },
  gras: { fontWeight: 'bold' },
}

// L'ancien format (un seul tableau au premier niveau) mis au format en blocs.
export function normaliserDescription(d) {
  if (!d || typeof d !== 'object') return d
  if (Array.isArray(d.blocs)) return { ...d, parametres: d.parametres || [] }
  const { requete, liaisons, colonnes, groupes, ...reste } = d
  const parametres = d.parametres || []
  return { ...reste, parametres, blocs: [{ type: 'tableau', requete, liaisons: liaisons || parametres.map((p) => p.nom), colonnes, groupes }] }
}

// ---------------------------------------------------------------- vérification de la description

export function verifierDescription(description) {
  const erreurs = []
  if (!description || typeof description !== 'object') return ['La description du rapport est vide.']
  const d = normaliserDescription(description)
  if (!String(d.titre || '').trim()) erreurs.push('Il manque le titre.')
  if (!d.blocs.length) erreurs.push('Le rapport n’a aucun bloc.')
  for (const p of d.parametres) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.nom || '')) erreurs.push(`Nom de paramètre invalide : ${p.nom}`)
    if (p.type && !TYPES[p.type]) erreurs.push(`Type inconnu pour le paramètre ${p.nom} : ${p.type}`)
    if (p.liste && !lectureSeule(p.liste.requete)) erreurs.push(`La liste du paramètre ${p.nom} doit être une requête de lecture (SELECT).`)
  }
  d.blocs.forEach((b, i) => {
    const nom = `Bloc ${i + 1}${b.titre ? ` (${b.titre})` : ''}`
    if (!TYPES_BLOCS[b.type]) return erreurs.push(`${nom} : type inconnu « ${b.type} ».`)
    if (!BLOCS_DONNEES.includes(b.type)) return
    if (!String(b.requete || '').trim()) return erreurs.push(`${nom} : il manque la requête SQL.`)
    if (!lectureSeule(b.requete)) erreurs.push(`${nom} : seules les requêtes de lecture (SELECT) sont acceptées.`)
    const liaisons = b.liaisons || []
    const marques = compterMarques(b.requete)
    if (marques !== liaisons.length) erreurs.push(`${nom} : la requête contient ${marques} « ? » mais ${liaisons.length} paramètre(s) y sont liés.`)
    for (const l of liaisons) if (!d.parametres.some((p) => p.nom === l)) erreurs.push(`${nom} : paramètre lié inconnu : ${l}`)
    if (b.type === 'tableau') {
      if (!Array.isArray(b.colonnes) || !b.colonnes.length) erreurs.push(`${nom} : il faut au moins une colonne.`)
      for (const c of b.colonnes || []) {
        if (!c.champ) erreurs.push(`${nom} : une colonne n’a pas de champ.`)
        if (c.format && !TYPES[c.format]) erreurs.push(`${nom} : format inconnu pour ${c.champ} : ${c.format}`)
        if (c.total && !FONCTIONS[c.total]) erreurs.push(`${nom} : total inconnu pour ${c.champ} : ${c.total}`)
      }
    }
    if (b.type === 'graphique') {
      if (!b.categorie) erreurs.push(`${nom} : choisissez la colonne de l’axe (les catégories).`)
      if (!b.series?.length) erreurs.push(`${nom} : choisissez au moins une valeur à dessiner.`)
      if (b.forme && !FORMES[b.forme]) erreurs.push(`${nom} : forme inconnue : ${b.forme}`)
    }
    if (b.type === 'croise' && !(b.lignes && b.colonnes && b.valeur)) erreurs.push(`${nom} : choisissez les lignes, les colonnes et la valeur.`)
    if (b.type === 'chiffre' && !b.champ) erreurs.push(`${nom} : choisissez la valeur à afficher.`)
  })
  return erreurs
}

// Une requête de lecture : SELECT (ou WITH … SELECT), une seule instruction.
export function lectureSeule(sql) {
  const sansChaines = String(sql || '').replace(/'(?:[^'\\]|\\.|'')*'/g, "''").replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').trim().replace(/;+\s*$/, '')
  if (sansChaines.includes(';')) return false
  if (!/^\(*\s*(select|with)\b/i.test(sansChaines)) return false
  return !/\b(insert|update|delete|replace|drop|alter|create|truncate|grant|revoke|call|load_file|into\s+(out|dump)file)\b/i.test(sansChaines)
}

// Nombre de « ? » dans la requête, en dehors des chaînes entre apostrophes.
function compterMarques(sql) {
  return String(sql).replace(/'(?:[^'\\]|\\.|'')*'/g, '').split('?').length - 1
}

// ---------------------------------------------------------------- génération

// « image » : { nom, type, octets } d'une image à placer au centre, en haut du rapport (embarquée dans le fichier).
export function genererRptdesign(description, { url, utilisateur, charte: charteSite, image = null }) {
  const d = normaliserDescription(description)
  const charte = completerCharte(charteSite)
  const theme = THEMES[d.theme]
  if (theme) charte.couleurs = { ...charte.couleurs, ...theme.couleurs }
  const { couleurs, police, source } = charte
  const palette = PALETTES[d.theme] || null
  const logo = d.logo === false ? '' : charte.logo
  const description_ = String(d.description || '').trim()
  const descriptionEnPied = description_ && d.positionDescription === 'pied'
  const paysage = d.orientation === 'paysage'
  let id = 1
  const nouvelId = () => ++id
  const parametres = d.parametres.map((p) => ({ ...p, type: p.type || 'texte', libelle: p.libelle || p.nom }))

  // Un jeu de données par bloc de données (le premier garde le nom « Données », comme les anciens rapports).
  const blocs = d.blocs.map((b, i) => ({ ...b, numero: i + 1 }))
  let n = 0
  for (const b of blocs) if (BLOCS_DONNEES.includes(b.type)) b.jeu = n++ ? `Données ${n}` : 'Données'

  const idSource = nouvelId()
  const jeuXml = (nom, requete, liaisons = []) => `
        <oda-data-set extensionID="org.eclipse.birt.report.data.oda.jdbc.JdbcSelectDataSet" name="${x(nom)}" id="${nouvelId()}">${liaisons.length ? `
            <list-property name="parameters">${liaisons.map((l, i) => {
    const p = parametres.find((q) => q.nom === l)
    return `
                <structure>
                    <property name="name">param_${i + 1}</property>
                    <property name="paramName">${x(l)}</property>
                    <property name="dataType">${TYPES[p?.type || 'texte'].parametre}</property>
                    <property name="position">${i + 1}</property>
                    <property name="isOptional">false</property>
                    <property name="isInput">true</property>
                    <property name="isOutput">false</property>
                </structure>`
  }).join('')}
            </list-property>` : ''}
            <property name="dataSource">${x(source.nom)}</property>
            <xml-property name="queryText"><![CDATA[${String(requete).trim().replace(/;+\s*$/, '').replaceAll(']]>', ']]]]><![CDATA[>')}]]></xml-property>
        </oda-data-set>`
  const jeux = [
    ...blocs.filter((b) => b.jeu).map((b) => jeuXml(b.jeu, b.requete, b.liaisons || [])),
    // Les listes de choix des paramètres (« Ligne : choisir dans la liste »).
    ...parametres.filter((p) => p.liste?.requete).map((p) => jeuXml(`Liste ${p.nom}`, p.liste.requete)),
  ]

  const ctx = { x, js, nouvelId, couleurs, police, palette, paysage }
  const cubes = []
  const corps = blocs.map((b) => {
    const titre = b.titre ? `
        <label id="${nouvelId()}">
            <property name="style">birtec-titre-bloc</property>
            <text-property name="text">${x(b.titre)}</text-property>
        </label>` : ''
    switch (b.type) {
      case 'tableau':
        return titre + elementTableau(b, ctx)
      case 'graphique':
        return titre + elementGraphique(b, ctx)
      case 'croise': {
        const format = b.format || 'entier'
        const t = tableauCroise(
          { lignes: b.lignes, colonnes: b.colonnes, valeur: b.valeur, fonction: b.fonction || 'somme', libelleLignes: b.libelleLignes, format, totaux: b.totaux },
          { nom: `b${b.numero}`, jeu: b.jeu, nouvelId, x, motifNombre: TYPES[format]?.nombre || '#,##0' },
        )
        cubes.push(t.cube)
        return titre + t.element
      }
      case 'chiffre':
        return titre + elementChiffre(b, ctx)
      case 'texte':
        return titre + `
        <text id="${nouvelId()}">
            <property name="style">birtec-texte</property>
            <property name="contentType">html</property>
            <text-property name="content"><![CDATA[${x(b.texte || '').replace(/\n/g, '<br/>').replaceAll(']]>', ']]]]><![CDATA[>')}]]></text-property>
        </text>`
      case 'saut':
        return `
        <label id="${nouvelId()}">
            <property name="pageBreakAfter">always</property>
            <text-property name="text"> </text-property>
        </label>`
      default:
        return ''
    }
  }).join('')

  // Paramètres cachés passés par la GMAO (choix du profil de connexion, adresse du logo…).
  const parametresCaches = charte.parametresCaches.filter((c) => !parametres.some((p) => p.nom === c.nom)).map((c) => `
        <scalar-parameter name="${x(c.nom)}" id="${nouvelId()}">
            <property name="hidden">true</property>
            <property name="valueType">static</property>
            <property name="isRequired">false</property>
            <property name="dataType">${(TYPES[c.type] || TYPES.texte).parametre}</property>
            <property name="distinct">true</property>${c.defaut !== undefined && c.defaut !== '' ? `
            <simple-property-list name="defaultValue">
                <value type="constant">${x(c.defaut)}</value>
            </simple-property-list>` : ''}
            <list-property name="selectionList"/>
            <property name="paramType">simple</property>
            <property name="controlType">text-box</property>
            <structure name="format">
                <property name="category">Unformatted</property>
            </structure>
        </scalar-parameter>`).join('')

  const parametresXml = parametres.map((p) => `
        <scalar-parameter name="${x(p.nom)}" id="${nouvelId()}">
            <text-property name="promptText">${x(p.libelle)}</text-property>${p.liste?.requete ? `
            <property name="valueType">dynamic</property>
            <property name="dataSetName">Liste ${x(p.nom)}</property>
            <expression name="valueExpr" type="javascript">dataSetRow["valeur"]</expression>
            <expression name="labelExpr" type="javascript">dataSetRow["valeur"]</expression>
            <property name="mustMatch">false</property>
            <property name="fixedOrder">true</property>` : `
            <property name="valueType">static</property>`}
            <property name="isRequired">${p.optionnel ? 'false' : 'true'}</property>
            <property name="dataType">${TYPES[p.type].parametre}</property>
            <property name="distinct">true</property>${p.defaut !== undefined && p.defaut !== null && (p.defaut !== '' || p.optionnel) ? `
            <simple-property-list name="defaultValue">
                <value type="constant">${x(p.defaut)}</value>
            </simple-property-list>` : ''}
            <list-property name="selectionList"/>
            <property name="paramType">simple</property>
            <property name="controlType">${p.liste?.requete ? 'list-box' : 'text-box'}</property>
            <structure name="format">
                <property name="category">Unformatted</property>
            </structure>
        </scalar-parameter>`).join('')

  const style = (nom, proprietes) => `
        <style name="${nom}" id="${nouvelId()}">${Object.entries(proprietes).map(([cle, valeur]) => `
            <property name="${cle}">${x(valeur)}</property>`).join('')}
        </style>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<report xmlns="http://www.eclipse.org/birt/2005/design" version="${VERSION_FORMAT}" id="1">
    <property name="createdBy">BiRTEC</property>${source.profilChemin ? `
    <list-property name="propertyBindings">
        <structure>
            <property name="name">OdaConnProfileStorePath</property>
            <property name="id">${idSource}</property>
            <expression name="value" type="javascript">${x(source.profilChemin)}</expression>
        </structure>
    </list-property>` : ''}
    <text-property name="title">${x(d.titre)}</text-property>
    <property name="units">mm</property>
    <property name="layoutPreference">auto layout</property>${charte.feuilleStyle ? `
    <list-property name="cssStyleSheets">
        <structure>
            <property name="fileName">${x(charte.feuilleStyle)}</property>
        </structure>
    </list-property>` : ''}${image ? `
    <list-property name="images">
        <structure>
            <property name="name">${x(image.nom)}</property>
            <property name="type">${x(image.type)}</property>
            <property name="data">${Buffer.from(image.octets).toString('base64')}</property>
        </structure>
    </list-property>` : ''}${parametres.length || parametresCaches ? `
    <parameters>${parametresXml}${parametresCaches}
    </parameters>` : ''}
    <data-sources>
        <oda-data-source extensionID="org.eclipse.birt.report.data.oda.jdbc" name="${x(source.nom)}" id="${idSource}">
            <property name="odaDriverClass">${x(source.pilote)}</property>
            <property name="odaURL">${x(url)}${x(source.optionsUrl)}</property>
            <property name="odaUser">${x(utilisateur)}</property>${source.profilNom ? `
            <property name="OdaConnProfileName">${x(source.profilNom)}</property>
            <property name="OdaConnProfileStorePath">${x(source.profilFichier)}</property>` : ''}
        </oda-data-source>
    </data-sources>
    <data-sets>${jeux.join('')}
    </data-sets>${cubes.length ? `
    <cubes>${cubes.join('')}
    </cubes>` : ''}
    <styles>${style('birtec-titre', { fontFamily: police, fontSize: '16pt', fontWeight: 'bold', color: couleurs.titre, marginBottom: '4pt' })}${style('birtec-sous-titre', { fontFamily: police, fontSize: '10pt', color: '#555555', marginBottom: '10pt' })}${style('birtec-titre-bloc', { fontFamily: police, fontSize: '12pt', fontWeight: 'bold', color: couleurs.titre, marginTop: '14pt', marginBottom: '6pt' })}${style('birtec-texte', { fontFamily: police, fontSize: '10pt', marginTop: '6pt', marginBottom: '6pt' })}${style('birtec-chiffre', { fontFamily: police, fontSize: '26pt', fontWeight: 'bold', color: couleurs.titre, textAlign: 'center' })}${style('birtec-chiffre-libelle', { fontFamily: police, fontSize: '9pt', color: '#555555', textAlign: 'center' })}${style('birtec-entete', { fontFamily: police, fontSize: '9pt', fontWeight: 'bold', color: couleurs.texteEntete, backgroundColor: couleurs.entete, paddingTop: '4pt', paddingBottom: '4pt', paddingLeft: '3pt', paddingRight: '3pt' })}${style('birtec-groupe', { fontFamily: police, fontSize: '9pt', fontWeight: 'bold', backgroundColor: couleurs.groupe, paddingTop: '3pt', paddingBottom: '3pt' })}${style('birtec-sous-total', { fontFamily: police, fontSize: '9pt', fontWeight: 'bold' })}${style('birtec-total', { fontFamily: police, fontSize: '9pt', fontWeight: 'bold', borderTopColor: couleurs.titre, borderTopStyle: 'solid', borderTopWidth: 'medium' })}${style('table-detail-cell', { fontFamily: police, fontSize: '9pt', borderBottomColor: couleurs.ligne, borderBottomStyle: 'solid', borderBottomWidth: 'thin' })}${style('birtec-croise-ligne', { fontFamily: police, fontSize: '9pt', fontWeight: 'bold', backgroundColor: couleurs.groupe, paddingLeft: '4pt', paddingRight: '6pt' })}${style('birtec-croise-valeur', { fontFamily: police, fontSize: '9pt', paddingLeft: '4pt', paddingRight: '4pt' })}${style('birtec-croise-total', { fontFamily: police, fontSize: '9pt', fontWeight: 'bold', paddingLeft: '4pt', paddingRight: '4pt', backgroundColor: couleurs.groupe })}${style('crosstab-cell', { fontFamily: police, fontSize: '9pt', borderBottomColor: couleurs.ligne, borderBottomStyle: 'solid', borderBottomWidth: 'thin', paddingLeft: '3pt', paddingRight: '3pt' })}
    </styles>
    <page-setup>
        <simple-master-page name="Page" id="${nouvelId()}">
            <property name="type">a4</property>
            <property name="orientation">${paysage ? 'landscape' : 'portrait'}</property>${logo ? `
            <property name="headerHeight">0.6in</property>
            <page-header>
                <grid id="${nouvelId()}">
                    <property name="width">100%</property>
                    <property name="borderBottomColor">${couleurs.titre}</property>
                    <property name="borderBottomStyle">solid</property>
                    <property name="borderBottomWidth">medium</property>
                    <column id="${nouvelId()}">
                        <property name="width">30mm</property>
                    </column>
                    <column id="${nouvelId()}"/>
                    <row id="${nouvelId()}">
                        <cell id="${nouvelId()}">
                            <image id="${nouvelId()}">
                                <property name="source">url</property>
                                <expression name="uri" type="javascript">${x(logo)}</expression>
                            </image>
                        </cell>
                        <cell id="${nouvelId()}">
                            <property name="verticalAlign">middle</property>
                            <label id="${nouvelId()}">
                                <property name="fontFamily">${x(police)}</property>
                                <property name="fontSize">11pt</property>
                                <property name="fontWeight">bold</property>
                                <property name="color">${couleurs.titre}</property>
                                <property name="textAlign">right</property>
                                <text-property name="text">${x(d.titre)}</text-property>
                            </label>
                        </cell>
                    </row>
                </grid>
            </page-header>` : ''}
            <page-footer>
                <grid id="${nouvelId()}">
                    <property name="width">100%</property>
                    <column id="${nouvelId()}"/>
                    <column id="${nouvelId()}"/>${descriptionEnPied ? `
                    <row id="${nouvelId()}">
                        <cell id="${nouvelId()}">
                            <property name="colSpan">2</property>
                            <label id="${nouvelId()}">
                                <property name="fontSize">8pt</property>
                                <property name="color">#555555</property>
                                <text-property name="text">${x(description_)}</text-property>
                            </label>
                        </cell>
                    </row>` : ''}
                    <row id="${nouvelId()}">
                        <cell id="${nouvelId()}">
                            <text id="${nouvelId()}">
                                <property name="fontSize">8pt</property>
                                <property name="color">#777777</property>
                                <property name="contentType">html</property>
                                <text-property name="content"><![CDATA[${x(d.titre)} — <value-of format="dd/MM/yyyy HH:mm">new Date()</value-of>]]></text-property>
                            </text>
                        </cell>
                        <cell id="${nouvelId()}">
                            <property name="textAlign">right</property>
                            <auto-text id="${nouvelId()}">
                                <property name="fontSize">8pt</property>
                                <property name="type">page-number</property>
                            </auto-text>
                        </cell>
                    </row>
                </grid>
            </page-footer>
        </simple-master-page>
    </page-setup>
    <body>${image ? `
        <grid id="${nouvelId()}">
            <property name="width">100%</property>
            <column id="${nouvelId()}"/>
            <row id="${nouvelId()}">
                <cell id="${nouvelId()}">
                    <property name="textAlign">center</property>
                    <property name="paddingBottom">6pt</property>
                    <image id="${nouvelId()}">
                        <property name="source">embed</property>
                        <property name="imageName">${x(image.nom)}</property>
                    </image>
                </cell>
            </row>
        </grid>` : ''}
        <label id="${nouvelId()}">
            <property name="style">birtec-titre</property>
            <text-property name="text">${x(d.titre)}</text-property>
        </label>${d.sousTitre ? `
        <label id="${nouvelId()}">
            <property name="style">birtec-sous-titre</property>
            <text-property name="text">${x(d.sousTitre)}</text-property>
        </label>` : ''}${description_ && !descriptionEnPied ? `
        <label id="${nouvelId()}">
            <property name="style">birtec-sous-titre</property>
            <property name="fontStyle">italic</property>
            <text-property name="text">${x(description_)}</text-property>
        </label>` : ''}${corps}
    </body>
</report>
`
}

// ---------------------------------------------------------------- bloc « tableau »

function elementTableau(b, { x, js, nouvelId }) {
  const colonnes = b.colonnes.map((c) => ({ ...c, format: c.format || 'texte', libelle: c.libelle || c.champ }))
  const groupes = (b.groupes || []).map((g) => ({ ...g, libelle: g.libelle || g.champ }))
  const totaux = colonnes.filter((c) => c.total)
  const largeur = colonnes.length

  // Toutes les colonnes de données utilisées (affichées ou servant de groupe)
  const champs = new Map()
  for (const c of colonnes) champs.set(c.champ, TYPES[c.format].donnee)
  for (const g of groupes) if (!champs.has(g.champ)) champs.set(g.champ, 'string')

  const lignesDonnees = [...champs].map(
    ([champ, type]) => `
                <structure>
                    <property name="name">${x(champ)}</property>
                    <text-property name="displayName">${x(champ)}</text-property>
                    <expression name="expression" type="javascript">dataSetRow[${x(js(champ))}]</expression>
                    <property name="dataType">${type}</property>
                </structure>`,
  )
  // Totaux généraux (pied du tableau) et sous-totaux (pied de chaque groupe)
  const agregat = (nom, colonne, sur) => `
                <structure>
                    <property name="name">${x(nom)}</property>
                    <property name="dataType">${colonne.total === 'nombre' ? 'integer' : TYPES[colonne.format].donnee === 'integer' && colonne.total !== 'moyenne' ? 'integer' : 'decimal'}</property>
${sur ? `
                    <simple-property-list name="aggregateOn">
                        <value>${x(sur)}</value>
                    </simple-property-list>` : ''}
                    <property name="aggregateFunction">${FONCTIONS[colonne.total]}</property>
                    <list-property name="arguments">
                        <structure>
                            <property name="name">Expression</property>
                            <expression name="value" type="javascript">row[${x(js(colonne.champ))}]</expression>
                        </structure>
                    </list-property>
                    <property name="allowExport">true</property>
                </structure>`
  // Total général : sans « aggregateOn », BIRT calcule sur tout le tableau.
  for (const c of totaux) lignesDonnees.push(agregat(`total_${c.champ}`, c, null))
  for (const g of groupes) if (g.sousTotaux !== false) for (const c of totaux) lignesDonnees.push(agregat(`sstotal_${g.champ}_${c.champ}`, c, `groupe_${g.champ}`))

  // Mises en évidence : la cellule change de couleur selon sa valeur (ex. temps d'arrêt > 2 h en rouge).
  const regles = (colonne) => {
    const liste = (colonne.regles || []).filter((r) => OPERATEURS_REGLES[r.operateur])
    if (!liste.length) return ''
    return `
                            <list-property name="highlightRules">${liste.map((r) => {
      const valeur = r.operateur === 'vide' || r.operateur === 'non_vide' ? null
        : ['entier', 'decimal', 'pourcentage'].includes(colonne.format) && r.valeur !== '' && !isNaN(Number(r.valeur)) ? String(Number(r.valeur)) : js(String(r.valeur ?? ''))
      return `
                                <structure>
                                    <property name="operator">${OPERATEURS_REGLES[r.operateur]}</property>${Object.entries(COULEURS_REGLES[r.couleur] || COULEURS_REGLES.rouge).map(([cle, v]) => `
                                    <property name="${cle}">${v}</property>`).join('')}
                                    <expression name="testExpr" type="javascript">row[${x(js(colonne.champ))}]</expression>${valeur !== null ? `
                                    <simple-property-list name="value1">
                                        <value type="javascript">${x(valeur)}</value>
                                    </simple-property-list>` : ''}
                                </structure>`
    }).join('')}
                            </list-property>`
  }

  // Une cellule contenant une donnée mise en forme
  const celluleDonnee = (champ, colonne, style = null, avecRegles = false) => {
    const type = TYPES[colonne.format]
    const formatNombre = type.nombre ? `
                            <structure name="numberFormat">
                                <property name="category">${type.categorie || 'Custom'}</property>
                                <property name="pattern">${x(type.nombre)}</property>
                            </structure>` : ''
    const formatDate = type.date ? `
                            <structure name="dateTimeFormat">
                                <property name="category">Custom</property>
                                <property name="pattern">${x(type.date)}</property>
                            </structure>` : ''
    const aDroite = type.nombre ? `
                            <property name="textAlign">right</property>` : ''
    return `
                    <cell id="${nouvelId()}">
                        <data id="${nouvelId()}">${style ? `
                            <property name="style">${style}</property>` : ''}${aDroite}${formatNombre}${formatDate}${avecRegles ? regles(colonne) : ''}
                            <property name="resultSetColumn">${x(champ)}</property>
                        </data>
                    </cell>`
  }
  const celluleLibelle = (texte, style) => `
                    <cell id="${nouvelId()}">
                        <label id="${nouvelId()}">
                            <property name="style">${style}</property>
                            <text-property name="text">${x(texte)}</text-property>
                        </label>
                    </cell>`
  const celluleVide = () => `
                    <cell id="${nouvelId()}"/>`

  // Une cellule dont le texte est calculé (ex. « Sous-total » + valeur du groupe)
  const celluleCalculee = (expression, style) => `
                    <cell id="${nouvelId()}">
                        <text-data id="${nouvelId()}">
                            <property name="style">${style}</property>
                            <expression name="valueExpr">${x(expression)}</expression>
                            <property name="contentType">plain</property>
                        </text-data>
                    </cell>`

  // Ligne de totaux : libellé dans la première colonne, totaux sous leurs colonnes.
  // « libelle » : un texte, ou { expression } pour un libellé calculé.
  const ligneTotaux = (libelle, nomTotal, style) => {
    if (!totaux.length) return ''
    const cellules = colonnes.map((c, i) => {
      if (c.total) return celluleDonnee(nomTotal(c), c, style)
      if (i === 0) return libelle.expression ? celluleCalculee(libelle.expression, style) : celluleLibelle(libelle, style)
      return celluleVide()
    })
    return `
                <row id="${nouvelId()}">${cellules.join('')}
                </row>`
  }

  const groupesXml = groupes.map((g) => `
            <group id="${nouvelId()}">
                <property name="groupName">groupe_${x(g.champ)}</property>
                <property name="sortDirection">asc</property>
                <expression name="keyExpr" type="javascript">row[${x(js(g.champ))}]</expression>${g.sautDePage ? `
                <property name="pageBreakBefore">always-excluding-first</property>` : ''}
                <property name="repeatHeader">true</property>
                <property name="hideDetail">false</property>
                <header>
                    <row id="${nouvelId()}">
                        <cell id="${nouvelId()}">
                            <property name="colSpan">${largeur}</property>
                            <text-data id="${nouvelId()}">
                                <property name="style">birtec-groupe</property>
                                <expression name="valueExpr">${x(js(`${g.libelle} : `))} + row[${x(js(g.champ))}]</expression>
                                <property name="contentType">plain</property>
                            </text-data>
                        </cell>
                    </row>
                </header>${g.sousTotaux !== false && totaux.length ? `
                <footer>${ligneTotaux({ expression: `"Sous-total " + row[${js(g.champ)}]` }, (c) => `sstotal_${g.champ}_${c.champ}`, 'birtec-sous-total')}
                </footer>` : ''}
            </group>`).join('')

  return `
        <table id="${nouvelId()}">
            <property name="width">100%</property>
            <property name="dataSet">${x(b.jeu)}</property>
            <list-property name="boundDataColumns">${lignesDonnees.join('')}
            </list-property>${colonnes.map(() => `
            <column id="${nouvelId()}"/>`).join('')}
            <header>
                <row id="${nouvelId()}">${colonnes.map((c) => celluleLibelle(c.libelle, 'birtec-entete')).join('')}
                </row>
            </header>${groupesXml}
            <detail>
                <row id="${nouvelId()}">${colonnes.map((c) => celluleDonnee(c.champ, c, null, true)).join('')}
                </row>
            </detail>${totaux.length ? `
            <footer>${ligneTotaux('Total', (c) => `total_${c.champ}`, 'birtec-total')}
            </footer>` : ''}
        </table>`
}

// ---------------------------------------------------------------- bloc « graphique »

function elementGraphique(b, { x, nouvelId, couleurs, police, palette, paysage }) {
  const hauteur = b.hauteur || 85
  const largeur = paysage ? 260 : 175
  const g = { forme: b.forme || 'barres', categorie: b.categorie, series: b.series, serie: b.serie || null, empile: b.empile, valeurs: b.valeurs, hauteur, largeur, couleurs: palette }
  const colonnes = new Map([[b.categorie, 'string']])
  if (b.serie) colonnes.set(b.serie, 'string')
  for (const s of b.series) colonnes.set(s.champ, 'decimal')
  return `
        <extended-item extensionName="Chart" name="graphique_${b.numero}" id="${nouvelId()}">
            <xml-property name="xmlRepresentation"><![CDATA[${modeleGraphique(g, { police, couleurTitre: couleurs.titre }).replaceAll(']]>', ']]]]><![CDATA[>')}]]></xml-property>
            <property name="outputFormat">SVG</property>
            <property name="inheritColumns">false</property>
            <property name="dataSet">${x(b.jeu)}</property>
            <property name="height">${hauteur}mm</property>
            <property name="width">${largeur}mm</property>
            <list-property name="boundDataColumns">${[...colonnes].map(([champ, type]) => `
                <structure>
                    <property name="name">${x(champ)}</property>
                    <expression name="expression" type="javascript">dataSetRow[${x(JSON.stringify(champ))}]</expression>
                    <property name="dataType">${type}</property>
                </structure>`).join('')}
            </list-property>
        </extended-item>`
}

// ---------------------------------------------------------------- bloc « chiffre clé »

function elementChiffre(b, { x, js, nouvelId }) {
  const type = TYPES[b.format || 'entier'] || TYPES.entier
  return `
        <grid id="${nouvelId()}">
            <property name="width">100%</property>
            <property name="dataSet">${x(b.jeu)}</property>
            <list-property name="boundDataColumns">
                <structure>
                    <property name="name">valeur</property>
                    <expression name="expression" type="javascript">dataSetRow[${x(js(b.champ))}]</expression>
                    <property name="dataType">${type.donnee}</property>
                </structure>
            </list-property>
            <column id="${nouvelId()}"/>
            <row id="${nouvelId()}">
                <cell id="${nouvelId()}">
                    <data id="${nouvelId()}">
                        <property name="style">birtec-chiffre</property>${type.nombre ? `
                        <structure name="numberFormat">
                            <property name="category">${type.categorie || 'Custom'}</property>
                            <property name="pattern">${x(type.nombre)}</property>
                        </structure>` : ''}
                        <property name="resultSetColumn">valeur</property>
                    </data>
                </cell>
            </row>${b.libelle ? `
            <row id="${nouvelId()}">
                <cell id="${nouvelId()}">
                    <label id="${nouvelId()}">
                        <property name="style">birtec-chiffre-libelle</property>
                        <text-property name="text">${x(b.libelle)}</text-property>
                    </label>
                </cell>
            </row>` : ''}
        </grid>`
}

// ---------------------------------------------------------------- outils

// Texte placé dans le XML
function x(valeur) {
  return String(valeur ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

// Chaîne JavaScript (les expressions BIRT sont du JavaScript)
function js(texte) {
  return JSON.stringify(String(texte))
}
