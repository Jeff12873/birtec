// Le moteur Java de BiRTEC : tout ce qui demande Java (connexion MySQL, moteur BIRT).
//
// BiRTEC (Node) le lance pour chaque opération, avec une commande et des options ; le mot de passe MySQL
// arrive sur l'entrée standard (jamais en option : il apparaîtrait dans la liste des programmes du poste).
// La réponse est écrite en JSON sur la sortie standard.
//
//   java -cp "classes:lib/*" Moteur tester  --url jdbc:mysql://serveur:3306/base --utilisateur u
//   java -cp "classes:lib/*" Moteur schema  --url … --utilisateur u
//   java -cp "classes:lib/*" Moteur requete --url … --utilisateur u --limite 200     (SQL après le mot de passe)
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

    // ---------------------------------------------------------------- outils

    static Map<String, String> lireOptions(String[] args) {
        Map<String, String> options = new HashMap<>();
        for (int i = 1; i + 1 < args.length; i += 2) {
            if (args[i].startsWith("--")) options.put(args[i].substring(2), args[i + 1]);
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
