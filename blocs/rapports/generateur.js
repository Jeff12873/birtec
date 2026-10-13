// Construit un fichier .rptdesign (BIRT 4.x) à partir d'une description simple, écrite par l'IA ou à la main.
//
// Description d'un rapport :
// {
//   "titre": "OT curatifs par équipement",
//   "sousTitre": "Période choisie en paramètre",                        (facultatif)
//   "orientation": "portrait" | "paysage",                              (facultatif)
//   "requete": "SELECT e.libelle, COUNT(*) AS nb_ot … WHERE o.date_debut >= ? AND o.date_debut < ?",
//   "parametres": [ { "nom": "debut", "libelle": "Du", "type": "date", "defaut": "2026-01-01" }, … ],
//   "liaisons": ["debut", "fin"],          (facultatif : paramètre de chaque « ? », dans l'ordre ; par défaut l'ordre de « parametres »)
//   "colonnes": [ { "champ": "libelle", "libelle": "Équipement", "format": "texte" },
//                 { "champ": "heures", "libelle": "Heures", "format": "decimal", "total": "somme" } ],
//   "groupes": [ { "champ": "famille", "libelle": "Famille", "sousTotaux": true } ]   (facultatif)
// }
// Formats : texte, entier, decimal, date, dateheure, pourcentage. Totaux : somme, moyenne, nombre, min, max.
//
// Le mot de passe MySQL n'est jamais écrit dans le rapport : BiRTEC le fournit au moment de l'aperçu,
// et la GMAO utilise sa propre connexion.
//
// Conventions des rapports de la GMAO :
//   - format de fichier 3.2.23, celui de BIRT Report Designer 4.8 : le rapport s'ouvre dans le BIRT du poste ;
//   - source de données « BDD » dont la connexion vient du profil bdd/config_<s>_<bdd>.xml du serveur BIRT,
//     choisi par les paramètres cachés « s » et « bdd » que la GMAO passe dans l'adresse du rapport.

const VERSION_FORMAT = '3.2.23' // format des fichiers de BIRT 4.8 (celui de la GMAO)
const PROFIL_CONNEXION = '"bdd/config_" + params["s"].value + "_" + params["bdd"].value + ".xml"'

const TYPES = {
  texte: { donnee: 'string', parametre: 'string' },
  entier: { donnee: 'integer', parametre: 'integer', nombre: '#,##0' },
  decimal: { donnee: 'decimal', parametre: 'decimal', nombre: '#,##0.00' },
  pourcentage: { donnee: 'decimal', parametre: 'decimal', nombre: '0.0 %', categorie: 'Percent' },
  date: { donnee: 'date', parametre: 'date', date: 'dd/MM/yyyy' },
  dateheure: { donnee: 'dateTime', parametre: 'dateTime', date: 'dd/MM/yyyy HH:mm' },
}

const FONCTIONS = { somme: 'SUM', moyenne: 'AVE', nombre: 'COUNT', min: 'MIN', max: 'MAX' }

// Couleurs de la mise en page générique (à remplacer par celles des rapports modèles).
const COULEUR_TITRE = '#14532D'
const COULEUR_ENTETE = '#1F5E3B'
const COULEUR_GROUPE = '#E8F5EC'

// ---------------------------------------------------------------- vérification de la description

export function verifierDescription(d) {
  const erreurs = []
  if (!d || typeof d !== 'object') return ['La description du rapport est vide.']
  if (!String(d.titre || '').trim()) erreurs.push('Il manque le titre.')
  if (!String(d.requete || '').trim()) erreurs.push('Il manque la requête SQL.')
  if (!Array.isArray(d.colonnes) || !d.colonnes.length) erreurs.push('Il faut au moins une colonne.')
  for (const c of d.colonnes || []) {
    if (!c.champ) erreurs.push('Une colonne n’a pas de champ.')
    if (c.format && !TYPES[c.format]) erreurs.push(`Format inconnu pour ${c.champ} : ${c.format}`)
    if (c.total && !FONCTIONS[c.total]) erreurs.push(`Total inconnu pour ${c.champ} : ${c.total}`)
  }
  for (const p of d.parametres || []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.nom || '')) erreurs.push(`Nom de paramètre invalide : ${p.nom}`)
    if (p.type && !TYPES[p.type]) erreurs.push(`Type inconnu pour le paramètre ${p.nom} : ${p.type}`)
  }
  const liaisons = d.liaisons || (d.parametres || []).map((p) => p.nom)
  const marques = compterMarques(d.requete || '')
  if (marques !== liaisons.length) erreurs.push(`La requête contient ${marques} « ? » mais ${liaisons.length} paramètre(s) y sont liés.`)
  for (const nom of liaisons) if (!(d.parametres || []).some((p) => p.nom === nom)) erreurs.push(`Paramètre lié inconnu : ${nom}`)
  return erreurs
}

// Nombre de « ? » dans la requête, en dehors des chaînes entre apostrophes.
function compterMarques(sql) {
  return sql.replace(/'(?:[^'\\]|\\.|'')*'/g, '').split('?').length - 1
}

// ---------------------------------------------------------------- génération

export function genererRptdesign(d, { url, utilisateur }) {
  let id = 1
  const nouvelId = () => ++id
  const colonnes = d.colonnes.map((c) => ({ ...c, format: c.format || 'texte', libelle: c.libelle || c.champ }))
  const groupes = (d.groupes || []).map((g) => ({ ...g, libelle: g.libelle || g.champ }))
  const parametres = (d.parametres || []).map((p) => ({ ...p, type: p.type || 'texte', libelle: p.libelle || p.nom }))
  const liaisons = d.liaisons || parametres.map((p) => p.nom)
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

  // Une cellule contenant une donnée mise en forme
  const celluleDonnee = (champ, colonne, style = null) => {
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
                            <property name="style">${style}</property>` : ''}${aDroite}${formatNombre}${formatDate}
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
                <expression name="keyExpr" type="javascript">row[${x(js(g.champ))}]</expression>
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

  // Paramètres cachés passés par la GMAO pour choisir le profil de connexion.
  const parametresCaches = ['s', 'bdd'].filter((nom) => !parametres.some((p) => p.nom === nom)).map((nom) => `
        <scalar-parameter name="${nom}" id="${nouvelId()}">
            <property name="hidden">true</property>
            <property name="valueType">static</property>
            <property name="isRequired">false</property>
            <property name="dataType">integer</property>
            <property name="distinct">true</property>
            <simple-property-list name="defaultValue">
                <value type="constant">1</value>
            </simple-property-list>
            <list-property name="selectionList"/>
            <property name="paramType">simple</property>
            <property name="controlType">text-box</property>
            <structure name="format">
                <property name="category">Unformatted</property>
            </structure>
        </scalar-parameter>`).join('')

  const parametresXml = parametres.map((p) => `
        <scalar-parameter name="${x(p.nom)}" id="${nouvelId()}">
            <text-property name="promptText">${x(p.libelle)}</text-property>
            <property name="valueType">static</property>
            <property name="isRequired">true</property>
            <property name="dataType">${TYPES[p.type].parametre}</property>
            <property name="distinct">true</property>${p.defaut !== undefined && p.defaut !== null && p.defaut !== '' ? `
            <simple-property-list name="defaultValue">
                <value type="constant">${x(p.defaut)}</value>
            </simple-property-list>` : ''}
            <list-property name="selectionList"/>
            <property name="paramType">simple</property>
            <property name="controlType">text-box</property>
            <structure name="format">
                <property name="category">Unformatted</property>
            </structure>
        </scalar-parameter>`).join('')

  const liaisonsXml = liaisons.map((nom, i) => {
    const p = parametres.find((q) => q.nom === nom)
    return `
                <structure>
                    <property name="name">param_${i + 1}</property>
                    <property name="paramName">${x(nom)}</property>
                    <property name="dataType">${TYPES[p.type].parametre}</property>
                    <property name="position">${i + 1}</property>
                    <property name="isOptional">false</property>
                    <property name="isInput">true</property>
                    <property name="isOutput">false</property>
                </structure>`
  }).join('')

  const idSource = nouvelId()
  return `<?xml version="1.0" encoding="UTF-8"?>
<report xmlns="http://www.eclipse.org/birt/2005/design" version="${VERSION_FORMAT}" id="1">
    <property name="createdBy">BiRTEC</property>
    <list-property name="propertyBindings">
        <structure>
            <property name="name">OdaConnProfileStorePath</property>
            <property name="id">${idSource}</property>
            <expression name="value" type="javascript">${x(PROFIL_CONNEXION)}</expression>
        </structure>
    </list-property>
    <text-property name="title">${x(d.titre)}</text-property>
    <property name="units">mm</property>
    <property name="layoutPreference">auto layout</property>
    <parameters>${parametresXml}${parametresCaches}
    </parameters>
    <data-sources>
        <oda-data-source extensionID="org.eclipse.birt.report.data.oda.jdbc" name="BDD" id="${idSource}">
            <property name="odaDriverClass">com.mysql.jdbc.Driver</property>
            <property name="odaURL">${x(url)}?useOldAliasMetadataBehavior=true</property>
            <property name="odaUser">${x(utilisateur)}</property>
            <property name="OdaConnProfileName">BDD</property>
            <property name="OdaConnProfileStorePath">bdd/config_1_1.xml</property>
        </oda-data-source>
    </data-sources>
    <data-sets>
        <oda-data-set extensionID="org.eclipse.birt.report.data.oda.jdbc.JdbcSelectDataSet" name="Données" id="${nouvelId()}">${liaisons.length ? `
            <list-property name="parameters">${liaisonsXml}
            </list-property>` : ''}
            <property name="dataSource">BDD</property>
            <xml-property name="queryText"><![CDATA[${String(d.requete).trim().replace(/;+\s*$/, '').replaceAll(']]>', ']]]]><![CDATA[>')}]]></xml-property>
        </oda-data-set>
    </data-sets>
    <styles>
        <style name="birtec-titre" id="${nouvelId()}">
            <property name="fontFamily">sans-serif</property>
            <property name="fontSize">16pt</property>
            <property name="fontWeight">bold</property>
            <property name="color">${COULEUR_TITRE}</property>
            <property name="marginBottom">4pt</property>
        </style>
        <style name="birtec-sous-titre" id="${nouvelId()}">
            <property name="fontFamily">sans-serif</property>
            <property name="fontSize">10pt</property>
            <property name="color">#555555</property>
            <property name="marginBottom">10pt</property>
        </style>
        <style name="birtec-entete" id="${nouvelId()}">
            <property name="fontFamily">sans-serif</property>
            <property name="fontSize">9pt</property>
            <property name="fontWeight">bold</property>
            <property name="color">#FFFFFF</property>
            <property name="backgroundColor">${COULEUR_ENTETE}</property>
            <property name="paddingTop">4pt</property>
            <property name="paddingBottom">4pt</property>
        </style>
        <style name="birtec-groupe" id="${nouvelId()}">
            <property name="fontFamily">sans-serif</property>
            <property name="fontSize">9pt</property>
            <property name="fontWeight">bold</property>
            <property name="backgroundColor">${COULEUR_GROUPE}</property>
            <property name="paddingTop">3pt</property>
            <property name="paddingBottom">3pt</property>
        </style>
        <style name="birtec-sous-total" id="${nouvelId()}">
            <property name="fontFamily">sans-serif</property>
            <property name="fontSize">9pt</property>
            <property name="fontWeight">bold</property>
        </style>
        <style name="birtec-total" id="${nouvelId()}">
            <property name="fontFamily">sans-serif</property>
            <property name="fontSize">9pt</property>
            <property name="fontWeight">bold</property>
            <property name="borderTopColor">${COULEUR_TITRE}</property>
            <property name="borderTopStyle">solid</property>
            <property name="borderTopWidth">medium</property>
        </style>
        <style name="table-detail-cell" id="${nouvelId()}">
            <property name="fontFamily">sans-serif</property>
            <property name="fontSize">9pt</property>
            <property name="borderBottomColor">#DDDDDD</property>
            <property name="borderBottomStyle">solid</property>
            <property name="borderBottomWidth">thin</property>
        </style>
    </styles>
    <page-setup>
        <simple-master-page name="Page" id="${nouvelId()}">
            <property name="type">a4</property>
            <property name="orientation">${d.orientation === 'paysage' ? 'landscape' : 'portrait'}</property>
            <page-footer>
                <grid id="${nouvelId()}">
                    <property name="width">100%</property>
                    <column id="${nouvelId()}"/>
                    <column id="${nouvelId()}"/>
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
    <body>
        <label id="${nouvelId()}">
            <property name="style">birtec-titre</property>
            <text-property name="text">${x(d.titre)}</text-property>
        </label>${d.sousTitre ? `
        <label id="${nouvelId()}">
            <property name="style">birtec-sous-titre</property>
            <text-property name="text">${x(d.sousTitre)}</text-property>
        </label>` : ''}
        <table id="${nouvelId()}">
            <property name="width">100%</property>
            <property name="dataSet">Données</property>
            <list-property name="boundDataColumns">${lignesDonnees.join('')}
            </list-property>${colonnes.map(() => `
            <column id="${nouvelId()}"/>`).join('')}
            <header>
                <row id="${nouvelId()}">${colonnes.map((c) => celluleLibelle(c.libelle, 'birtec-entete')).join('')}
                </row>
            </header>${groupesXml}
            <detail>
                <row id="${nouvelId()}">${colonnes.map((c) => celluleDonnee(c.champ, c)).join('')}
                </row>
            </detail>${totaux.length ? `
            <footer>${ligneTotaux('Total', (c) => `total_${c.champ}`, 'birtec-total')}
            </footer>` : ''}
        </table>
    </body>
</report>
`
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
