# AGENTS.md

## Mission
Construire, maintenir et faire evoluer NetsuShelf avec une priorite absolue sur:
- clean code
- robustesse
- lisibilite
- maintenabilite long terme

## Priorites techniques
1. Fiabilite fonctionnelle avant tout style ou optimisation prematuree.
2. Simplicite: preferer des solutions claires et testables.
3. Cohesion: respecter les conventions deja en place avant d'en introduire de nouvelles.
4. Evolution incrementale: petits changements atomiques et verifies.

## Clean code obligatoire
1. Noms explicites (variables, fonctions, composants, fichiers).
2. Fonctions courtes a responsabilite unique.
3. Eviter les effets de bord caches.
4. Ne pas dupliquer la logique (DRY) quand cela ameliore vraiment la clarte.
5. Supprimer le code mort, commentaires obsoletes et TODO sans contexte.
6. Commenter uniquement le "pourquoi" (pas le "quoi" evident).

## Bonnes pratiques developpeur
1. Corriger la cause racine, pas seulement le symptome.
2. Conserver la compatibilite et eviter les regressions UX.
3. Ajouter des garde-fous (validation d'entree, etats vides, erreurs reseau).
4. Preserver l'accessibilite (labels, focus visible, clavier, contrastes).
5. Garder des commits petits, scopes et reversibles.
6. Documenter les decisions techniques non triviales.

## Frontend (React + Tailwind)
1. Composants React petits, reutilisables, et centres sur un usage clair.
2. Eviter la logique metier complexe dans le rendu JSX.
3. Centraliser les styles utilitaires repetes (classes composees/selecteurs dedies).
4. Utiliser un style visuel coherent (espacements, typographie, couleurs, etats).
5. Ne pas casser les IDs/contrats DOM utilises par la logique existante sans migration explicite.

## Qualite et verification
1. Tester les scenarios critiques avant livraison (analyse URL, chapitres, export EPUB).
2. Verifier les erreurs console et l'etat des boutons/chargements.
3. Lancer lint/build avant fusion.
4. En cas de doute, preferer une solution simple et observable.

## Definition of done
Une tache est terminee si:
1. le besoin utilisateur est couvert,
2. le code est propre et comprehensible,
3. les risques principaux sont verifies,
4. la documentation minimale est a jour.
