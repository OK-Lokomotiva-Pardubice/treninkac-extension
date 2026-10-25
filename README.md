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

Data jsou členěna do **tréninkových cyklů** (C1–C13). Cykly jsou dané kalendářem, ne aktivitami sportovce: tréninkový rok začíná v pondělí 27.10.2025, každý cyklus trvá přesně 4 po sobě jdoucí týdny a po 13 cyklech (52 týdnů) začíná nový tréninkový rok opět od C1. Hranice cyklů jsou tedy pro všechny sportovce stejné. Aktivity v týdnech bez tréninkového plánu se počítají do svého kalendářního cyklu.

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

### Sezóny

Odkaz **Sezóny** v horní liště ukazuje pokrok každého sportovce napříč tréninkovými roky (aktuální a tři předchozí), bez ohledu na to, v jakém týmu který rok proběhl. Zahrnuje současné i bývalé členy z týmů 117, 108 a 8 (bývalí jsou označeni „bývalý“).

- Pro každého sportovce je malý graf s hodnotami po cyklech C1–C13, každá sezóna jedna čára.
- Přepínač **Běh km / Zátěž** mění ukazatel, **Grafy / Tabulka** způsob zobrazení.
- **Škála** může být vlastní u každého sportovce, nebo společná pro všechny.
- **Řazení** je ve výchozím stavu podle objemu letos, dále podle změny oproti předchozí sezóně a podle jména. Filtr **Sportovci** omezí výběr na současné nebo bývalé členy.
- Kliknutím na sportovce se nahoře zobrazí detail se dvěma většími grafy (km a Zátěž) a po najetí myší se zobrazí hodnoty všech sezón pro daný cyklus.

Data se skládají z tréninkového deníku sportovce, takže nezávisí na týmovém plánu. Nemocné dny (NE) se tak zrekonstruovat nedají.

### Co znamená Běh km a Zátěž

V záložkách Celkové součty i Sezóny platí totéž:

- **Běh km** je součet kilometrů pouze běžeckých aktivit (běh, trail, OB). Chůze, kolo a další sporty se do kilometrů nepočítají.
- **Zátěž** je součet času všech sportů dohromady.
- Obojí zahrnuje i **nezpracované** aktivity, takže čísla mohou být vyšší než na webu Tréninkáče, který počítá jen zpracované. U nezpracovaných aktivit se v seznamu zobrazí sport, např. „Kolo · nezpracováno“.

---

## Odhlášení / změna tokenu

Klikněte na tlačítko **↺ Změnit token** v pravém horním rohu dashboardu.

---

## Verze

| Verze | Datum | Popis |
|-------|-------|-------|
| **1.0.0** | 10.8.2026 | Start |
| **1.0.1** | 9.9.2026 | Oprava zařazení do cyklů |
| **1.1.0** | 25.10.2026 | Nová záložka Sezóny (pokrok napříč sezónami, včetně bývalých členů). Běh km počítá jen běžecké sporty, u nezpracovaných aktivit se zobrazí sport. Vysvětlení Běh km a Zátěž v záložkách. |
