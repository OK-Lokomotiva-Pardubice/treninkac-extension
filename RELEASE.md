# Jak vydat novou verzi

## Před vydáním

1. Zkontrolujte, že jsou všechny změny commitnuty a pushnuty do větve `main`.

2. Zvyšte číslo verze v souboru `manifest.json`:
   ```json
   "version": "1.2.3"
   ```
   Dodržujte formát `MAJOR.MINOR.PATCH`:
   - **PATCH** (1.0.0 → 1.0.1) – oprava chyby
   - **MINOR** (1.0.0 → 1.1.0) – nová funkce, zpětně kompatibilní
   - **MAJOR** (1.0.0 → 2.0.0) – zásadní změna nebo přepracování

3. Commitněte změnu verze:
   ```bash
   git add manifest.json
   git commit -m "chore: bump version to 1.2.3"
   git push
   ```

## Vydání

4. Vytvořte tag odpovídající nové verzi (musí začínat `v`):
   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

5. GitHub Actions automaticky:
   - zabalí soubory rozšíření do `treninkac-dashboard-1.2.3.zip`
   - vytvoří nový Release na GitHubu s tímto zipem jako přílohou

## Ověření

6. Přejděte na záložku **Actions** v repozitáři a zkontrolujte, že workflow `Release` proběhl bez chyby.

7. Přejděte na záložku **Releases** a ověřte, že nová verze je viditelná a zip je přiložen.

## Oprava chybně vydané verze

Pokud je potřeba tag smazat a vydat znovu (např. byl přiložen špatný soubor):

```bash
# Smazání tagu lokálně i na GitHubu
git tag -d v1.2.3
git push origin --delete v1.2.3

# Oprava, commit, a nový tag
git add .
git commit -m "fix: ..."
git tag v1.2.3
git push && git push origin v1.2.3
```
