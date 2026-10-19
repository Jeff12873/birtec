// Graphiques BIRT (élément « Chart ») : barres, barres couchées, courbe, aires, camembert.
// Le modèle du graphique est un XML à part (format EMF du moteur de graphiques BIRT), glissé dans le rapport.
// On l'écrit complet : le moteur ne complète pas les morceaux absents (étiquettes, échelles, cadres…).
//
// g = {
//   forme: 'barres' | 'barres_horizontales' | 'courbe' | 'aires' | 'camembert',
//   categorie: 'mois',                          (colonne de la requête : l'axe des X, ou les parts du camembert)
//   series: [{ champ: 'nombre', libelle: 'Nombre' }],   (une ou plusieurs valeurs)
//   serie: 'type' | null,                       (colonne qui sépare les valeurs en plusieurs séries : une couleur par type)
//   empile: false, valeurs: true,               (barres empilées ; valeurs écrites sur le graphique)
//   titre, hauteur (mm), couleurs: ['#1F5E3B', …]
// }

const PALETTE = ['#2563EB', '#16A34A', '#F59E0B', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#475569']

export const FORMES = { barres: 'Barres', barres_horizontales: 'Barres couchées', courbe: 'Courbe', aires: 'Aires', camembert: 'Camembert' }

export function modeleGraphique(g, { police = 'sans-serif', couleurTitre = '#1F2937' } = {}) {
  const couleurs = (g.couleurs?.length ? g.couleurs : PALETTE).map(rvb)
  const camembert = g.forme === 'camembert'
  const legende = camembert || Boolean(g.serie) || g.series.length > 1
  const entete = `<model:${camembert ? 'ChartWithoutAxes' : 'ChartWithAxes'} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:attribute="http://www.birt.eclipse.org/ChartModelAttribute" xmlns:data="http://www.birt.eclipse.org/ChartModelData" xmlns:layout="http://www.birt.eclipse.org/ChartModelLayout" xmlns:model="http://www.birt.eclipse.org/ChartModel" xmlns:type="http://www.birt.eclipse.org/ChartModelType">`
  const type = { barres: 'Bar Chart', barres_horizontales: 'Bar Chart', courbe: 'Line Chart', aires: 'Area Chart', camembert: 'Pie Chart' }[g.forme] || 'Bar Chart'
  const sousType = camembert ? 'Standard' : g.empile ? 'Stacked' : g.forme === 'barres' || g.forme === 'barres_horizontales' ? 'Side-by-side' : 'Overlay'

  const bloc = `
<Block>
<Children xsi:type="layout:TitleBlock">${cadre()}${contour(false)}
<Visible>${g.titre ? 'true' : 'false'}</Visible>
${libelle(g.titre || '', { taille: 11, gras: true, couleur: couleurTitre, police })}
</Children>
<Children xsi:type="layout:Plot">${cadre()}${contour(false)}
<Visible>true</Visible>
<HorizontalSpacing>5</HorizontalSpacing>
<VerticalSpacing>5</VerticalSpacing>
<ClientArea>${contour(false, 0)}
<Insets><Top>0.0</Top><Left>0.0</Left><Bottom>0.0</Bottom><Right>0.0</Right></Insets>
</ClientArea>
</Children>
<Children xsi:type="layout:Legend">${cadre()}${contour(false)}
<Visible>${legende}</Visible>
<ClientArea>${contour(false, 0)}
<Insets><Top>2.0</Top><Left>2.0</Left><Bottom>2.0</Bottom><Right>2.0</Right></Insets>
</ClientArea>
<Text>${texte('', { taille: 8, police })}</Text>
<Orientation>Vertical</Orientation>
<Direction>Top_Bottom</Direction>
<Separator><Style>Solid</Style><Thickness>1</Thickness>${couleur('#000000')}<Visible>true</Visible></Separator>
<Position>Right</Position>
<ItemType>${camembert ? 'Categories' : 'Series'}</ItemType>
<Title>${texte('', { police })}${fond()}${contour(false)}
<Insets><Top>0.0</Top><Left>2.0</Left><Bottom>0.0</Bottom><Right>3.0</Right></Insets>
<Visible>false</Visible>
</Title>
<TitlePosition>Above</TitlePosition>
</Children>
<Bounds><Left>0.0</Left><Top>0.0</Top><Width>${((g.largeur || 170) * 2.835).toFixed(1)}</Width><Height>${((g.hauteur || 80) * 2.835).toFixed(1)}</Height></Bounds>
<Insets><Top>3.0</Top><Left>3.0</Left><Bottom>3.0</Bottom><Right>3.0</Right></Insets>
<Row>-1</Row><Column>-1</Column><Rowspan>-1</Rowspan><Columnspan>-1</Columnspan>${contour(false)}
${fond('#FFFFFF')}
<Visible>true</Visible>
</Block>
<Dimension>Two_Dimensional</Dimension>
<Units>Points</Units>
<SeriesThickness>10.0</SeriesThickness>
<SampleData>
<BaseSampleData><DataSetRepresentation>A, B, C</DataSetRepresentation></BaseSampleData>
<OrthogonalSampleData><DataSetRepresentation>5,4,12</DataSetRepresentation><SeriesDefinitionIndex>0</SeriesDefinitionIndex></OrthogonalSampleData>
</SampleData>
<Interactivity/>
<EmptyMessage>${texte('Aucune donnée', { taille: 9, police })}${fond()}${contour(false)}
<Insets><Top>0.0</Top><Left>2.0</Left><Bottom>0.0</Bottom><Right>3.0</Right></Insets>
<Visible>true</Visible>
</EmptyMessage>`

  const palette = `
<SeriesPalette>${couleurs.map((c) => `
<Entries xsi:type="attribute:ColorDefinition">${composantes(c)}</Entries>`).join('')}
</SeriesPalette>`
  const groupement = (actif) => `
<Grouping><Enabled>${actif}</Enabled><GroupingInterval>0.0</GroupingInterval><GroupType>Text</GroupType><AggregateExpression>Sum</AggregateExpression></Grouping>`

  // Les valeurs : une série par colonne choisie (avec, si demandé, une série par valeur de la colonne « serie »).
  const seriesValeurs = g.series.map((s) => {
    const xsi = camembert ? 'type:PieSeries' : g.forme === 'courbe' ? 'type:LineSeries' : g.forme === 'aires' ? 'type:AreaSeries' : 'type:BarSeries'
    const propres = camembert
      ? `
<Explosion>0</Explosion>
<ExplosionExpression></ExplosionExpression>
<LeaderLineAttributes><Style>Solid</Style><Thickness>1</Thickness>${couleur('#888888')}<Visible>true</Visible></LeaderLineAttributes>
<LeaderLineStyle>Stretch_To_Side</LeaderLineStyle>
<LeaderLineLength>10.0</LeaderLineLength>
<SliceOutline>${composantes(rvb('#FFFFFF'))}</SliceOutline>
<Ratio>1.0</Ratio>
<Rotation>0.0</Rotation>
<Clockwise>true</Clockwise>`
      : g.forme === 'courbe' || g.forme === 'aires'
        ? `
<Marker><Type>Circle</Type><Size>3</Size><Visible>${g.forme === 'courbe'}</Visible></Marker>
<LineAttributes><Style>Solid</Style><Thickness>2</Thickness><Visible>true</Visible></LineAttributes>
<PaletteLineColor>true</PaletteLineColor>
<Curve>false</Curve>
<ShadowColor>${composantes(rvb('#C0C0C0'))}</ShadowColor>`
        : `
<Riser>Rectangle</Riser>`
    return `
<Series xsi:type="${xsi}">
<Visible>true</Visible>
${libelle('', { taille: 8, police, visible: g.valeurs !== false && !(g.empile && g.serie) })}
<DataDefinition>
<Definition>${x(`row[${JSON.stringify(s.champ)}]`)}</Definition>
<Grouping><Enabled>true</Enabled><GroupType>Text</GroupType><AggregateExpression>Sum</AggregateExpression></Grouping>
</DataDefinition>
<SeriesIdentifier>${x(g.serie ? '' : s.libelle || s.champ)}</SeriesIdentifier>
<DataPoint><Components><Type>Orthogonal_Value</Type></Components><Separator>, </Separator></DataPoint>
<LabelPosition>${camembert ? 'Outside' : g.forme === 'courbe' || g.forme === 'aires' ? 'Above' : g.empile ? 'Inside' : 'Outside'}</LabelPosition>
<Stacked>${Boolean(g.empile) && !camembert}</Stacked>${propres}
</Series>`
  }).join('')

  const definitionValeurs = `
<SeriesDefinitions>
<Query><Definition>${g.serie ? x(`row[${JSON.stringify(g.serie)}]`) : ''}</Definition></Query>${palette}${seriesValeurs}${groupement(Boolean(g.serie))}
<Sorting>Ascending</Sorting>
</SeriesDefinitions>`
  // Les catégories (axe des X, ou parts du camembert). Pour un camembert, elles contiennent la définition des valeurs.
  const definitionCategories = `
<SeriesDefinitions>
<Query><Definition></Definition></Query>${palette}${camembert ? definitionValeurs : ''}
<Series>
<Visible>true</Visible>
${libelle('', { visible: false, police })}
<DataDefinition><Definition>${x(`row[${JSON.stringify(g.categorie)}]`)}</Definition></DataDefinition>
<SeriesIdentifier></SeriesIdentifier>
<DataPoint><Components><Type>Orthogonal_Value</Type></Components><Separator>, </Separator></DataPoint>
<LabelPosition>Outside</LabelPosition>
<Stacked>false</Stacked>
</Series>${groupement(true)}
<Sorting>Ascending</Sorting>
</SeriesDefinitions>`

  if (camembert) {
    return `${entete}
<Version>2.6.1</Version>
<Type>${type}</Type>
<SubType>${sousType}</SubType>${bloc}${definitionCategories}
<MinSlice>0.0</MinSlice>
<MinSlicePercent>false</MinSlicePercent>
<MinSliceLabel></MinSliceLabel>
<LabelPosition>Outside</LabelPosition>
</model:ChartWithoutAxes>`
  }

  // Barres couchées : le modèle garde ses axes « debout », c'est l'orientation du graphique qui le couche.
  const couche = g.forme === 'barres_horizontales'
  const grille = (visible) => `
<MajorGrid>
<LineAttributes><Style>Solid</Style><Thickness>1</Thickness>${couleur('#DDDDDD')}<Visible>${visible}</Visible></LineAttributes>
<TickStyle>Across</TickStyle>
<TickAttributes><Style>Solid</Style><Thickness>1</Thickness>${couleur('#C4C4C4')}<Visible>true</Visible></TickAttributes>
</MajorGrid>
<MinorGrid>
<LineAttributes><Style>Solid</Style><Thickness>1</Thickness>${couleur('#E1E1E1')}<Visible>false</Visible></LineAttributes>
<TickStyle>Across</TickStyle>
<TickAttributes><Style>Solid</Style><Thickness>1</Thickness>${couleur('#E1E1E1')}<Visible>false</Visible></TickAttributes>
</MinorGrid>`
  const titreAxe = `
<Title>${texte('', { police })}${fond()}${contour(false)}
<Insets><Top>0.0</Top><Left>2.0</Left><Bottom>0.0</Bottom><Right>3.0</Right></Insets>
<Visible>false</Visible>
</Title>`
  const ligneAxe = `
<LineAttributes><Style>Solid</Style><Thickness>1</Thickness>${couleur('#888888')}<Visible>true</Visible></LineAttributes>`
  const origine = `
<Origin><Type>Min</Type><Value xsi:type="data:NumberDataElement"><Value>0.0</Value></Value></Origin>`
  return `${entete}
<Version>2.6.1</Version>
<Type>${type}</Type>
<SubType>${sousType}</SubType>${bloc}
<Axes>
<Type>Text</Type>${titreAxe}
<TitlePosition>Below</TitlePosition>
<AssociatedAxes>
<Type>Linear</Type>${titreAxe}
<TitlePosition>Left</TitlePosition>${definitionValeurs}
<Orientation>Vertical</Orientation>${ligneAxe}
${libelle('', { taille: 8, police })}
<LabelPosition>Left</LabelPosition>
<Staggered>false</Staggered>${grille(true)}
<Scale><Min xsi:type="data:NumberDataElement"><Value>0.0</Value></Min><MinorGridsPerUnit>5</MinorGridsPerUnit><AutoExpand>true</AutoExpand></Scale>${origine}
<PrimaryAxis>true</PrimaryAxis>
<Percent>false</Percent>
</AssociatedAxes>${definitionCategories}
<Orientation>Horizontal</Orientation>${ligneAxe}
${libelle('', { taille: 8, police })}
<LabelPosition>Below</LabelPosition>
<Staggered>false</Staggered>${grille(false)}
<Scale><MinorGridsPerUnit>5</MinorGridsPerUnit></Scale>${origine}
<PrimaryAxis>true</PrimaryAxis>
<CategoryAxis>true</CategoryAxis>
<Percent>false</Percent>
</Axes>
<Orientation>${couche ? 'Horizontal' : 'Vertical'}</Orientation>
<UnitSpacing>50.0</UnitSpacing>
<Rotation/>
<ReverseCategory>false</ReverseCategory>
</model:ChartWithAxes>`
}

// ---------------------------------------------------------------- morceaux du modèle

function libelle(valeur, { taille = 9, gras = false, couleur: c = null, police, visible = true } = {}) {
  return `<Label>${texte(valeur, { taille, gras, couleur: c, police })}${fond()}${contour(false)}
<Insets><Top>0.0</Top><Left>2.0</Left><Bottom>0.0</Bottom><Right>3.0</Right></Insets>
<Visible>${visible}</Visible>
</Label>`
}

function texte(valeur, { taille = 9, gras = false, couleur: c = null, police = 'sans-serif' } = {}) {
  return `
<Caption>
<Value>${x(valeur)}</Value>
<Font><Name>${x(nomPolice(police))}</Name><Size>${taille.toFixed(1)}</Size><Bold>${gras}</Bold><Alignment><horizontalAlignment>Center</horizontalAlignment><verticalAlignment>Center</verticalAlignment></Alignment></Font>${c ? `
<Color>${composantes(rvb(c))}</Color>` : ''}
</Caption>`
}

// Les noms génériques du CSS (« sans-serif ») ne sont pas compris par le moteur de graphiques.
function nomPolice(police) {
  const premiere = String(police || '').split(',')[0].replace(/["']/g, '').trim()
  return { 'sans-serif': 'Arial', serif: 'Times New Roman', monospace: 'Courier New', '': 'Arial' }[premiere.toLowerCase()] ?? premiere
}

function cadre() {
  return `
<Bounds><Left>0.0</Left><Top>0.0</Top><Width>0.0</Width><Height>0.0</Height></Bounds>
<Insets><Top>3.0</Top><Left>3.0</Left><Bottom>3.0</Bottom><Right>3.0</Right></Insets>
<Row>-1</Row><Column>-1</Column><Rowspan>-1</Rowspan><Columnspan>-1</Columnspan>`
}

function contour(visible, epaisseur = 1) {
  return `
<Outline><Style>Solid</Style><Thickness>${epaisseur}</Thickness>${couleur('#000000')}<Visible>${visible}</Visible></Outline>`
}

function fond(c = null) {
  const v = c ? rvb(c) : { r: 255, v: 255, b: 255, t: 0 }
  return `
<Background xsi:type="attribute:ColorDefinition">${composantes(v)}</Background>`
}

function couleur(c) {
  return `<Color>${composantes(rvb(c))}</Color>`
}

function composantes({ r, v, b, t = 255 }) {
  return `<Transparency>${t}</Transparency><Red>${r}</Red><Green>${v}</Green><Blue>${b}</Blue>`
}

function rvb(hex) {
  const h = String(hex).replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16) || 0, v: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0, t: 255 }
}

function x(valeur) {
  return String(valeur ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}
