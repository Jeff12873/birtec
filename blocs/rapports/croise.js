// Tableau croisé BIRT : une valeur (nombre, heures…) au croisement d'une ligne et d'une colonne
// (ex. les lignes de production × les mois), avec les totaux de chaque ligne, de chaque colonne et le total général.
// BIRT le construit sur un « cube » tiré d'un jeu de données : une dimension pour les lignes, une pour les colonnes,
// une mesure. Les valeurs de la colonne (les mois…) viennent des données : de nouveaux mois apparaissent tout seuls.
//
// c = { lignes: 'ligne', colonnes: 'mois', valeur: 'nombre', fonction: 'somme'|'moyenne'|'min'|'max',
//       libelleLignes, libelleValeur, format: 'entier'|'decimal', totaux: true }

const FONCTIONS = { somme: 'sum', moyenne: 'average', min: 'min', max: 'max', nombre: 'count' }

// Le cube (dans <cubes>) et le tableau croisé (dans <body>). nouvelId() donne les identifiants du rapport.
export function tableauCroise(c, { nom, jeu, nouvelId, x, styleEntete = 'birtec-entete', styleLigne = 'birtec-croise-ligne', styleValeur = 'birtec-croise-valeur', styleTotal = 'birtec-croise-total', motifNombre = '#,##0' }) {
  const cube = `cube_${nom}`
  const dimL = `${nom}_lignes`
  const dimC = `${nom}_colonnes`
  const mesure = `${nom}_valeur`
  const nivL = `${dimL}/${c.lignes}`
  const nivC = `${dimC}/${c.colonnes}`
  const fonction = FONCTIONS[c.fonction] || 'sum'
  const typeValeur = c.format === 'entier' && fonction !== 'average' ? 'integer' : 'decimal'
  const totaux = c.totaux !== false

  const dimension = (dim, colonne) => `
                <tabular-dimension name="${x(dim)}" id="${nouvelId()}">
                    <property name="defaultHierarchy">${x(dim)}_h</property>
                    <property name="hierarchies">
                        <tabular-hierarchy name="${x(dim)}_h" id="${nouvelId()}">
                            <property name="levels">
                                <tabular-level name="${x(colonne)}" id="${nouvelId()}">
                                    <property name="dataType">string</property>
                                    <property name="columnName">${x(colonne)}</property>
                                </tabular-level>
                            </property>
                        </tabular-hierarchy>
                    </property>
                </tabular-dimension>`

  const xmlCube = `
        <tabular-cube name="${x(cube)}" id="${nouvelId()}">
            <property name="dimensions">${dimension(dimL, c.lignes)}${dimension(dimC, c.colonnes)}
            </property>
            <property name="measureGroups">
                <tabular-measure-group name="${x(nom)}_mesures" id="${nouvelId()}">
                    <property name="measures">
                        <tabular-measure name="${x(mesure)}" id="${nouvelId()}">
                            <property name="function">${fonction}</property>
                            <expression name="measureExpression" type="javascript">dataSetRow[${x(JSON.stringify(c.valeur))}]</expression>
                            <property name="dataType">${typeValeur}</property>
                        </tabular-measure>
                    </property>
                </tabular-measure-group>
            </property>
            <property name="dataSet">${x(jeu)}</property>
        </tabular-cube>`

  // Colonnes liées : les deux niveaux, la valeur à chaque croisement et ses totaux.
  const liee = (nomColonne, expression, type, sur = [], agregat = null) => `
                <structure>
                    <property name="name">${x(nomColonne)}</property>
                    <expression name="expression" type="javascript">${x(expression)}</expression>
                    <property name="dataType">${type}</property>${sur.length ? `
                    <simple-property-list name="aggregateOn">${sur.map((s) => `
                        <value>${x(s)}</value>`).join('')}
                    </simple-property-list>` : ''}${agregat ? `
                    <property name="aggregateFunction">${agregat}</property>` : ''}
                </structure>`
  const agregat = { sum: 'SUM', average: 'AVE', min: 'MIN', max: 'MAX', count: 'SUM' }[fonction]
  const lieesXml = [
    liee(c.lignes, `dimension[${JSON.stringify(dimL)}][${JSON.stringify(c.lignes)}]`, 'string'),
    liee(c.colonnes, `dimension[${JSON.stringify(dimC)}][${JSON.stringify(c.colonnes)}]`, 'string'),
    liee('v_croisement', `measure[${JSON.stringify(mesure)}]`, typeValeur, [nivL, nivC], agregat),
    ...(totaux ? [
      liee('v_total_ligne', `measure[${JSON.stringify(mesure)}]`, typeValeur, [nivL], agregat),
      liee('v_total_colonne', `measure[${JSON.stringify(mesure)}]`, typeValeur, [nivC], agregat),
      liee('v_total', `measure[${JSON.stringify(mesure)}]`, typeValeur, [], agregat),
    ] : []),
  ].join('')

  const nombre = (colonne, style = styleValeur) => `
                                <data id="${nouvelId()}">
                                    <property name="style">${style}</property>
                                    <structure name="numberFormat">
                                        <property name="category">Custom</property>
                                        <property name="pattern">${x(motifNombre)}</property>
                                    </structure>
                                    <property name="textAlign">right</property>
                                    <property name="resultSetColumn">${x(colonne)}</property>
                                </data>`
  const cellule = (contenu) => `
                    <extended-item extensionName="CrosstabCell" id="${nouvelId()}">
                        <property name="content">${contenu}
                        </property>
                    </extended-item>`
  const etiquette = (texte, style) => `
                                <label id="${nouvelId()}">
                                    <property name="style">${style}</property>
                                    <text-property name="text">${x(texte)}</text-property>
                                </label>`
  const donnee = (colonne, style) => `
                                <data id="${nouvelId()}">
                                    <property name="style">${style}</property>
                                    <property name="resultSetColumn">${x(colonne)}</property>
                                </data>`

  // Une vue (lignes ou colonnes) : le niveau, et la cellule « Total » au bout.
  const vue = (dim, niv, colonne, libelleTotal, style) => `
            <extended-item extensionName="CrosstabView" id="${nouvelId()}">${totaux ? `
                <property name="grandTotal">${cellule(etiquette(libelleTotal, style === styleEntete ? styleEntete : styleTotal))}
                </property>` : ''}
                <property name="views">
                    <extended-item extensionName="DimensionView" id="${nouvelId()}">
                        <property name="dimension">${x(dim)}</property>
                        <property name="levels">
                            <extended-item extensionName="LevelView" name="${x(colonne)}_vue" id="${nouvelId()}">
                                <property name="level">${x(niv)}</property>
                                <property name="member">${cellule(donnee(colonne, style))}
                                </property>
                            </extended-item>
                        </property>
                    </extended-item>
                </property>
            </extended-item>`

  const aggregations = totaux ? `
                <property name="aggregations">
                    <extended-item extensionName="AggregationCell" id="${nouvelId()}">
                        <property name="aggregationOnRow">${x(nivL)}</property>
                        <property name="content">${nombre('v_total_ligne', styleTotal)}
                        </property>
                    </extended-item>
                    <extended-item extensionName="AggregationCell" id="${nouvelId()}">
                        <property name="aggregationOnColumn">${x(nivC)}</property>
                        <property name="content">${nombre('v_total_colonne', styleTotal)}
                        </property>
                    </extended-item>
                    <extended-item extensionName="AggregationCell" id="${nouvelId()}">
                        <property name="content">${nombre('v_total', styleTotal)}
                        </property>
                    </extended-item>
                </property>` : ''

  const xmlCroise = `
        <extended-item extensionName="Crosstab" extensionVersion="3.7.0" id="${nouvelId()}">
            <property name="measures">
                <extended-item extensionName="MeasureView" id="${nouvelId()}">
                    <property name="measure">${x(mesure)}</property>
                    <property name="detail">
                        <extended-item extensionName="AggregationCell" id="${nouvelId()}">
                            <property name="aggregationOnRow">${x(nivL)}</property>
                            <property name="aggregationOnColumn">${x(nivC)}</property>
                            <property name="content">${nombre('v_croisement')}
                            </property>
                        </extended-item>
                    </property>${aggregations}
                </extended-item>
            </property>
            <property name="rows">${vue(dimL, nivL, c.lignes, 'Total', styleLigne)}
            </property>
            <property name="columns">${vue(dimC, nivC, c.colonnes, 'Total', styleEntete)}
            </property>
            <property name="header">${cellule(etiquette(c.libelleLignes || c.lignes, styleEntete))}
            </property>
            <property name="cube">${x(cube)}</property>
            <property name="width">100%</property>
            <list-property name="boundDataColumns">${lieesXml}
            </list-property>
        </extended-item>`

  return { cube: xmlCube, element: xmlCroise }
}
