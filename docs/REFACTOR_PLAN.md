# Refonte UI des commandes — plan de rollout

Objectif : une expérience cohérente sur les 61 surfaces du bot, sans casser les
comportements métier existants. Ce document sert de contrat : une commande est
« refondue » quand elle coche **tous** les points de la checklist ci-dessous.

## Fondations (phase 0 — terminée)

- `src/ui/kit.js` : embeds/footers, nombres, timestamps, icônes de serveur,
  barre de progression, pagination (boutons + select menu).
- `docs/STYLE.md` : vocabulaire, ton, emoji, couleurs, erreurs.
- `src/config/commandMeta.js` : source unique des catégories et listes DM/global.
- Tests unitaires des helpers purs (`tests/unit/`).

## Checklist par commande

1. **Structure** : `createEmbed`/`successEmbed`/`errorEmbed`/`warningEmbed`,
   titre court, description actionnable, `brandFooter(contexte)`.
2. **Hiérarchie** : un titre, au plus 6 champs visibles, valeurs courtes ;
   les détails longs passent dans un bouton « Détails » ou une seconde page.
3. **États** : chargement (defer), vide, succès, erreur, confirmation,
   expiration du collecteur — tous dessinés, aucun message muet.
4. **Composants** : `buildNavRow()` / `buildPageJumpRow()`, labels en français,
   boutons désactivés aux limites, fallback MP si le token devient invalide.
5. **Permissions** : `ownerOnly: true` + `isBotOwner()`, vérification côté code
   et côté Discord, réponse éphémère en serveur.
6. **Sécurité** : mentions supprimées (`allowedMentions.parse: []`), entrées
   sanitizées, IDs entre backticks, jamais de stack trace à l'utilisateur.
7. **Perfs** : une seule requête Discord par écran, clés mises en cache,
   collecteurs bornés et arrêtés sur tous les chemins.
8. **Tests** : au moins un test unitaire pour chaque nouveau helper pur.

## Phases

| Phase | Périmètre | État |
| --- | --- | --- |
| 0 | Fondations UI + style + tests | terminée |
| 1 | Owner : `/manage` (list, info, leave, invite), `/diag`, `/ownerrole`, `/logtest` | terminée |
| 2 | Général : `/help`, `/ping`, `/avatar`, `/userinfo`, `/serverinfo`, utilitaires | terminée |
| 3 | Modération : ban/kick/warn/clear/timeout/mass actions | terminée |
| 4 | Tickets, giveaways, bienvenue, rôles par réaction, stats, réglages | terminée |
| 5 | Dashboards `commands/**/modules/` | terminée |
| 6 | Audit final : imports, tests, docs, logs Render | terminée (local) |

## Audit final (novembre 2026)

- **172 fichiers JS** analysés avec `node --check` (Node 22) : aucun échec.
- **172 imports** vers `src/ui/kit.js` vérifiés : tous les helpers existent.
- `verify-final.ps1` : `VERIFICATION GLOBALE: OK`.
- Tests unitaires : 16 passent ; `validation.test.js` nécessite `node_modules`
  (`winston` absent localement). À relancer avec `npm test` après installation.
- La vérification des logs Render (nouveaux embeds, absence d'erreur runtime)
  reste à faire après déploiement.

## Règles de non-régression

- Aucune commande n'est supprimée ni renommée sans accord explicite.
- Les options slash existantes gardent leur nom et leur type.
- Les alias préfixés restent fonctionnels.
- Chaque lot est livré avec une vérification `node --check` sur les fichiers
  touchés et les tests unitaires disponibles.
