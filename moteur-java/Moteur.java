// Le moteur Java de BiRTEC : tout ce qui demande Java (connexion MySQL, moteur BIRT).
//
// BiRTEC (Node) le lance pour chaque opération, avec une commande et des options ; le mot de passe MySQL
// arrive sur l'entrée standard (jamais en option : il apparaîtrait dans la liste des programmes du poste).
// La réponse est écrite en JSON sur la sortie standard.
//
//   java -cp "classes:lib/*" Moteur tester  --url jdbc:mysql://serveur:3306/base --utilisateur u
//   java -cp "classes:lib/*" Moteur schema  --url … --utilisateur u
//   java -cp "classes:lib/*" Moteur requete --url … --utilisateur u --limite 200     (SQL après le mot de passe)
//   java -cp "classes:lib/*" Moteur rendu   --url … --utilisateur u --rapport r.rptdesign --format pdf --sortie r.pdf
//                                            [--ressources dossier] [--param nom=valeur]…
//
// « rendu » fait tourner le rapport dans le moteur BIRT : les sources de données JDBC du rapport sont
// redirigées vers la connexion MySQL de BiRTEC (le mot de passe n'est jamais écrit dans le rapport).
// Formats : html, pdf, docx, xlsx, xls, odt, ods, pptx.
//
// Entrée standard : 1re ligne = mot de passe, lignes suivantes = la requête SQL (commande « requete »).
//
// Sécurité : la connexion est ouverte en lecture seule, seules les requêtes de lecture sont acceptées
// (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN), une seule à la fois, avec un nombre de lignes et une durée limités.
// Le compte MySQL utilisé devrait de toute façon n'avoir que le droit de lecture.

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

public class Moteur {

    static final int DUREE_MAX_SECONDES = 30;

    public static void main(String[] args) throws Exception {
        Map<String, String> options = lireOptions(args);
        String commande = args.length > 0 ? args[0] : "";
        BufferedReader entree = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String motDePasse = entree.readLine();
        StringBuilder reste = new StringBuilder();
        for (String ligne; (ligne = entree.readLine()) != null; ) reste.append(ligne).append('\n');

        try {
            switch (commande) {
                case "tester" -> tester(options, motDePasse);
                case "schema" -> schema(options, motDePasse);
                case "requete" -> requete(options, motDePasse, reste.toString());
                case "rendu" -> rendu(options, motDePasse);
                case "verifier" -> verifier(options);
                default -> erreur("Commande inconnue : " + commande);
            }
        } catch (SQLException e) {
            erreur(messageSql(e));
        } catch (Exception e) {
            erreur(e.getClass().getSimpleName() + " : " + e.getMessage());
        }
    }

    // ---------------------------------------------------------------- connexion

    static Connection connecter(Map<String, String> options, String motDePasse) throws SQLException {
        Properties proprietes = new Properties();
        proprietes.setProperty("user", options.getOrDefault("utilisateur", ""));
        proprietes.setProperty("password", motDePasse == null ? "" : motDePasse);
        proprietes.setProperty("connectTimeout", "10000");
        proprietes.setProperty("allowMultiQueries", "false"); // une seule requête à la fois
        proprietes.setProperty("allowPublicKeyRetrieval", "true"); // comptes MySQL 8 (caching_sha2_password) sans SSL
        proprietes.setProperty("characterEncoding", "UTF-8");
        Connection connexion = DriverManager.getConnection(options.get("url"), proprietes);
        connexion.setReadOnly(true);
        return connexion;
    }

    static void tester(Map<String, String> options, String motDePasse) throws SQLException {
        try (Connection c = connecter(options, motDePasse)) {
            DatabaseMetaData infos = c.getMetaData();
            Json r = new Json().ouvrir()
                .champ("ok", true)
                .champ("serveur", infos.getDatabaseProductName() + " " + infos.getDatabaseProductVersion())
                .champ("base", c.getCatalog());
            // Le compte peut-il écrire dans cette base ? On le signale (BiRTEC n'écrit jamais, mais un compte en
            // lecture seule est plus sûr). Seuls comptent les droits sur toutes les bases (*.*) ou sur celle-ci.
            boolean ecriture = false;
            String base = c.getCatalog();
            try (Statement s = c.createStatement(); ResultSet droits = s.executeQuery("SHOW GRANTS")) {
                while (droits.next()) {
                    String droit = droits.getString(1).toUpperCase().replace("`", "");
                    int sur = droit.indexOf(" ON ");
                    if (sur < 0) continue;
                    String privileges = droit.substring(0, sur);
                    String cible = droit.substring(sur + 4).split(" ")[0];
                    boolean concerne = cible.equals("*.*") || cible.equals(base.toUpperCase() + ".*") || cible.startsWith(base.toUpperCase() + ".");
                    if (concerne && (privileges.contains("ALL PRIVILEGES") || privileges.contains("INSERT") || privileges.contains("UPDATE") || privileges.contains("DELETE"))) ecriture = true;
                }
            } catch (SQLException e) {
                // droits illisibles : on ne dit rien
            }
            System.out.println(r.champ("compteEnEcriture", ecriture).fermer());
        }
    }

    // ---------------------------------------------------------------- structure de la base

    static void schema(Map<String, String> options, String motDePasse) throws SQLException {
        try (Connection c = connecter(options, motDePasse)) {
            DatabaseMetaData infos = c.getMetaData();
            String base = c.getCatalog();
            Map<String, List<String[]>> liensParTable = lireLiens(c, base);
            Json r = new Json().ouvrir().champ("base", base).nom("tables").debutListe();
            try (ResultSet tables = infos.getTables(base, null, "%", new String[] { "TABLE", "VIEW" })) {
                boolean premiere = true;
                while (tables.next()) {
                    String table = tables.getString("TABLE_NAME");
                    if (!premiere) r.virgule();
                    premiere = false;
                    r.ouvrir().champ("nom", table).champ("type", tables.getString("TABLE_TYPE")).champ("commentaire", tables.getString("REMARKS"));

                    List<String> clePrimaire = new ArrayList<>();
                    try (ResultSet cles = infos.getPrimaryKeys(base, null, table)) {
                        while (cles.next()) clePrimaire.add(cles.getString("COLUMN_NAME"));
                    }
                    r.nom("colonnes").debutListe();
                    try (ResultSet colonnes = infos.getColumns(base, null, table, "%")) {
                        boolean premiereColonne = true;
                        while (colonnes.next()) {
                            if (!premiereColonne) r.virgule();
                            premiereColonne = false;
                            String nom = colonnes.getString("COLUMN_NAME");
                            r.ouvrir().champ("nom", nom).champ("type", colonnes.getString("TYPE_NAME"))
                                .champ("taille", colonnes.getInt("COLUMN_SIZE"))
                                .champ("vide", "YES".equals(colonnes.getString("IS_NULLABLE")))
                                .champ("cle", clePrimaire.contains(nom))
                                .champ("commentaire", colonnes.getString("REMARKS")).fermerSansVirgule();
                        }
                    }
                    r.finListe().virgule().nom("liens").debutListe();
                    boolean premierLien = true;
                    for (String[] lien : liensParTable.getOrDefault(table, List.of())) {
                        if (!premierLien) r.virgule();
                        premierLien = false;
                        r.ouvrir().champ("colonne", lien[0]).champ("versTable", lien[1]).champ("versColonne", lien[2]).fermerSansVirgule();
                    }
                    r.finListe().fermerSansVirgule();
                }
            }
            System.out.println(r.finListe().fermer());
        }
    }

    // Clés étrangères de la base, lues dans information_schema (fonctionne avec MySQL comme avec MariaDB,
    // contrairement à getImportedKeys du pilote). Renvoie : table → [colonne, table visée, colonne visée].
    static Map<String, List<String[]>> lireLiens(Connection c, String base) throws SQLException {
        Map<String, List<String[]>> liens = new HashMap<>();
        String sql = "SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE "
            + "WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL";
        try (var requete = c.prepareStatement(sql)) {
            requete.setString(1, base);
            try (ResultSet r = requete.executeQuery()) {
                while (r.next()) liens.computeIfAbsent(r.getString(1), t -> new ArrayList<>()).add(new String[] { r.getString(2), r.getString(3), r.getString(4) });
            }
        }
        return liens;
    }

    // ---------------------------------------------------------------- requêtes (lecture seule)

    static void requete(Map<String, String> options, String motDePasse, String sql) throws SQLException {
        sql = sql.trim();
        while (sql.endsWith(";")) sql = sql.substring(0, sql.length() - 1).trim();
        String debut = sql.replaceAll("^(\\s|/\\*.*?\\*/|--[^\\n]*\\n)+", "").toUpperCase();
        if (!(debut.startsWith("SELECT") || debut.startsWith("WITH") || debut.startsWith("SHOW") || debut.startsWith("DESC") || debut.startsWith("EXPLAIN"))) {
            erreur("Seules les requêtes de lecture sont acceptées (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN).");
            return;
        }
        if (sql.contains(";")) {
            erreur("Une seule requête à la fois.");
            return;
        }
        int limite = Integer.parseInt(options.getOrDefault("limite", "200"));
        long depart = System.currentTimeMillis();
        try (Connection c = connecter(options, motDePasse); Statement s = c.createStatement()) {
            s.setMaxRows(limite + 1); // une ligne de plus pour savoir s'il y en a d'autres
            s.setQueryTimeout(DUREE_MAX_SECONDES);
            try (ResultSet resultat = s.executeQuery(sql)) {
                ResultSetMetaData meta = resultat.getMetaData();
                int nombre = meta.getColumnCount();
                Json r = new Json().ouvrir().nom("colonnes").debutListe();
                for (int i = 1; i <= nombre; i++) {
                    if (i > 1) r.virgule();
                    r.ouvrir().champ("nom", meta.getColumnLabel(i)).champ("type", meta.getColumnTypeName(i)).fermerSansVirgule();
                }
                r.finListe().virgule().nom("lignes").debutListe();
                int lignes = 0;
                boolean tronque = false;
                while (resultat.next()) {
                    if (lignes == limite) {
                        tronque = true;
                        break;
                    }
                    if (lignes > 0) r.virgule();
                    r.debutListe();
                    for (int i = 1; i <= nombre; i++) {
                        if (i > 1) r.virgule();
                        r.valeur(resultat.getString(i));
                    }
                    r.finListe();
                    lignes++;
                }
                r.finListe().virgule();
                System.out.println(r.champ("tronque", tronque).champ("dureeMs", System.currentTimeMillis() - depart).fermer());
            }
        }
    }

    // ---------------------------------------------------------------- rendu d'un rapport par le moteur BIRT

    static void rendu(Map<String, String> options, String motDePasse) throws Exception {
        org.eclipse.birt.report.engine.api.EngineConfig configuration = new org.eclipse.birt.report.engine.api.EngineConfig();
        if (options.containsKey("ressources")) configuration.setResourcePath(options.get("ressources"));
        configuration.setLogConfig(null, java.util.logging.Level.OFF);
        org.eclipse.birt.core.framework.Platform.startup(configuration);
        var fabrique = (org.eclipse.birt.report.engine.api.IReportEngineFactory) org.eclipse.birt.core.framework.Platform
            .createFactoryObject(org.eclipse.birt.report.engine.api.IReportEngineFactory.EXTENSION_REPORT_ENGINE_FACTORY);
        var moteur = fabrique.createReportEngine(configuration);
        try {
            // Les erreurs de conception (feuille de style absente, style inconnu…) sont signalées
            // mais n'empêchent pas le rendu : BIRT Viewer les ignore aussi.
            List<String> problemes = erreursDeConception(options.get("rapport"), options.get("ressources"));
            var rapport = moteur.openReportDesign(options.get("rapport"));
            var conception = (org.eclipse.birt.report.model.api.ReportDesignHandle) rapport.getDesignHandle();

            // Les sources JDBC du rapport sont redirigées vers la connexion de BiRTEC.
            // Les rapports de la GMAO lisent leur connexion dans un profil (bdd/config_<s>_<bdd>.xml, choisi par
            // une « liaison de propriété ») : on retire ces liaisons et le profil, sinon ils l'emporteraient.
            conception.getPropertyHandle("propertyBindings").clearValue();
            for (Object element : conception.getAllDataSources()) {
                if (element instanceof org.eclipse.birt.report.model.api.OdaDataSourceHandle source && source.getExtensionID().contains("jdbc")) {
                    source.setProperty("odaDriverClass", "com.mysql.cj.jdbc.Driver");
                    source.setProperty("odaURL", options.get("url") + "?allowPublicKeyRetrieval=true&connectTimeout=10000");
                    source.setProperty("odaUser", options.getOrDefault("utilisateur", ""));
                    source.setProperty("odaPassword", motDePasse == null ? "" : motDePasse);
                    source.setProperty("OdaConnProfileName", null);
                    source.setProperty("OdaConnProfileStorePath", null);
                }
            }

            var tache = moteur.createRunAndRenderTask(rapport);
            tache.getAppContext().put(org.eclipse.birt.report.engine.api.EngineConstants.APPCONTEXT_CLASSLOADER_KEY, Moteur.class.getClassLoader());
            tache.setLocale(java.util.Locale.FRANCE);
            for (var parametre : options.entrySet()) {
                if (!parametre.getKey().startsWith("param:")) continue;
                String nom = parametre.getKey().substring(6);
                var definition = (org.eclipse.birt.report.model.api.ScalarParameterHandle) conception.findParameter(nom);
                if (definition != null) tache.setParameterValue(nom, convertir(parametre.getValue(), definition.getDataType()));
            }

            String format = options.getOrDefault("format", "html");
            org.eclipse.birt.report.engine.api.RenderOption rendu;
            if (format.equals("html")) {
                var html = new org.eclipse.birt.report.engine.api.HTMLRenderOption();
                html.setEmbeddable(false);
                html.setImageDirectory(new java.io.File(options.get("sortie")).getParent());
                rendu = html;
            } else if (format.equals("pdf")) {
                rendu = new org.eclipse.birt.report.engine.api.PDFRenderOption();
            } else {
                rendu = new org.eclipse.birt.report.engine.api.RenderOption();
            }
            rendu.setOutputFormat(format);
            rendu.setOutputFileName(options.get("sortie"));
            tache.setRenderOption(rendu);
            tache.run();

            Json r = new Json().ouvrir().champ("ok", true).nom("erreurs").debutListe();
            boolean premiere = true;
            for (String probleme : problemes.subList(0, Math.min(5, problemes.size()))) {
                if (!premiere) r.virgule();
                premiere = false;
                r.valeur("Avertissement, " + probleme);
            }
            for (Object erreur : tache.getErrors()) {
                if (!premiere) r.virgule();
                premiere = false;
                Throwable t = (Throwable) erreur;
                while (t.getCause() != null && t.getCause() != t) t = t.getCause(); // la cause première est la plus parlante
                r.valeur(((Throwable) erreur).getMessage() + (t != erreur ? " — " + t.getMessage() : ""));
            }
            tache.close();
            System.out.println(r.finListe().fermer());
        } finally {
            moteur.destroy();
            org.eclipse.birt.core.framework.Platform.shutdown();
        }
    }

    // Vérifie un fichier .rptdesign sans le faire tourner : liste des erreurs de conception (avec leur ligne).
    static void verifier(Map<String, String> options) throws Exception {
        List<String> problemes = erreursDeConception(options.get("rapport"), options.get("ressources"));
        Json r = new Json().ouvrir().champ("ok", problemes.isEmpty()).nom("erreurs").debutListe();
        for (int i = 0; i < problemes.size(); i++) {
            if (i > 0) r.virgule();
            r.valeur(problemes.get(i));
        }
        System.out.println(r.finListe().fermer());
    }

    static List<String> erreursDeConception(String fichier, String ressources) throws Exception {
        List<String> problemes = new ArrayList<>();
        var session = new org.eclipse.birt.report.model.api.DesignEngine(new org.eclipse.birt.report.model.api.DesignConfig())
            .newSessionHandle(com.ibm.icu.util.ULocale.FRENCH);
        if (ressources != null) session.setResourceFolder(ressources); // feuilles de style, bibliothèques…
        try {
            var conception = session.openDesign(fichier);
            for (Object e : conception.getErrorList()) {
                var detail = (org.eclipse.birt.report.model.api.ErrorDetail) e;
                problemes.add("ligne " + detail.getLineNo() + " : " + detail.getMessage());
            }
            conception.close();
        } catch (org.eclipse.birt.report.model.api.DesignFileException e) {
            for (Object d : e.getErrorList()) {
                var detail = (org.eclipse.birt.report.model.api.ErrorDetail) d;
                problemes.add("ligne " + detail.getLineNo() + " : " + detail.getMessage());
            }
            if (problemes.isEmpty()) problemes.add(e.getMessage());
        }
        return problemes;
    }

    // Valeur d'un paramètre de rapport, convertie dans le type déclaré dans le rapport.
    static Object convertir(String valeur, String type) {
        if (valeur == null || valeur.isEmpty()) return null;
        return switch (type) {
            case "date" -> java.sql.Date.valueOf(valeur.substring(0, 10));
            case "dateTime" -> java.sql.Timestamp.valueOf(valeur.replace('T', ' ').length() == 10 ? valeur + " 00:00:00" : valeur.replace('T', ' '));
            case "integer" -> Integer.valueOf(valeur.trim());
            case "decimal", "float" -> Double.valueOf(valeur.trim().replace(',', '.'));
            case "boolean" -> Boolean.valueOf(valeur.trim());
            default -> valeur;
        };
    }

    // ---------------------------------------------------------------- outils

    // « --nom valeur » ; les paramètres de rapport « --param nom=valeur » peuvent être répétés.
    static Map<String, String> lireOptions(String[] args) {
        Map<String, String> options = new HashMap<>();
        for (int i = 1; i + 1 < args.length; i += 2) {
            if (!args[i].startsWith("--")) continue;
            if (args[i].equals("--param") && args[i + 1].contains("=")) {
                String[] morceaux = args[i + 1].split("=", 2);
                options.put("param:" + morceaux[0], morceaux[1]);
            } else {
                options.put(args[i].substring(2), args[i + 1]);
            }
        }
        return options;
    }

    static String messageSql(SQLException e) {
        String message = e.getMessage();
        if (e.getErrorCode() == 1045) return "Utilisateur ou mot de passe refusé par MySQL.";
        if (e.getErrorCode() == 1049) return "Base de données inconnue sur ce serveur.";
        if ("08S01".equals(e.getSQLState())) return "Serveur MySQL injoignable (adresse, port ou réseau).";
        return message;
    }

    static void erreur(String message) {
        System.out.println(new Json().ouvrir().champ("erreur", message).fermer());
    }

    // Écriture JSON minimale (Java n'en a pas dans sa bibliothèque standard).
    static class Json {
        private final StringBuilder texte = new StringBuilder();
        private boolean attendVirgule = false;

        Json ouvrir() { texte.append('{'); attendVirgule = false; return this; }
        String fermer() { texte.append('}'); return texte.toString(); }
        Json fermerSansVirgule() { texte.append('}'); attendVirgule = false; return this; }
        Json debutListe() { texte.append('['); attendVirgule = false; return this; }
        Json finListe() { texte.append(']'); return this; }
        Json virgule() { texte.append(','); attendVirgule = false; return this; }

        Json nom(String nom) {
            if (attendVirgule) texte.append(',');
            texte.append(chaine(nom)).append(':');
            attendVirgule = false;
            return this;
        }

        Json champ(String nom, Object valeur) {
            nom(nom);
            valeur(valeur);
            attendVirgule = true;
            return this;
        }

        Json valeur(Object valeur) {
            if (valeur == null) texte.append("null");
            else if (valeur instanceof Boolean || valeur instanceof Number) texte.append(valeur);
            else texte.append(chaine(valeur.toString()));
            return this;
        }

        static String chaine(String s) {
            StringBuilder r = new StringBuilder("\"");
            for (char c : s.toCharArray()) {
                switch (c) {
                    case '"' -> r.append("\\\"");
                    case '\\' -> r.append("\\\\");
                    case '\n' -> r.append("\\n");
                    case '\r' -> r.append("\\r");
                    case '\t' -> r.append("\\t");
                    default -> {
                        if (c < 0x20) r.append(String.format("\\u%04x", (int) c));
                        else r.append(c);
                    }
                }
            }
            return r.append('"').toString();
        }
    }
}
