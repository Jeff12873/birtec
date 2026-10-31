// Le classeur Excel joint à chaque extraction (analyse.xlsx) : prêt pour Power Query, en chemin RELATIF.
//
//   - feuille « Lisez-moi » : la cellule nommée « Dossier » calcule le dossier du classeur
//     (=GAUCHE(CELLULE("nomfichier";A1);TROUVE("[";CELLULE("nomfichier";A1))-1)) ;
//   - une requête Power Query par fichier CSV du dossier « sources », qui lit Dossier & "sources\table.csv" :
//     le classeur reste juste où qu'on dézippe le dossier (pas dans OneDrive ni SharePoint : CELLULE y renvoie
//     une adresse web).
//
// Les requêtes sont rangées comme Excel les range (le « DataMashup », format MS-QDEFF, dans customXml) et
// créées en « connexion uniquement » : on les charge en tableau ou dans le modèle de données à la demande.

import crypto from 'node:crypto'
import { creerZip } from 'ktec/zip.js'

const x = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const utf8 = (t) => Buffer.from(t, 'utf8')

// tables : [{ nom, lignes }] (les CSV du dossier sources) ; titre : une ligne pour la feuille.
export function classeurPowerQuery(tables, { titre = 'Extraction BiRTEC' } = {}) {
  const requetes = tables.map((t) => t.nom)
  const fichiers = [
    { nom: '[Content_Types].xml', octets: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/><Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>`) },
    { nom: '_rels/.rels', octets: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { nom: 'xl/workbook.xml', octets: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Lisez-moi" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="Dossier">'Lisez-moi'!$B$3</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`) },
    { nom: 'xl/_rels/workbook.xml.rels', octets: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections" Target="connections.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>`) },
    { nom: 'xl/styles.xml', octets: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`) },
    { nom: 'xl/worksheets/sheet1.xml', octets: utf8(feuille(titre, tables)) },
    { nom: 'xl/connections.xml', octets: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${requetes.map((nom, i) => `<connection id="${i + 1}" keepAlive="1" name="Requête - ${x(nom)}" description="Connexion à la requête « ${x(nom)} » dans le classeur." type="5" refreshedVersion="8" background="1"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=${x(nom)};Extended Properties=&quot;&quot;" command="SELECT * FROM [${x(nom)}]"/></connection>`).join('')}</connections>`) },
    { nom: 'customXml/item1.xml', octets: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`<?xml version="1.0" encoding="utf-16"?><DataMashup xmlns="http://schemas.microsoft.com/DataMashup">${dataMashup(requetes).toString('base64')}</DataMashup>`, 'utf16le')]) },
    { nom: 'customXml/itemProps1.xml', octets: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<ds:datastoreItem ds:itemID="{${crypto.randomUUID().toUpperCase()}}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs/></ds:datastoreItem>`) },
    { nom: 'customXml/_rels/item1.xml.rels', octets: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>`) },
  ]
  return creerZip(fichiers)
}

// La feuille « Lisez-moi » : le titre, la cellule Dossier (B3), le mode d'emploi et la liste des fichiers.
function feuille(titre, tables) {
  const texte = (ref, valeur, style = 0) => `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${x(valeur)}</t></is></c>`
  const lignes = [
    `<row r="1">${texte('A1', titre, 1)}</row>`,
    `<row r="3">${texte('A3', 'Dossier du classeur :')}<c r="B3" t="str"><f>LEFT(CELL("filename",A1),FIND("[",CELL("filename",A1))-1)</f></c></row>`,
    `<row r="5">${texte('A5', 'Les requêtes Power Query (Données › Requêtes et connexions) lisent les fichiers du dossier « sources » à côté de ce classeur, en chemin relatif.')}</row>`,
    `<row r="6">${texte('A6', 'Ouvrir le classeur depuis le dossier dézippé (pas depuis le zip), sur un disque local. Clic droit sur une requête › Charger dans… pour l’afficher.')}</row>`,
    `<row r="7">${texte('A7', 'Si Excel parle de « Formula.Firewall » : Données › Obtenir des données › Options de requête › Confidentialité (classeur actif) › Ignorer les niveaux de confidentialité.')}</row>`,
    `<row r="9">${texte('A9', 'Fichier', 1)}${texte('B9', 'Lignes', 1)}</row>`,
    ...tables.map((t, i) => `<row r="${10 + i}">${texte(`A${10 + i}`, `sources\\${t.nom}.csv`)}<c r="B${10 + i}"><v>${Number(t.lignes) || 0}</v></c></row>`),
  ]
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="48" customWidth="1"/><col min="2" max="2" width="60" customWidth="1"/></cols><sheetData>${lignes.join('')}</sheetData></worksheet>`
}

// Le DataMashup : version, paquet des formules (zip OPC), permissions, métadonnées, liaisons (vides : Excel
// les recalcule à l'enregistrement).
function dataMashup(requetes) {
  const ident = (nom) => `#"${String(nom).replace(/"/g, '""')}"`
  const section = [
    'section Section1;',
    '',
    'shared Dossier = let',
    '    Source = Excel.CurrentWorkbook(){[Name="Dossier"]}[Content]{0}[Column1]',
    'in',
    '    Source;',
    ...requetes.map((nom) => `
shared ${ident(nom)} = let
    Source = Csv.Document(File.Contents(Dossier & "sources\\${nom}.csv"), [Delimiter = ";", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Entetes = Table.PromoteHeaders(Source, [PromoteAllScalars = true])
in
    Entetes;`),
  ].join('\n')
  const paquet = creerZip([
    { nom: '[Content_Types].xml', octets: Buffer.concat([BOM, utf8('<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="text/xml" /><Default Extension="m" ContentType="application/x-ms-m" /></Types>')]) },
    { nom: 'Config/Package.xml', octets: Buffer.concat([BOM, utf8('<?xml version="1.0" encoding="utf-8"?><Package xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Version>1.0.0</Version><MinVersion>1.0.0</MinVersion><Culture>fr-FR</Culture></Package>')]) },
    { nom: 'Formulas/Section1.m', octets: Buffer.concat([BOM, utf8(section)]) },
  ])
  const permissions = Buffer.concat([BOM, utf8('<?xml version="1.0" encoding="utf-8"?><PermissionList xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><CanEvaluateFuturePackages>false</CanEvaluateFuturePackages><FirewallEnabled>true</FirewallEnabled><WorkbookGroupType xsi:nil="true" /></PermissionList>')])
  const date = new Date().toISOString().replace('Z', '0000Z')
  const entree = (type, valeur) => `<Entry Type="${type}" Value="${valeur}" />`
  const item = (nom, chargee) => `<Item><ItemLocation><ItemType>Formula</ItemType><ItemPath>Section1/${x(nom)}</ItemPath></ItemLocation><StableEntries>${[
    entree('IsPrivate', 'l0'), entree('FillEnabled', 'l0'), entree('FillObjectType', 'sConnectionOnly'), entree('FillToDataModelEnabled', 'l0'),
    entree('ResultType', chargee ? 'sTable' : 'sText'), entree('BufferNextRefresh', 'l1'), entree('FillLastUpdated', `d${date}`), entree('NameUpdatedAfterFill', 'l0'), entree('FillStatus', 'sComplete'),
  ].join('')}</StableEntries></Item>`
  const meta = Buffer.concat([BOM, utf8(`<?xml version="1.0" encoding="utf-8"?><LocalPackageMetadataFile xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><Items><Item><ItemLocation><ItemType>AllFormulas</ItemType><ItemPath /></ItemLocation><StableEntries /></Item>${item('Dossier', false)}${requetes.map((n) => item(n, true)).join('')}</Items></LocalPackageMetadataFile>`)])
  const metadonnees = Buffer.concat([u32(0), u32(meta.length), meta, u32(0)])
  return Buffer.concat([u32(0), u32(paquet.length), paquet, u32(permissions.length), permissions, u32(metadonnees.length), metadonnees, u32(0)])
}
