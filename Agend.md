# Agend.md

## Objectif
Moderniser l'interface de NetsuShelf pour la rendre plus logique, plus rapide a utiliser et plus maintenable.

## Plan de progression
1. Migrer la couche de presentation de la popup vers React (sans casser la logique existante).
2. Appliquer Tailwind CSS pour harmoniser style, contraste et spacing.
3. Clarifier le workflow utilisateur: analyser -> verifier -> exporter.
4. Reorganiser visuellement les zones critiques: metadonnees, options, bibliotheque, chapitres.
5. Ajouter des indicateurs d'etat pour mieux comprendre ce qui se passe pendant l'usage.

## Exigences de qualite
1. Clean code obligatoire sur chaque changement.
2. Respect strict des bonnes pratiques de developpement.
3. Refactoring progressif et securise (pas de re-ecriture brutale sans validation).
4. Verification build/lint a chaque iteration importante.

## Standards developpeur
1. Lisibilite > clever code.
2. Fonctions courtes et responsabilites claires.
3. Documentation concise des decisions non evidentes.
4. Priorite a la stabilite et a l'experience utilisateur.
