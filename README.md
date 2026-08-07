# Tréninkáč Dashboard – Chrome rozšíření

Alternativní přehled tréninkových dat týmu Dorost LPU z aplikace Tréninkáč, rozdělený po cyklech a týdnech.

---

## Instalace do Chrome

### Ze stránky Releases (doporučeno)

1. Přejděte na stránku [Releases](../../releases) tohoto repozitáře a stáhněte soubor `.zip` z nejnovější verze.

2. Zip rozbalte do libovolné složky v počítači.

3. Otevřete Chrome a do adresního řádku zadejte:
   ```
   chrome://extensions
   ```

4. V pravém horním rohu zapněte přepínač **Režim pro vývojáře** (Developer mode).

5. Klikněte na tlačítko **Načíst rozbalené** (Load unpacked).

6. V dialogu vyberte rozbalenou složku (tu, která obsahuje soubor `manifest.json`) a potvrďte.

7. Rozšíření se zobrazí v seznamu jako **Treninkac Dashboard**. V panelu nástrojů Chrome se objeví jeho ikona.

> Rozšíření zůstane nainstalované i po restartu Chrome. Při aktualizaci na novou verzi stáhněte nový zip, rozbalte ho (přepište staré soubory) a na stránce `chrome://extensions` klikněte na ikonu obnovení (↺) u tohoto rozšíření.

### Ze zdrojového kódu

Místo stahování zipu lze repozitář naklonovat nebo stáhnout jako zip přímo z GitHubu a postupovat od kroku 3 výše.

---

## Přihlášení

Rozšíření potřebuje přístupový token z aplikace Tréninkáč. Jsou dva způsoby, jak ho získat:

### Způsob 1 – Automaticky (doporučeno)

1. Otevřete v Chrome záložku s přihlášenou aplikací Tréninkáč:
   ```
   https://treninkac.orientacnisporty.cz
   ```

2. Klikněte na ikonu rozšíření v panelu nástrojů Chrome – otevře se dashboard v nové záložce.

3. Klikněte na tlačítko **Načíst z treninkac**.

4. Rozšíření token načte automaticky a přihlásí se.

### Způsob 2 – Ručně

1. Přihlaste se na [https://treninkac.orientacnisporty.cz](https://treninkac.orientacnisporty.cz).

2. Otevřete nástroje pro vývojáře (`F12`), přejděte na záložku **Application** (nebo **Aplikace**).

3. V levém panelu vyberte **Local Storage** → `https://treninkac.orientacnisporty.cz`.

4. Najděte klíč `trainee`, rozbalte jeho hodnotu a zkopírujte obsah pole `token` (dlouhý řetězec začínající `eyJ…`).

5. Vložte token do textového pole v dashboardu a klikněte na **Připojit**.

---

## Použití

### Přehled sportovce

Po přihlášení se v levém sloupci zobrazí seznam sportovců týmu (seřazený abecedně podle příjmení). Kliknutím na sportovce se načtou jeho tréninková data za aktuální sezónu (27. 10. 2025 – 25. 10. 2026).

Nad tabulkou jsou zobrazeny celkové součty za sezónu: počet cyklů, tréninkových dnů (DZ), aktivit (FA), celková vzdálenost běhu a čas pohybu. Pokud sportovec má nezpracované záznamy, zobrazí se jejich počet červeně.

### Tabulka cyklů a týdnů

Data jsou členěna do **tréninkových cyklů** (C1, C2, …). Každý cyklus obsahuje 4 týdny. Nezařazené aktivity (mimo plánované cykly) jsou automaticky přiřazeny do dalších cyklů (C*n*+1, C*n*+2, …).

Sloupce tabulky:

| Sloupec | Popis |
|---------|-------|
| **Cyklus / Týden** | Název cyklu nebo číslo týdne s datem od–do |
| **DZ** | Počet tréninkových dnů (dni zátěže) |
| **FA** | Celkový počet aktivit |
| **ZA** | Počet závodů |
| **NE** | Počet nemocných dnů |
| **Zátěž** | Celkový čas pohybu (h:mm) |
| **Běh km** | Celková vzdálenost běžeckých aktivit (km) |

- Kliknutím na **řádek cyklu** se rozbalí / sbalí přehled týdnů.
- Kliknutím na **řádek týdne** se zobrazí / skryjí jednotlivé aktivity.
- Kliknutím na **název aktivity** se otevře její detail přímo v Tréninkáči.
- Cykly a týdny s **nezpracovanými záznamy** jsou označeny červeně.

### Kopírování do schránky

U každého řádku cyklu se při najetí myší zobrazí ikona **⎘**. Kliknutím na ni se hodnoty daného cyklu (DZ, FA, ZA, NE, Zátěž, Běh km) zkopírují do schránky ve formátu pro přímé vložení do tabulky Google Sheets.

### Celkové součty

Odkaz **Celkové součty** v horní liště otevře souhrnnou tabulku se součty za celou sezónu pro všechny sportovce najednou. Data se v případě potřeby načtou automaticky.

Tabulku lze seřadit kliknutím na záhlaví libovolného sloupce; opakovaným kliknutím se pořadí obrátí.

---

## Odhlášení / změna tokenu

Klikněte na tlačítko **↺ Změnit token** v pravém horním rohu dashboardu.
