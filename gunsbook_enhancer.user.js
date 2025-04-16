

// ==UserScript==
// @name         GunsBook Enhancer
// @namespace    https://github.com/CrocodilusCZ/
// @version      1.0.3
// @description  Rozbalí příspěvky/komentáře, zvýrazní nejnovější komentář a vylepšuje zobrazení obrázků
// @author       Redsnake
// @match        https://gunsbook.com/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/CrocodilusCZ/Gunsbook_enhancer/master/gunsbook_enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/CrocodilusCZ/Gunsbook_enhancer/master/gunsbook_enhancer.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- Konfigurace ---
   
    const CONFIG = {
        CHECK_INTERVAL: 1500,           // Interval pro kontrolu a zvýraznění (ms)
        SCROLL_DEBOUNCE: 300,           // Čekání po doskrolování (ms)
        MAX_EXPAND_ITERATIONS: 8,       // Max pokusů o rozbalení v jednom cyklu
        EXPAND_DELAY: 500,              // Pauza mezi kliknutími na rozbalení (ms)
        // Načtení uložené barvy zvýraznění nebo použití výchozí
        HIGHLIGHT_COLOR: localStorage.getItem('gb_highlight_color') || 'rgba(46, 204, 113, 0.15)',
        // Načtení uložené barvy okraje nebo použití výchozí
        HIGHLIGHT_BORDER: `3px solid ${localStorage.getItem('gb_highlight_border_color') || '#2ecc71'}`,
        // Načtení uložené barvy textu nebo použití výchozí
        HIGHLIGHT_TEXT_COLOR: localStorage.getItem('gb_highlight_text_color') || '#2ecc71',
        DEBUG: false,                   // Pro běžné debug výpisy - výchozí stav vypnuto
        IMPORTANT_LOGS: false,           // Pro důležité výpisy - výchozí stav vypnuto
        NOTIFICATION_FILTERS: JSON.parse(localStorage.getItem('gb_notification_filters')) || ["posted in", "new member"],

    };

    // --- Pomocné Funkce ---
    const Utils = {
    log: (msg, ...args) => CONFIG.DEBUG && console.log('[GB Simple Highlighter]', msg, ...args),
    // Přidejme proměnnou pro kontrolu "důležitých" výpisů
    logImportant: (msg, ...args) => CONFIG.IMPORTANT_LOGS && console.log('[GB Simple Highlighter IMPORTANT]', msg, ...args),
    debounce: (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    },

    // Nová throttle funkce
    throttle: (func, limit) => {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },
        // Vylepšená funkce pro zpracování časových údajů
        parseTimeToMs: (timeText) => {
            if (!timeText) return Infinity;
            timeText = timeText.toLowerCase();
            
            // Speciální případ pro "právě teď" a "a few seconds"
            if (timeText.includes('just now')) return 0;
            if (timeText.includes('a few seconds')) return 0; // Přidaná podpora pro "a few seconds"
            
            // Speciální případy pro "an hour", "a minute" atd. bez čísla
            if (timeText === 'an hour' || timeText === 'a hour') return 1 * 60 * 60 * 1000;
            if (timeText === 'a minute' || timeText === 'a min') return 1 * 60 * 1000;
            if (timeText === 'a second' || timeText === 'a sec') return 1 * 1000;
            
            // Získáme celé číslo pomocí regulárního výrazu
            const match = timeText.match(/(\d+)/);
            const value = match ? parseInt(match[0]) : 1;
            
            // Výpočet milisekund podle jednotky času
            if (timeText.includes('second')) return value * 1000;
            if (timeText.includes('minute') || timeText.includes('min')) return value * 60 * 1000;
            if (timeText.includes('hour')) return value * 60 * 60 * 1000;
            if (timeText.includes('day')) return value * 24 * 60 * 60 * 1000;
            if (timeText.includes('yesterday')) return 1 * 24 * 60 * 60 * 1000;
            
            // Přidáme logování pro diagnostiku
            Utils.log(`Nepodařilo se rozpoznat formát času: "${timeText}", používám Infinity`);
            return Infinity; // Pro týdny, měsíce atd.
        },
        isInViewport: (el) => {
            const rect = el.getBoundingClientRect();
            return rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
        }
    };

    // --- Hlavní Objekt Skriptu ---
    const Highlighter = {
    state: {
    isDisabled: false,
    isProcessing: false,
    clickedButtonIds: new Set(),
    expandingDisabled: false,  // Stav pro zapnutí/vypnutí rozbalování
    highlightingDisabled: false,  // stav pro zapnutí/vypnutí zvýrazňování (přidána čárka)
    notificationsHidingDisabled: false,  // stav pro zapnutí/vypnutí skrývání notifikací
    imageEnhancementDisabled: false,  //stav pro zapnutí/vypnutí vylepšení obrázků
    announcementsHidingDisabled: false  // NOVÉ: stav pro zapnutí/vypnutí skrývání oznámení


},
         // Nová metoda pro nastavení barvy zvýraznění
    setHighlightColors: function(bgColor, borderColor, textColor) {
        // Uložíme nové hodnoty do konfigurace
        CONFIG.HIGHLIGHT_COLOR = bgColor;
        CONFIG.HIGHLIGHT_BORDER = `3px solid ${borderColor}`;
        CONFIG.HIGHLIGHT_TEXT_COLOR = textColor;
        
        // Uložíme hodnoty do localStorage pro budoucí načtení
        localStorage.setItem('gb_highlight_color', bgColor);
        localStorage.setItem('gb_highlight_border_color', borderColor);
        localStorage.setItem('gb_highlight_text_color', textColor);
        
        Utils.logImportant(`Nastaveny nové barvy zvýraznění: BG=${bgColor}, Border=${borderColor}, Text=${textColor}`);
        
        // Přeaplikujeme zvýraznění s novými barvami, pokud je aktivní
        if (!this.state.isDisabled && !this.state.highlightingDisabled) {
            this.highlightVisiblePosts();
        }
    },

        

// Upravit metodu pro skrývání notifikací:
hideUnwantedNotifications: function() {
    // Vyhledáme všechny notifikace
    const notifications = document.querySelectorAll('div[data-testid="itemNotification"]');
    
    let skrytePocet = 0;
    
    // Procházíme každou notifikaci
    notifications.forEach(notification => {
        // Kontrola, zda notifikace již není skrytá
        if (notification.style.display === 'none') return;
        
        // Hledáme text notifikace
        const notificationText = notification.querySelector('div[data-testid="itemSummary"]');
        if (notificationText) {
            const text = notificationText.textContent.toLowerCase();
            
            // Speciální případ - nezahrnuje "reacted to your post in" - ty vždy chceme ponechat
            if (text.includes('reacted to your post in')) return;
            
            // Použití uložených filtrů pro kontrolu
            let shouldHide = false;
            for (const filter of CONFIG.NOTIFICATION_FILTERS) {
                if (text.includes(filter.toLowerCase())) {
                    shouldHide = true;
                    break;
                }
            }
            
            if (shouldHide) {
                notification.style.display = 'none';
                skrytePocet++;
            }
        }
    });
    
    // Logujeme pouze pokud jsme něco skryli
    if (skrytePocet > 0) {
        Utils.logImportant(`Skryto ${skrytePocet} notifikací podle uživatelských filtrů`);
    }
},

// Přidejte novou metodu pro nastavení filtrů:
setNotificationFilters: function(filtersArray) {
    // Uložíme nové hodnoty do konfigurace
    CONFIG.NOTIFICATION_FILTERS = filtersArray;
    
    // Uložíme hodnoty do localStorage pro budoucí načtení
    localStorage.setItem('gb_notification_filters', JSON.stringify(filtersArray));
    
    Utils.logImportant(`Nastaveny nové filtry notifikací: ${filtersArray.join(', ')}`);
},

// Nová funkce pro skrytí oznámení administrátorů
hideAdminAnnouncements: function() {
    // Pokud je skript vypnutý nebo je konkrétně tato funkce vypnutá, neprovádíme nic
    if (this.state.isDisabled || this.state.announcementsHidingDisabled) return;
    
    // Vyhledáme všechny kontejnery oznámení
    const announcements = document.querySelectorAll('[data-testid="blockAnnouncementListing"]');
    
    let skrytePocet = 0;
    
    // Procházíme každé oznámení
    announcements.forEach(announcement => {
        // Kontrola, zda oznámení již není skryté
        if (announcement.style.display === 'none') return;
        
        // Kontrola, zda existuje tlačítko "I have read this"
        const readButton = announcement.querySelector('.ltr-1m0elym');
        if (readButton) {
            // Skryjeme celý kontejner oznámení
            announcement.style.display = 'none';
            skrytePocet++;
        }
    });
    
    // Logujeme pouze pokud jsme něco skryli
    if (skrytePocet > 0) {
        Utils.logImportant(`Skryto ${skrytePocet} oznámení administrátorů`);
    }
},

// Funkce pro obsluhu kliknutí na logo stránky - přidej ji mezi ostatní metody objektu Highlighter
addLogoRefreshBehavior: function() {
    // Nejprve zkusíme najít logo přímo
    const trySetupLogoRefresh = () => {
        const logoLink = document.querySelector('a[data-testid="linkLogo"]');
        
        if (logoLink) {
            // Zjistíme, zda už máme event listener přidaný
            if (logoLink.hasAttribute('gb-refresh-handler')) {
                return true; // Už jsme nastavili handler, nepotřebujeme pokračovat
            }
            
            Utils.logImportant('Nalezeno logo stránky, přidávám funkci pro přesměrování na hlavní stránku');
            
            // Označíme, že jsme přidali handler (aby se nepřidával vícekrát)
            logoLink.setAttribute('gb-refresh-handler', 'true');
            
            // Přidáme event listener pro kliknutí
            logoLink.addEventListener('click', function(event) {
                // Zabráníme standardnímu chování (přesměrování na / se zachováním historie)
                event.preventDefault();
                
                // Přesměrování na hlavní stránku bez ohledu na to, kde jsme
                window.location.href = 'https://gunsbook.com/';
                
                Utils.log('Přesměrování na hlavní stránku Gunsbooku');
            });
            
            return true;
        }
        
        return false;
    };
    
    // Zkusíme to hned
    if (!trySetupLogoRefresh()) {
        // Pokud se to nepodařilo, nastavíme interval pro opakované pokusy
        const logoCheckInterval = setInterval(() => {
            if (trySetupLogoRefresh()) {
                // Podařilo se najít a nastavit logo, můžeme ukončit interval
                clearInterval(logoCheckInterval);
                Utils.logImportant('Logo bylo úspěšně nalezeno a nastaveno pro přesměrování');
            }
        }, 1000); // Kontrola každou sekundu
        
        // Zrušíme interval po 10 sekundách, pokud se logo nenašlo
        setTimeout(() => {
            if (logoCheckInterval) {
                clearInterval(logoCheckInterval);
                Utils.log('Nepodařilo se najít logo po 10 sekundách, interval zrušen');
            }
        }, 10000);
    }
},

// Přidejte novou metodu pro otevření nastavení filtrů:
openNotificationFilterSettings: function() {
    // Vytvoříme overlay s editorem filtrů
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '10001',
        flexDirection: 'column'
    });
    
    // Vytvoříme kontejner pro editor
    const container = document.createElement('div');
    Object.assign(container.style, {
        backgroundColor: 'white',
        padding: '20px',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '15px',
        width: '400px',
        maxWidth: '90%'
    });
    
    // Titulek
    const title = document.createElement('h3');
    title.textContent = 'Nastavení filtrů notifikací';
    Object.assign(title.style, {
        margin: '0 0 10px 0',
        textAlign: 'center',
        color: '#333'
    });
    
    // Popisek
    const description = document.createElement('div');
    description.innerHTML = 'Zadejte klíčová slova nebo fráze oddělené čárkou. Notifikace obsahující tato slova budou skryty.<br><strong>Poznámka:</strong> Notifikace obsahující "reacted to your post in" nebudou nikdy skryty.';
    Object.assign(description.style, {
        fontSize: '14px',
        color: '#555',
        marginBottom: '10px',
        lineHeight: '1.4'
    });
    
    // Textové pole pro filtry
    const filtersInput = document.createElement('textarea');
    filtersInput.value = CONFIG.NOTIFICATION_FILTERS.join(', ');
    Object.assign(filtersInput.style, {
        width: '100%',
        height: '100px',
        padding: '8px',
        border: '1px solid #ccc',
        borderRadius: '4px',
        resize: 'vertical',
        fontFamily: 'inherit',
        fontSize: '14px'
    });
    
    // Aktuální seznam filtrovaných notifikací (statistiky)
    const statsContainer = document.createElement('div');
    Object.assign(statsContainer.style, {
        fontSize: '13px',
        color: '#666',
        marginTop: '5px',
        display: 'flex',
        flexDirection: 'column',
        gap: '5px'
    });
    
    const statsTitle = document.createElement('div');
    statsTitle.textContent = 'Aktuálně aktivní filtry:';
    statsTitle.style.fontWeight = 'bold';
    
    const statsList = document.createElement('ul');
    Object.assign(statsList.style, {
        margin: '5px 0',
        paddingLeft: '20px'
    });
    
    CONFIG.NOTIFICATION_FILTERS.forEach(filter => {
        const item = document.createElement('li');
        item.textContent = filter;
        statsList.appendChild(item);
    });
    
    statsContainer.appendChild(statsTitle);
    statsContainer.appendChild(statsList);
    
    // Tlačítka pro uložení, zrušení a reset
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'space-between';
    buttonContainer.style.marginTop = '15px';
    
    const saveButton = document.createElement('button');
    saveButton.textContent = 'Uložit';
    Object.assign(saveButton.style, {
        padding: '8px 16px',
        backgroundColor: '#2ecc71',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        fontWeight: 'bold'
    });
    
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Zrušit';
    Object.assign(cancelButton.style, {
        padding: '8px 16px',
        backgroundColor: '#e74c3c',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        fontWeight: 'bold'
    });
    
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Výchozí';
    Object.assign(resetButton.style, {
        padding: '8px 16px',
        backgroundColor: '#3498db',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        fontWeight: 'bold'
    });
    
    buttonContainer.appendChild(resetButton);
    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(saveButton);
    
    // Sestavení kontejneru
    container.appendChild(title);
    container.appendChild(description);
    container.appendChild(filtersInput);
    container.appendChild(statsContainer);
    container.appendChild(buttonContainer);
    
    overlay.appendChild(container);
    
    // Akce tlačítek
    saveButton.addEventListener('click', () => {
        // Zpracování vstupu, rozdělení podle čárky, odstranění mezer
        const rawFilters = filtersInput.value.split(',');
        const processedFilters = rawFilters
            .map(filter => filter.trim())
            .filter(filter => filter.length > 0);
        
        // Uložení nových filtrů
        this.setNotificationFilters(processedFilters);
        
        // Aplikujeme filtry ihned
        if (!this.state.notificationsHidingDisabled) {
            this.hideUnwantedNotifications();
        }
        
        // Zavření dialogu
        document.body.removeChild(overlay);
    });
    
    cancelButton.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });
    
    resetButton.addEventListener('click', () => {
        // Resetování na výchozí hodnoty
        filtersInput.value = "posted in, new member";
    });
    
    // Přidání do stránky
    document.body.appendChild(overlay);
},

        findSingleExpandButton: function() {
            const selectors = [
                'span[role="button"]:not(:empty)',          // Obecné tlačítko ve span
                'div[role="button"]:not(:empty)',           // Obecné tlačítko v div
                '[data-testid="buttonToggleComment"]',      // Specifické tlačítko komentářů
                'div[aria-label="reply"][role="button"]',   // Tlačítko odpovědí
                '.ltr-18xv4zj',                             // Často "View more..." text
                '.ltr-70qvj9'                               // Specifický selektor pro "View previous comment"
            ];

            for (const selector of selectors) {
                const buttons = document.querySelectorAll(selector);
                for (const btn of buttons) {
                    const text = btn.textContent.trim().toLowerCase();
                    // Unikátnější ID tlačítka (přidán offsetLeft)
                    const btnId = `${text}-${btn.offsetTop}-${btn.offsetLeft}`;

                    // Přeskočit, pokud není viditelné (používá upravenou Utils.isInViewport),
                    // obsahuje "less", nebo už bylo nedávno kliknuto
                    if (!Utils.isInViewport(btn) || text.includes("less") || this.state.clickedButtonIds.has(btnId)) {
                        if (this.state.clickedButtonIds.has(btnId)) {
                             Utils.log(`Přeskakuji tlačítko "${text}", ID ${btnId} je v paměti.`);
                        }
                        continue;
                    }

                    // --- KONTROLA PRO TLAČÍTKO PŘEPÍNÁNÍ KOMENTÁŘŮ ---
                    // Pokud je to tlačítko pro přepnutí komentářů (NE "previous comment")
                    if (btn.matches('[data-testid="buttonToggleComment"]') || (text.includes("comment") && !text.includes("add") && !text.includes("previous"))) {
                        const postContainer = btn.closest('div[data-eid^="feed.entities.feed."]');
                        if (postContainer) {
                            const visibleComment = postContainer.querySelector('[data-testid="comment"]');
                            // Pokud už je nějaký komentář viditelný (má výšku), neklikej
                            if (visibleComment && visibleComment.offsetHeight > 0) {
                                Utils.log(`Přeskakuji tlačítko "${text}", komentáře jsou již viditelné.`);
                                continue; // Nepotřebujeme klikat, přejdi na další tlačítko
                            }
                        }
                    }
                    // --- KONEC KONTROLY ---

                    // Hledáme klíčová slova pro rozbalení (včetně "previous")
                    if (text.includes("more") || text.includes("replies") || text.includes("comments") || text.includes("view") || text.includes("previous")) {
                        Utils.log(`Nalezeno tlačítko k rozbalení: "${text}" (ID: ${btnId})`);
                        return { element: btn, id: btnId }; // Vrátíme první vhodné
                    }
                }
            }
            return null; // Nic k rozbalení nenalezeno
        },

        // Pokusí se rozbalit obsah (iterativně)
        expandContent: async function(iterationsLeft = CONFIG.MAX_EXPAND_ITERATIONS) {
            if (iterationsLeft <= 0) {
                Utils.log('Dosáhnuto limitu pokusů o rozbalení.');
                return;
            }

            const buttonInfo = this.findSingleExpandButton();
            if (buttonInfo) {
                Utils.logImportant(`Klikám na rozbalovací tlačítko: "${buttonInfo.element.textContent.trim()}" (zbývá pokusů: ${iterationsLeft - 1})`);
        try {
            const buttonElement = buttonInfo.element;
            const buttonId = buttonInfo.id;
            const buttonText = buttonElement.textContent.trim(); // Uložíme si text pro logování v timeoutu

            // Klikneme na tlačítko
            buttonElement.click();

            // Zapamatujeme si ID tlačítka
            this.state.clickedButtonIds.add(buttonId);
            Utils.log(`Přidáno ID tlačítka do paměti: ${buttonId}`);

            // Nastavíme časovač pro odstranění ID z paměti po 15 sekundách
            // To zabrání okamžitému opětovnému kliknutí, ale umožní kliknout později
            setTimeout(() => {
                if (this.state.clickedButtonIds.has(buttonId)) {
                    this.state.clickedButtonIds.delete(buttonId);
                    Utils.log(`Odstraněno ID tlačítka z paměti po timeoutu: ${buttonId} ("${buttonText}")`);
                }
            }, 15000); // 15 sekund

            // Krátká pauza a rekurzivní volání pro další tlačítka
            await new Promise(resolve => setTimeout(resolve, CONFIG.EXPAND_DELAY));
            await this.expandContent(iterationsLeft - 1);

        } catch (e) {
            Utils.log(`Chyba při klikání na tlačítko: ${e.message}`);
            // I při chybě zkusíme pokračovat, ale snížíme počet pokusů
            await new Promise(resolve => setTimeout(resolve, CONFIG.EXPAND_DELAY / 2));
            await this.expandContent(iterationsLeft - 1);
        }
            } else {
                Utils.log('Nenalezena žádná další tlačítka k rozbalení v tomto cyklu.');
            }
        },

 // Zvýrazní nejnovější komentář v daném příspěvku - KOMPLETNÍ PŘEPIS
highlightNewestInPost: function(post) {
    // Reset předchozího zvýraznění
    post.querySelectorAll('.gb-highlighted-comment').forEach(el => {
        el.classList.remove('gb-highlighted-comment');
        el.style.backgroundColor = '';
        el.style.borderLeft = '';
        el.style.borderRadius = '';
    });
    post.querySelectorAll('.gb-highlighted-time').forEach(el => {
        el.classList.remove('gb-highlighted-time');
        el.style.color = '';
        el.style.fontWeight = '';
    });

    // Detekce počtu komentářů včetně zanořených odpovědí
const commentElements = post.querySelectorAll('[data-testid="comment"]');

// Pro hledání odpovědí musíme být specifičtější, abychom vyloučili hlavní komentáře
// Nejprve najdeme všechny zanořené odpovědi, které jsou uvnitř hlavních komentářů
const nestedReplies = [];
commentElements.forEach(comment => {
    // Hledáme odpovědi uvnitř hlavního komentáře (kromě samotného komentáře)
    const replies = comment.querySelectorAll('.ltr-c7xrli .ltr-rwjg63, .ltr-gq6jkq');
    nestedReplies.push(...Array.from(replies));
});

// Celkový počet je hlavní komentáře + zanořené odpovědi
const totalComments = commentElements.length + nestedReplies.length;

// Zvýrazňujeme pouze pokud máme více než 1 celkem
if (totalComments <= 1) {
    Utils.log(`Příspěvek má pouze ${totalComments} komentář(e), přeskakuji zvýrazňování`);
    return;
}
    
    // Sbíráme všechny časové údaje nehledě na strukturu
    let allTimeSpans = [];
    
    // VYLEPŠENÍ 1: Lepší selektory pro časové údaje v komentářích (včetně zanořených)
    const timeSelectors = [
        'span[role="link"]',              // Obecný selektor pro všechny časové odkazy
        '.ltr-t8y68f',                    // Standardní formát času v komentářích
        '.ltr-1rud4fp',                   // Formát času v zanořených komentářích
        '[aria-label*="20"]'              // Časové údaje s aria-label obsahujícím datum
    ];
    
    // VYLEPŠENÍ 2: Najdeme a zpracujeme VŠECHNY časové údaje pomocí více selektorů
    post.querySelectorAll(timeSelectors.join(', ')).forEach(span => {
        const text = span.textContent.trim();
        
        // DŮLEŽITÉ: Přeskočit časové údaje v záhlaví příspěvku
        // Kontrola, zda span je v záhlaví příspěvku nebo ne v komentáři
        const isPostHeader = !!span.closest('.jss130, .jss131, .ltr-lfrj0c, .jss144');
        
        // VYLEPŠENÍ 3: Lepší detekce, že je element součástí komentáře
        // Zahrnujeme více možných tříd a struktur pro komentáře
        const isInComment = !!span.closest('[data-testid="comment"], .ltr-rwjg63, .ltr-9tq2jr, .ltr-c7xrli, .ltr-gq6jkq, .MuiBox-root.ltr-j7qwjs, .ltr-1rud4fp');
        
        // Přeskočit, pokud jde o záhlaví nebo není v komentáři
        if (isPostHeader || !isInComment) {
            return;
        }
        
        // VYLEPŠENÍ 4: Vylepšený regulární výraz pro detekci časových údajů - včetně formátu "an hour"
        if (text.match(/(^|\s)(\d+|an?|just|few)\s*(second|sec|minute|min|hour|day|week|month|year|now)/i)) {
            const timeMs = Utils.parseTimeToMs(text);
            
            // Uložíme si všechny potřebné informace
            allTimeSpans.push({
                span: span,
                text: text,
                timeMs: timeMs,
                isNested: !!span.closest('.ltr-gq6jkq, .MuiBox-root.ltr-j7qwjs, .ltr-1rud4fp') // Detekce zanořeného komentáře
            });
            
            // Pro ladění vypíšeme více informací o nalezených časech
            Utils.log(`Nalezen čas: ${text}, ms: ${timeMs}, zanořený: ${!!span.closest('.ltr-gq6jkq, .MuiBox-root.ltr-j7qwjs, .ltr-1rud4fp')}`);
        }
    });
    
   // Pokud jsme našli časové údaje v komentářích
if (allTimeSpans.length > 0) {
    // Určíme pozici v DOM pro každé časové razítko - vyšší index = později v DOM = pravděpodobně novější
    allTimeSpans.forEach(item => {
        item.domIndex = Array.from(post.querySelectorAll('*')).indexOf(item.span);
    });
    
    // Seřadíme od nejnovějšího (nejmenší čas) s preferencí zanořených a později přidaných komentářů
    allTimeSpans.sort((a, b) => {
        // Časový rozdíl je převeden na znaménko (-1, 0, 1) - výrazně zrychlí sortování
        const timeCompare = Math.sign(a.timeMs - b.timeMs);
        
        if (timeCompare === 0) {
            if (a.isNested !== b.isNested) {
                return b.isNested - a.isNested; // Boolean na číslo: true = 1, false = 0
            }
            return b.domIndex - a.domIndex;
        }
        
        return timeCompare;
    });
    
    // Nejnovější časový údaj
    const newestTimeSpan = allTimeSpans[0].span;
    const newestTime = allTimeSpans[0].text;
    const isNested = allTimeSpans[0].isNested;
    
    Utils.logImportant(`Nalezen nejnovější čas: ${newestTime}, ms: ${allTimeSpans[0].timeMs}, zanořený: ${isNested}, DOM index: ${allTimeSpans[0].domIndex}`);
        
        // Zvýrazníme čas
        newestTimeSpan.classList.add('gb-highlighted-time');
        newestTimeSpan.style.color = CONFIG.HIGHLIGHT_TEXT_COLOR;
        newestTimeSpan.style.fontWeight = 'bold';
        
        // ALGORITMUS PRO NALEZENÍ KOMENTÁŘE K ZVÝRAZNĚNÍ
        let contentToHighlight = null;
        
        if (isNested) {
            // VYLEPŠENÍ 5: Lepší algoritmus pro zanořené komentáře
            // 1. Zkusíme nejprve najít kontejner komentáře přes nadřazené elementy - více možností
            const nestedContainer = newestTimeSpan.closest('.ltr-9tq2jr, .ltr-c7xrli, .ltr-1n160ra');
            
            if (nestedContainer) {
                // 2. Najdeme kontejner s obsahem v zanořeném komentáři
                contentToHighlight = nestedContainer.querySelector('.ltr-rwjg63') || nestedContainer;
            } else {
                // Alternativní cesta - jdeme od času nahoru a pak k obsahu
                // Najdeme nejbližší box s časem a jménem
                const timeBox = newestTimeSpan.closest('.MuiBox-root.ltr-tw4vmx');
                
                if (timeBox && timeBox.nextElementSibling) {
                    // Další element by měl obsahovat obsah komentáře
                    contentToHighlight = timeBox.nextElementSibling.querySelector('.ltr-rwjg63') || 
                                       timeBox.nextElementSibling;
                }
                
                // Pokud stále nemáme obsah, zkusíme jiné možnosti
                if (!contentToHighlight) {
                    // Jdeme nahoru více úrovní
                    const parentComment = newestTimeSpan.closest('.ltr-gq6jkq, .MuiBox-root.ltr-j7qwjs');
                    if (parentComment) {
                        contentToHighlight = parentComment.querySelector('.ltr-9tq2jr') || parentComment;
                    }
                }
            }
        } else {
            // HLAVNÍ KOMENTÁŘ - standardní cesta
            // 1. Najdeme nejbližší kontejner komentáře
            const commentContainer = newestTimeSpan.closest('[data-testid="comment"]');
            
            if (commentContainer) {
                // 2. Zkusíme nalézt obsah komentáře - postupujeme od konkrétnějších k obecnějším
                const selectors = [
                    '.ltr-9tq2jr',                              // Standardní kontejner obsahu
                    '.ltr-rwjg63',                              // Kontejner pro odpovědi
                    '.ltr-c7xrli',                              // Alternativní kontejner obsahu
                    '.MuiTypography-body1.ltr-1r1u03s',         // Typický textový obsah
                    '.ltr-1bakpcr'                              // Další možná varianta
                ];
                
                // Postupně procházíme selektory a hledáme první vyhovující
                for (const selector of selectors) {
                    const candidate = commentContainer.querySelector(selector);
                    if (candidate) {
                        contentToHighlight = candidate;
                        Utils.logImportant(`Našel jsem obsah komentáře pomocí selektoru: ${selector}`);
                        break;
                    }
                }
                
                // Pokud jsme nenašli žádný specifický obsah, použijeme celý kontejner komentáře
                if (!contentToHighlight) {
                    contentToHighlight = commentContainer;
                    Utils.logImportant('Žádný specifický obsah nenalezen, použiji celý kontejner komentáře');
                }
            }
        }
        
        
       // Pokud jsme našli obsah k zvýraznění, zvýrazníme ho
if (contentToHighlight) {
    contentToHighlight.classList.add('gb-highlighted-comment');
    contentToHighlight.style.backgroundColor = CONFIG.HIGHLIGHT_COLOR;
    contentToHighlight.style.borderLeft = CONFIG.HIGHLIGHT_BORDER;
    contentToHighlight.style.borderRadius = '8px';
    // Přidáme větší padding pro zvětšení zvýrazněné oblasti
    contentToHighlight.style.padding = '8px 12px';
    contentToHighlight.style.margin = '2px 0';
    
    // Pokud zdůraznění není na první pohled viditelné, zkusíme zvýraznit také nadřazený element
    if (contentToHighlight.offsetWidth < 50 || contentToHighlight.offsetHeight < 30) {
        const parentElement = contentToHighlight.parentElement;
        if (parentElement) {
            parentElement.classList.add('gb-highlighted-comment');
            parentElement.style.backgroundColor = CONFIG.HIGHLIGHT_COLOR;
            parentElement.style.borderLeft = CONFIG.HIGHLIGHT_BORDER;
            parentElement.style.borderRadius = '8px';
            // Přidáme také padding pro rodiče
            parentElement.style.padding = '8px 12px';
            parentElement.style.margin = '2px 0';
            Utils.logImportant('Zvýrazňuji také nadřazený element pro lepší viditelnost');
        }
    }
            
            // Přidejme logování DOM cesty pro diagnostiku
            Utils.logImportant(`DOM cesta zvýrazněného elementu: ${this.getDomPath(contentToHighlight)}`);
        } else {
            Utils.logImportant('Nenalezen kontejner pro zvýraznění obsahu komentáře');
            
            // Záložní řešení - zkusíme najít nějaký kontejner pomocí rodičovských elementů
            let parent = newestTimeSpan.parentElement;
            let attempts = 0;
            
            // Postupujeme nahoru až 5 kroků
            while (parent && attempts < 5) {
                if (parent.classList.contains('ltr-rwjg63') || 
                    parent.classList.contains('ltr-9tq2jr') || 
                    parent.classList.contains('ltr-c7xrli')) {
                    parent.classList.add('gb-highlighted-comment');
                    parent.style.backgroundColor = CONFIG.HIGHLIGHT_COLOR;
                    parent.style.borderLeft = CONFIG.HIGHLIGHT_BORDER;
                    parent.style.borderRadius = '8px';
                    // Přidáme větší padding pro zvětšení zvýrazněné oblasti
                    parent.style.padding = '8px 12px';
                    parent.style.margin = '2px 0';
                    Utils.logImportant('Nalezen rodičovský element k zvýraznění jako záložní řešení');
                    break;
                }
                parent = parent.parentElement;
                attempts++;
            }
        }
    } else {
        Utils.logImportant(`Nenalezeny žádné komentáře k zvýraznění v příspěvku ${post.getAttribute('data-eid')}`);
    }
},
        
        // Pomocná funkce pro získání DOM cesty elementu (pro ladění)
        getDomPath: function(element) {
            const path = [];
            let currentElement = element;
            
            while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
                let selector = currentElement.nodeName.toLowerCase();
                
                if (currentElement.id) {
                    selector += `#${currentElement.id}`;
                    path.unshift(selector);
                    break;
                } else {
                    let sibling = currentElement;
                    let siblingIndex = 1;
                    
                    while (sibling.previousElementSibling) {
                        sibling = sibling.previousElementSibling;
                        siblingIndex++;
                    }
                    
                    if (currentElement.className) {
                        const classes = currentElement.className.split(/\s+/)
                            .filter(c => c && !c.startsWith('ltr-') && !c.startsWith('jss'));
                        if (classes.length > 0) {
                            selector += `.${classes.join('.')}`;
                        }
                    }
                    
                    selector += `:nth-child(${siblingIndex})`;
                    path.unshift(selector);
                    
                    if (path.length > 4) break; // Omezíme hloubku cesty
                }
                
                currentElement = currentElement.parentElement;
            }
            
            return path.join(' > ');
        },

        // Nová metoda pro vylepšení prohlížeče obrázků
enhanceImageViewer: function(overlay, largeImg) {
    // Vytvoříme tlačítko pro stažení
    const downloadButton = document.createElement('a');
    downloadButton.textContent = '📥 Stáhnout obrázek';
    downloadButton.href = largeImg.src;
    downloadButton.download = largeImg.src.split('/').pop();
    downloadButton.target = '_blank';
    
    Object.assign(downloadButton.style, {
        color: 'white',
        padding: '8px 16px',
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: '4px',
        textDecoration: 'none',
        marginTop: '10px',
        textAlign: 'center',
        display: 'inline-block',
        cursor: 'pointer',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        fontWeight: '500',
        transition: 'background-color 0.2s ease'
    });
    
    // Efekty hover
    downloadButton.addEventListener('mouseenter', () => {
        downloadButton.style.backgroundColor = 'rgba(40, 120, 200, 0.7)';
    });
    
    downloadButton.addEventListener('mouseleave', () => {
        downloadButton.style.backgroundColor = 'rgba(0,0,0,0.5)';
    });
    
    // Přidáme tlačítko do overlay
    overlay.querySelector('div').appendChild(downloadButton);
},
// Vylepšená funkce pro zobrazení obrázků v plné velikosti
enhanceImages: function() {
    // Pokud je skript vypnutý nebo je konkrétně tato funkce vypnutá, neprovádíme nic
    if (this.state.isDisabled || this.state.imageEnhancementDisabled) return;
    
    Utils.log('Hledám obrázky k úpravě na lepší zobrazení...');
    
    // 1. KONTROLA DIALOGŮ - otevřený dialog s obrázkem
    const dialogImages = document.querySelectorAll('.MuiDialog-root.isLastDialog img');
    let dialogCount = 0;
    
    dialogImages.forEach(img => {
        if (!img.hasAttribute('gb-enhanced')) {
            // Označení jako upravený
            img.setAttribute('gb-enhanced', 'true');
            
            // Vylepšení vzhledu pouze pro dialogy
            img.style.maxWidth = '100%';
            img.style.maxHeight = '90vh';
            img.style.height = 'auto';
            img.style.objectFit = 'contain';
            
            // Změna URL na originální verzi pokud je to _500
            if (img.src && img.src.includes('_500.')) {
                const originUrl = img.src.replace('_500', '_origin');
                img.src = originUrl;
                dialogCount++;
            }
            
            Utils.logImportant('Upraven obrázek v dialogu pro lepší zobrazení');
        }
    });
    
    // 2. KONTROLA OBRÁZKŮ V KOMENTÁŘÍCH
    const commentImages = document.querySelectorAll('.ltr-164r41r img, .ltr-1338aev img, .MuiImage-root img');
    let count = 0;
    
    commentImages.forEach(img => {
        if (!img.hasAttribute('gb-enhanced')) {
            // Označení jako upravený
            img.setAttribute('gb-enhanced', 'true');
            
            // Najdeme nejbližší kontejner obrázku
            const imageContainer = img.closest('.ltr-164r41r') || 
                                  img.closest('.ltr-1338aev') || 
                                  img.closest('.MuiImage-root');
            
            if (imageContainer) {
                // Upravíme vzhled kontejneru pro lepší zobrazení
                imageContainer.style.maxWidth = '100%';
                imageContainer.style.margin = '5px 0';
                
                // Přidáme třídu pro lepší identifikaci
                imageContainer.classList.add('gb-enhanced-image-container');
            }
            
            // Přidáme click handler pro otevření v lightboxu
            img.style.cursor = 'zoom-in';
            
            count++;
        }
    });
    
    // 3. PŘIDÁME FUNKCI PRO ZVĚTŠENÍ OBRÁZKU V LIGHTBOXU S ORIGINÁLNÍ VERZÍ
    document.querySelectorAll('img[gb-enhanced="true"]:not([gb-click-handler])').forEach(img => {
        // Přidáme handler pouze pokud ještě není přidán
        img.setAttribute('gb-click-handler', 'true');
        
        img.addEventListener('click', (event) => {
            // Zabráníme standardnímu chování (otevření dialogu)
            event.stopPropagation();
            
            // Vytvoříme vlastní lightbox pro všechny obrázky
            const overlay = document.createElement('div');
            Object.assign(overlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0,0,0,0.9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: '10000',
                cursor: 'zoom-out',
                flexDirection: 'column'
            });
            
            // Přidáme kontejner pro obrázek a ovládací prvky
            const contentContainer = document.createElement('div');
            Object.assign(contentContainer.style, {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                maxWidth: '95%',
                maxHeight: '95%'
            });
            
            // Přidáme samotný obrázek s originální URL
            const largeImg = document.createElement('img');
            
            // Změna URL na originální verzi pokud je to _500
            if (img.src && img.src.includes('_500.')) {
                largeImg.src = img.src.replace('_500', '_origin');
            } else {
                largeImg.src = img.src; // Použijeme stejnou URL pokud není _500
            }
            
            Object.assign(largeImg.style, {
                maxWidth: '100%',
                maxHeight: '85vh',
                objectFit: 'contain',
                border: '2px solid white',
                borderRadius: '4px'
            });
            
            // Přidáme indikátor načítání
            const loadingText = document.createElement('div');
            loadingText.textContent = 'Načítám originální velikost...';
            Object.assign(loadingText.style, {
                color: 'white',
                fontSize: '14px',
                marginTop: '10px',
                marginBottom: '10px',
                textAlign: 'center'
            });
            
            // Přidáme info o kliknutí pro zavření
            const infoText = document.createElement('div');
            infoText.textContent = 'Kliknutím kamkoliv zavřete náhled';
            Object.assign(infoText.style, {
                color: 'white',
                fontSize: '14px',
                marginTop: '10px',
                textAlign: 'center'
            });
            
            contentContainer.appendChild(largeImg);
            contentContainer.appendChild(loadingText);
            contentContainer.appendChild(infoText);
            overlay.appendChild(contentContainer);
            
            document.body.appendChild(overlay);

            
            this.enhanceImageViewer(overlay, largeImg);
            
            // Zjistíme, zda se obrázek načetl v plné velikosti
            largeImg.onload = () => {
                loadingText.textContent = 'Obrázek načten v plné velikosti';
                
                // Přidáme informaci o rozměrech obrázku
                const dimensions = document.createElement('div');
                dimensions.textContent = `${largeImg.naturalWidth} × ${largeImg.naturalHeight} px`;
                dimensions.style.color = 'white';
                dimensions.style.fontSize = '12px';
                dimensions.style.marginTop = '6px';
                dimensions.style.opacity = '0.8';
                contentContainer.insertBefore(dimensions, infoText);
                
                setTimeout(() => {
                    contentContainer.removeChild(loadingText);
                }, 1000);
            };
            
            largeImg.onerror = function() {
                // Pokud se nepodařilo načíst originální verzi, vrátíme se k původní
                largeImg.src = img.src;
                loadingText.textContent = 'Originální velikost není dostupná, používám náhled';
                setTimeout(() => {
                    contentContainer.removeChild(loadingText);
                }, 2000);
            };
            
            // Zavření lightboxu při kliknutí
            overlay.addEventListener('click', () => {
                document.body.removeChild(overlay);
            });
        });
    });
    
    // 4. OPRAVA ROZMĚRŮ - zajistíme, že obrázky v komentářích nebudou deformované
    document.querySelectorAll('.MuiImage-cover img').forEach(img => {
        // Opravíme pouze obrázky v komentářích, které jsou deformované
        if (img.closest('.ltr-164r41r') || img.closest('.ltr-1338aev')) {
            img.style.objectFit = 'contain';
            const container = img.closest('.MuiImage-cover');
            if (container) {
                container.style.height = 'auto';
                container.style.maxHeight = '500px';
            }
        }
    });
    
    if (count > 0 || dialogCount > 0) {
        Utils.logImportant(`Upraveno ${count + dialogCount} obrázků pro lepší zobrazení`);
    }
},

       // Upravená funkce processPosts, která bere v úvahu nastavení highlightingDisabled
processPosts: async function() {
    if (this.state.isDisabled || this.state.isProcessing) return;

    this.state.isProcessing = true;
    Utils.logImportant('--- Začínám cyklus zpracování ---');

    // Pokus o rozbalení veškerého obsahu - pouze pokud není rozbalování vypnuto
    if (!this.state.expandingDisabled) {
        Utils.log('Spouštím rozbalování obsahu...');
        await this.expandContent();
        Utils.log('Rozbalování dokončeno.');
    } else {
        Utils.log('Rozbalování je vypnuto, přeskakuji...');
    }

    
    // Dáme prohlížeči krátký čas na vykreslení nově načtených komentářů
    Utils.log('Čekám krátce na vykreslení obsahu...');
    await new Promise(resolve => setTimeout(resolve, 300));
    

    //Zvýraznění nejnovějších komentářů ve viditelných příspěvcích - pouze pokud není zvýrazňování vypnuto
    if (!this.state.highlightingDisabled) {
        Utils.log('Spouštím zvýrazňování...');
        this.highlightVisiblePosts();
        Utils.log('Zvýrazňování dokončeno.');
    } else {
        Utils.log('Zvýrazňování je vypnuto, přeskakuji...');
    }
    
    //Vylepšení obrázků na plnou velikost
    this.enhanceImages();

    Utils.logImportant('--- Cyklus zpracování dokončen ---');
    this.state.isProcessing = false;
},

// Nová pomocná metoda pro zvýrazňování viditelných příspěvků, 
// aby se tento kód neopakoval
highlightVisiblePosts: function() {
    const visiblePosts = document.querySelectorAll('div[data-eid^="feed.entities.feed."]');
    visiblePosts.forEach(post => {
        const rect = post.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < window.innerHeight) {
            this.highlightNewestInPost(post);
        }
    });
},

       // Přidá rozšířený ovládací panel s více tlačítky a ikonu oka pro přepínání
addToggleControl: function() {
    // --- HLAVNÍ PANEL ---
    const panel = document.createElement('div');
Object.assign(panel.style, {
    position: 'fixed',
    bottom: '120px',
    right: '10px',
    display: 'none', // Začínáme se skrytým panelem
    flexDirection: 'column',
    gap: '8px',
    zIndex: '9999',
    transition: 'opacity 0.3s ease-in-out, transform 0.3s ease-in-out',
    padding: '10px',
    backgroundColor: 'rgba(250, 250, 250, 0.95)',
    borderRadius: '10px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    border: '1px solid rgba(200, 200, 200, 0.5)',
    backdropFilter: 'blur(5px)',
    maxWidth: '280px',
    transform: 'translateY(10px) scale(0.98)', // Přidaná transformace pro počáteční stav
    opacity: '0' // Přidejte také počáteční průhlednost
});
    
    // --- IKONA OKA ---
    const eyeButton = document.createElement('div');
Object.assign(eyeButton.style, {
    position: 'fixed',
    bottom: '80px',
    right: '35px',
    width: '34px',
    height: '34px',
    borderRadius: '50%',
    backgroundColor: 'rgba(240, 240, 240, 0.85)', // Světlejší, decentnější pozadí
    color: '#333', // Tmavé ikony na světlém pozadí
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: '10000',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    transition: 'all 0.2s ease',
    border: '1px solid rgba(200, 200, 200, 0.8)'
});

// SVG ikona oka místo emoji - profesionálnější vzhled
eyeButton.innerHTML = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
</svg>`;

eyeButton.title = 'GB Enhancer - Zobrazit/skrýt ovládací panel';
    
    // Proměnné pro správu stavu a časovače
    let isPanelVisible = false;
    let hideTimeout;
    
    // Funkce pro zobrazení panelu
    const showPanel = () => {
        isPanelVisible = true;
        panel.style.display = 'flex';
        
        // Přidáme malé zpoždění pro animaci
        setTimeout(() => {
            panel.style.opacity = '1';
            panel.style.transform = 'translateY(0) scale(1)';
        }, 10);
        
        // Aktualizujeme vzhled tlačítka
        eyeButton.style.backgroundColor = 'rgba(235, 245, 250, 0.95)';
        eyeButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        eyeButton.style.borderColor = 'rgba(100, 150, 200, 0.8)';
        eyeButton.querySelector('svg').style.stroke = '#2980b9';
        
        // Zrušíme existující timeout
        if (hideTimeout) {
            clearTimeout(hideTimeout);
        }
        
        // Nastavíme nový timeout
        hideTimeout = setTimeout(() => {
            hidePanel();
        }, 30000);
        
        Utils.log('Panel zobrazen');
    };
    
    // Funkce pro skrytí panelu
    const hidePanel = () => {
        isPanelVisible = false;
        panel.style.opacity = '0';
        panel.style.transform = 'translateY(10px) scale(0.98)';
        
        // Přidáme krátké zpoždění pro dokončení animace
        setTimeout(() => {
            panel.style.display = 'none';
        }, 300);
        
        // Vrátíme původní vzhled tlačítka
        eyeButton.style.backgroundColor = 'rgba(240, 240, 240, 0.85)';
        eyeButton.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
        eyeButton.style.borderColor = 'rgba(200, 200, 200, 0.8)';
        eyeButton.querySelector('svg').style.stroke = '#333';
        
        Utils.log('Panel skryt');
    };
    
    // Přidáme efekt při najetí myší pro lepší UX
eyeButton.addEventListener('mouseenter', () => {
    if (!isPanelVisible) {
        eyeButton.style.backgroundColor = 'rgba(245, 245, 245, 0.95)';
        eyeButton.style.boxShadow = '0 2px 4px rgba(0,0,0,0.25)';
        eyeButton.style.borderColor = 'rgba(180, 180, 180, 0.9)';
    }
});

eyeButton.addEventListener('mouseleave', () => {
    if (!isPanelVisible) {
        eyeButton.style.backgroundColor = 'rgba(240, 240, 240, 0.85)';
        eyeButton.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
        eyeButton.style.borderColor = 'rgba(200, 200, 200, 0.8)';
    }
});

    // Přidáme event listener pro kliknutí na ikonu oka
    eyeButton.addEventListener('click', () => {
        if (isPanelVisible) {
            hidePanel();
        } else {
            showPanel();
        }
    });
    
    // Přidáme event listener pro reset časovače při interakci s panelem
    panel.addEventListener('mouseenter', () => {
        if (hideTimeout) {
            clearTimeout(hideTimeout);
        }
    });
    
    panel.addEventListener('mouseleave', () => {
        // Nastavíme časovač pro skrytí po 30 sekundách nečinnosti
        if (isPanelVisible) {
            if (hideTimeout) {
                clearTimeout(hideTimeout);
            }
            hideTimeout = setTimeout(() => {
                hidePanel();
            }, 30000); // 30 sekund
        }
    });
    
    // Funkce pro vytvoření tlačítka
    const createButton = (text, color, onClick, tooltip = '') => {
        const button = document.createElement('div');
        button.textContent = text;
        
        // Modernější design tlačítek
        Object.assign(button.style, {
            backgroundColor: color,
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '500',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            userSelect: 'none',
            transition: 'all 0.2s ease',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            border: '1px solid rgba(255,255,255,0.1)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
        });
        
        if (tooltip) button.title = tooltip;
        
        // Přidáme reset časovače při interakci s tlačítkem
        button.addEventListener('click', () => {
            if (hideTimeout) {
                clearTimeout(hideTimeout);
            }
            hideTimeout = setTimeout(() => {
                hidePanel();
            }, 30000); // 30 sekund
            
            onClick();
        });
        
        // Vylepšené efekty při najetí myší
        button.addEventListener('mouseenter', () => {
            button.style.transform = 'translateY(-1px)';
            button.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
            // Zesvětlit barvu pro lepší efekt
            const lighterColor = color.replace('rgba(', '').replace(')', '').split(',');
            if (lighterColor.length === 4) {
                const r = Math.min(parseInt(lighterColor[0]) + 15, 255);
                const g = Math.min(parseInt(lighterColor[1]) + 15, 255);
                const b = Math.min(parseInt(lighterColor[2]) + 15, 255);
                const a = lighterColor[3];
                button.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${a})`;
            }
        });
        
        button.addEventListener('mouseleave', () => {
            button.style.transform = 'translateY(0)';
            button.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            button.style.backgroundColor = color;
        });
        
        return button;
    };
    
    // Tlačítko pro zapnutí/vypnutí celého skriptu
    const mainToggle = createButton(
        'GB Highlighter: ON', 
        'rgba(56, 62, 48, 0.95)', // Olive drab - vojenská zelená
        () => {
            this.state.isDisabled = !this.state.isDisabled;
            mainToggle.textContent = `GB Highlighter: ${this.state.isDisabled ? 'OFF' : 'ON'}`;
            mainToggle.style.backgroundColor = this.state.isDisabled ? 'rgba(80, 40, 30, 0.95)' : 'rgba(56, 62, 48, 0.95)'; // Tmavě červená při vypnutí
            Utils.logImportant(`Skript ${this.state.isDisabled ? 'vypnut' : 'zapnut'} uživatelem.`);
            
            // Aktualizovat stav ostatních tlačítek
expandToggle.style.opacity = this.state.isDisabled ? '0.5' : '1';
expandToggle.style.pointerEvents = this.state.isDisabled ? 'none' : 'auto';
highlightToggle.style.opacity = this.state.isDisabled ? '0.5' : '1';  
highlightToggle.style.pointerEvents = this.state.isDisabled ? 'none' : 'auto'; 
notifButton.style.opacity = this.state.isDisabled ? '0.5' : '1';
notifButton.style.pointerEvents = this.state.isDisabled ? 'none' : 'auto';
announcementsToggle.style.opacity = this.state.isDisabled ? '0.5' : '1'; // NOVÉ
announcementsToggle.style.pointerEvents = this.state.isDisabled ? 'none' : 'auto'; // NOVÉ
imageEnhanceToggle.style.opacity = this.state.isDisabled ? '0.5' : '1';  
    imageEnhanceToggle.style.pointerEvents = this.state.isDisabled ? 'none' : 'auto';  
            
            if (!this.state.isDisabled) {
                this.processPosts(); // Okamžitě spustit po zapnutí
            } else {
                // Odstranit existující zvýraznění při vypnutí
                document.querySelectorAll('.gb-highlighted-comment').forEach(el => {
                    el.classList.remove('gb-highlighted-comment');
                    el.style.backgroundColor = '';
                    el.style.borderLeft = '';
                    el.style.borderRadius = '';
                });
                document.querySelectorAll('.gb-highlighted-time').forEach(el => {
                    el.classList.remove('gb-highlighted-time');
                    el.style.color = '';
                    el.style.fontWeight = '';
                });
            }
        },
        'Zapnout/vypnout všechny funkce'
    );
    
    // Tlačítko pro zapnutí/vypnutí automatického rozbalování komentářů
    const expandToggle = createButton(
        '🔄 Auto rozbalování: ON', 
        'rgba(42, 55, 70, 0.95)', // Tmavě modrá - navy blue
        () => {
            if (this.state.isDisabled) return;
            this.state.expandingDisabled = !this.state.expandingDisabled;
            expandToggle.textContent = `🔄 Auto rozbalování: ${this.state.expandingDisabled ? 'OFF' : 'ON'}`;
            expandToggle.style.backgroundColor = this.state.expandingDisabled ? 'rgba(80, 40, 30, 0.95)' : 'rgba(42, 55, 70, 0.95)';
            Utils.logImportant(`Automatické rozbalování ${this.state.expandingDisabled ? 'vypnuto' : 'zapnuto'} uživatelem.`);
        },
        'Zapnout/vypnout automatické rozbalování komentářů'
    );

    // Tlačítko pro nastavení barev
    const colorButton = createButton(
        '🎨 Barva zvýraznění', 
        'rgba(45, 80, 100, 0.95)', // Modrá barva pro tlačítko
        () => {
            if (this.state.isDisabled) return;
            
            // Vytvořme overlay s color pickery pro výběr barev
            const colorOverlay = document.createElement('div');
            Object.assign(colorOverlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0,0,0,0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: '10001',
                flexDirection: 'column'
            });
            
            // Vytvoříme kontejner pro color pickers
            const colorContainer = document.createElement('div');
            Object.assign(colorContainer.style, {
                backgroundColor: 'white',
                padding: '20px',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '15px',
                width: '300px'
            });
            
            // Titulek
            const title = document.createElement('h3');
            title.textContent = 'Nastavení barev zvýraznění';
            Object.assign(title.style, {
                margin: '0 0 15px 0',
                textAlign: 'center',
                color: '#333'
            });
            
            // Funkce pro vytvoření jednoho color pickeru
            function createColorPicker(labelText, initialColor, id) {
                const container = document.createElement('div');
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.gap = '5px';
                
                const label = document.createElement('label');
                label.textContent = labelText;
                label.htmlFor = id;
                label.style.fontSize = '14px';
                label.style.fontWeight = 'bold';
                
                const inputRow = document.createElement('div');
                inputRow.style.display = 'flex';
                inputRow.style.alignItems = 'center';
                inputRow.style.gap = '10px';
                
                const colorPreview = document.createElement('div');
                colorPreview.style.width = '30px';
                colorPreview.style.height = '30px';
                colorPreview.style.backgroundColor = initialColor;
                colorPreview.style.border = '1px solid #ccc';
                colorPreview.style.borderRadius = '4px';
                
                const input = document.createElement('input');
                input.type = 'color';
                input.id = id;
                input.value = initialColor;
                Object.assign(input.style, {
                    width: 'calc(100% - 50px)',
                    height: '30px',
                    border: '1px solid #ccc',
                    borderRadius: '4px'
                });
                
                // Aktualizace náhledu při změně barvy
                input.addEventListener('input', () => {
                    colorPreview.style.backgroundColor = input.value;
                });
                
                inputRow.appendChild(colorPreview);
                inputRow.appendChild(input);
                
                container.appendChild(label);
                container.appendChild(inputRow);
                
                return { container, input };
            }
            
            // Extrahujeme barvy z CONFIG
            const currentBgColor = CONFIG.HIGHLIGHT_COLOR;
            const borderColor = CONFIG.HIGHLIGHT_BORDER.split(' ')[2] || '#2ecc71';
            const textColor = CONFIG.HIGHLIGHT_TEXT_COLOR;
            
            // Pro pozadí s transparentností potřebujeme speciální pojetí
            const bgOpacityContainer = document.createElement('div');
            bgOpacityContainer.style.display = 'flex';
            bgOpacityContainer.style.flexDirection = 'column';
            bgOpacityContainer.style.gap = '5px';
            
            const bgLabel = document.createElement('label');
            bgLabel.textContent = 'Barva pozadí';
            bgLabel.style.fontSize = '14px';
            bgLabel.style.fontWeight = 'bold';
            
            const bgInputRow = document.createElement('div');
            bgInputRow.style.display = 'flex';
            bgInputRow.style.alignItems = 'center';
            bgInputRow.style.gap = '10px';
            
            const bgColorPreview = document.createElement('div');
            bgColorPreview.style.width = '30px';
            bgColorPreview.style.height = '30px';
            bgColorPreview.style.backgroundColor = currentBgColor;
            bgColorPreview.style.border = '1px solid #ccc';
            bgColorPreview.style.borderRadius = '4px';
            
            // Extrahování barvy a opacity z rgba
            let bgColorHex = '#2ecc71';
            let bgOpacity = 0.15;
            
            if (currentBgColor.startsWith('rgba')) {
                const parts = currentBgColor.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
                if (parts && parts.length === 5) {
                    const r = parseInt(parts[1]);
                    const g = parseInt(parts[2]);
                    const b = parseInt(parts[3]);
                    bgOpacity = parseFloat(parts[4]);
                    
                    // Převod RGB na HEX
                    bgColorHex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
                }
            }
            
            const bgColorInput = document.createElement('input');
            bgColorInput.type = 'color';
            bgColorInput.value = bgColorHex;
            bgColorInput.style.width = '70%';
            bgColorInput.style.height = '30px';
            
            const opacityInput = document.createElement('input');
            opacityInput.type = 'range';
            opacityInput.min = '0';
            opacityInput.max = '100';
            opacityInput.value = bgOpacity * 100;
            opacityInput.style.width = '100%';
            opacityInput.style.marginTop = '10px';
            
            const opacityLabel = document.createElement('div');
            opacityLabel.textContent = `Průhlednost: ${Math.round(bgOpacity * 100)}%`;
            opacityLabel.style.fontSize = '12px';
            opacityLabel.style.marginTop = '5px';
            
            // Aktualizace náhledu a štítku při změně
            const updateBgPreview = () => {
                const color = bgColorInput.value;
                const opacity = opacityInput.value / 100;
                opacityLabel.textContent = `Průhlednost: ${Math.round(opacity * 100)}%`;
                
                // Konvertujeme hex na rgb pro použití s průhledností
                const r = parseInt(color.substr(1, 2), 16);
                const g = parseInt(color.substr(3, 2), 16);
                const b = parseInt(color.substr(5, 2), 16);
                
                bgColorPreview.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${opacity})`;
            };
            
            bgColorInput.addEventListener('input', updateBgPreview);
            opacityInput.addEventListener('input', updateBgPreview);
            
            bgInputRow.appendChild(bgColorPreview);
            bgInputRow.appendChild(bgColorInput);
            
            bgOpacityContainer.appendChild(bgLabel);
            bgOpacityContainer.appendChild(bgInputRow);
            bgOpacityContainer.appendChild(opacityInput);
            bgOpacityContainer.appendChild(opacityLabel);
            
            // Vytvoření pickerů pro okraj a text
            const borderPicker = createColorPicker('Barva okraje', borderColor, 'border-color');
            const textPicker = createColorPicker('Barva textu', textColor, 'text-color');
            
            // Tlačítka pro uložení a zrušení
            const buttonContainer = document.createElement('div');
            buttonContainer.style.display = 'flex';
            buttonContainer.style.justifyContent = 'space-between';
            buttonContainer.style.marginTop = '15px';
            
            const saveButton = document.createElement('button');
            saveButton.textContent = 'Uložit';
            Object.assign(saveButton.style, {
                padding: '8px 16px',
                backgroundColor: '#2ecc71',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
            });
            
            const cancelButton = document.createElement('button');
            cancelButton.textContent = 'Zrušit';
            Object.assign(cancelButton.style, {
                padding: '8px 16px',
                backgroundColor: '#e74c3c',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
            });
            
            const resetButton = document.createElement('button');
            resetButton.textContent = 'Výchozí';
            Object.assign(resetButton.style, {
                padding: '8px 16px',
                backgroundColor: '#3498db',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
            });
            
            buttonContainer.appendChild(resetButton);
            buttonContainer.appendChild(cancelButton);
            buttonContainer.appendChild(saveButton);
            
            // Akce tlačítek
            saveButton.addEventListener('click', () => {
                // Získání vybraných hodnot
                const color = bgColorInput.value;
                const opacity = opacityInput.value / 100;
                
                // Konvertujeme hex na rgba
                const r = parseInt(color.substr(1, 2), 16);
                const g = parseInt(color.substr(3, 2), 16);
                const b = parseInt(color.substr(5, 2), 16);
                
                const bgColorValue = `rgba(${r}, ${g}, ${b}, ${opacity})`;
                
                // Uložení hodnot
                this.setHighlightColors(
                    bgColorValue,
                    borderPicker.input.value,
                    textPicker.input.value
                );
                
                // Zavření overlay
                document.body.removeChild(colorOverlay);
            });
            
            cancelButton.addEventListener('click', () => {
                document.body.removeChild(colorOverlay);
            });
            
            resetButton.addEventListener('click', () => {
                // Resetování na výchozí hodnoty
                bgColorInput.value = '#2ecc71';
                opacityInput.value = 15;
                borderPicker.input.value = '#2ecc71';
                textPicker.input.value = '#2ecc71';
                
                // Aktualizujeme náhled
                updateBgPreview();
                borderPicker.input.dispatchEvent(new Event('input'));
                textPicker.input.dispatchEvent(new Event('input'));
            });
            
            // Sestavení kontejneru
            colorContainer.appendChild(title);
            colorContainer.appendChild(bgOpacityContainer);
            colorContainer.appendChild(borderPicker.container);
            colorContainer.appendChild(textPicker.container);
            colorContainer.appendChild(buttonContainer);
            
            colorOverlay.appendChild(colorContainer);
            
            // Přidání do stránky
            document.body.appendChild(colorOverlay);
        },
        'Nastavení barev zvýraznění komentářů'
    );
    

   // Upravené tlačítko pro zapnutí/vypnutí zvýrazňování komentářů
   const highlightToggle = createButton(
    '🔍 Zvýrazňování: ON', 
    'rgba(65, 60, 50, 0.95)', // FDE - Flat Dark Earth (písková)
    () => {
        if (this.state.isDisabled) return;
        this.state.highlightingDisabled = !this.state.highlightingDisabled;
        highlightToggle.textContent = `🔍 Zvýrazňování: ${this.state.highlightingDisabled ? 'OFF' : 'ON'}`;
        highlightToggle.style.backgroundColor = this.state.highlightingDisabled ? 'rgba(80, 40, 30, 0.95)' : 'rgba(65, 60, 50, 0.95)';
        Utils.logImportant(`Automatické zvýrazňování ${this.state.highlightingDisabled ? 'vypnuto' : 'zapnuto'} uživatelem.`);
        
        // Pokud jsme právě zapnuli zvýrazňování, spustíme ho hned
        if (!this.state.highlightingDisabled) {
            this.highlightVisiblePosts();
        } else {
            // Odstranit existující zvýraznění při vypnutí
            document.querySelectorAll('.gb-highlighted-comment').forEach(el => {
                el.classList.remove('gb-highlighted-comment');
                el.style.backgroundColor = '';
                el.style.borderLeft = '';
                el.style.borderRadius = '';
            });
            document.querySelectorAll('.gb-highlighted-time').forEach(el => {
                el.classList.remove('gb-highlighted-time');
                el.style.color = '';
                el.style.fontWeight = '';
            });
        }
    },
    'Zapnout/vypnout automatické zvýrazňování nejnovějších komentářů'
);

// Vytvoříme kontejner pro tlačítko zvýrazňování a ozubené kolečko
const highlightButtonContainer = document.createElement('div');
Object.assign(highlightButtonContainer.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '5px', 
    marginBottom: '5px'
});

// Přidání flexu pro tlačítko zvýrazňování
Object.assign(highlightToggle.style, {
    flex: '1',
    marginRight: '0'
});

// Vytvoříme tlačítko palety barev pro nastavení barev
const highlightSettingsButton = document.createElement('div');
Object.assign(highlightSettingsButton.style, {
    backgroundColor: 'rgba(60, 60, 60, 0.9)',
    color: 'white',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '14px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    transition: 'background-color 0.2s, transform 0.2s',
    marginLeft: '2px'
});

highlightSettingsButton.innerHTML = '🎨'; // Emoji palety barev
highlightSettingsButton.title = 'Nastavení barev zvýraznění';

// Efekty při najetí myší na tlačítko nastavení barev
highlightSettingsButton.addEventListener('mouseenter', () => {
    highlightSettingsButton.style.backgroundColor = 'rgba(80, 80, 80, 0.9)';
    highlightSettingsButton.style.transform = 'scale(1.1)';
});

highlightSettingsButton.addEventListener('mouseleave', () => {
    highlightSettingsButton.style.backgroundColor = 'rgba(60, 60, 60, 0.9)';
    highlightSettingsButton.style.transform = 'scale(1)';
});

// Kliknutí na tlačítko nastavení otevře dialog
highlightSettingsButton.addEventListener('click', () => {
    if (this.state.isDisabled) return;
    colorButton.dispatchEvent(new Event('click'));
    
    // Reset časovače pro skrytí panelu
    if (hideTimeout) {
        clearTimeout(hideTimeout);
    }
    hideTimeout = setTimeout(() => {
        hidePanel();
    }, 30000);
});

// Přidáme obě tlačítka do kontejneru
highlightButtonContainer.appendChild(highlightToggle);
highlightButtonContainer.appendChild(highlightSettingsButton);
    
    // Vytvoříme kontejner pro tlačítko a ozubené kolečko
const notifButtonContainer = document.createElement('div');
Object.assign(notifButtonContainer.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '5px', 
    marginBottom: '5px'
});

const notifButton = createButton(
    '🔕 Skrývání notifikací: ON', 
    'rgba(70, 50, 40, 0.95)', // Hnědá - wood finish
    () => {
        if (this.state.isDisabled) return;
        
        // Běžný klik - přepne stav
        this.state.notificationsHidingDisabled = !this.state.notificationsHidingDisabled;
        
        // Aktualizujeme text a barvu tlačítka
        notifButton.textContent = `🔕 Skrývání notifikací: ${this.state.notificationsHidingDisabled ? 'OFF' : 'ON'}`;
        notifButton.style.backgroundColor = this.state.notificationsHidingDisabled ? 'rgba(80, 40, 30, 0.95)' : 'rgba(70, 50, 40, 0.95)';
        
        Utils.logImportant(`Automatické skrývání notifikací ${this.state.notificationsHidingDisabled ? 'vypnuto' : 'zapnuto'} uživatelem.`);
        
        // Pokud jsme právě zapnuli skrývání, spustíme ho hned
        if (!this.state.notificationsHidingDisabled) {
            this.hideUnwantedNotifications();
        }
    },
    'Zapnout/vypnout automatické skrývání nežádoucích notifikací'
);

// Přidání flexu pro tlačítko notifikací
Object.assign(notifButton.style, {
    flex: '1',
    marginRight: '0'
});

// Vytvoříme tlačítko ozubeného kolečka pro nastavení
const notifSettingsButton = document.createElement('div');
Object.assign(notifSettingsButton.style, {
    backgroundColor: 'rgba(60, 60, 60, 0.9)',
    color: 'white',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '14px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    transition: 'background-color 0.2s, transform 0.2s',
    marginLeft: '2px'
});

notifSettingsButton.innerHTML = '⚙️'; // Emoji ozubeného kolečka
notifSettingsButton.title = 'Nastavení filtrů notifikací';

// Efekty při najetí myší na tlačítko nastavení
notifSettingsButton.addEventListener('mouseenter', () => {
    notifSettingsButton.style.backgroundColor = 'rgba(80, 80, 80, 0.9)';
    notifSettingsButton.style.transform = 'scale(1.1)';
});

notifSettingsButton.addEventListener('mouseleave', () => {
    notifSettingsButton.style.backgroundColor = 'rgba(60, 60, 60, 0.9)';
    notifSettingsButton.style.transform = 'scale(1)';
});

// Kliknutí na tlačítko nastavení otevře dialog
notifSettingsButton.addEventListener('click', () => {
    if (this.state.isDisabled) return;
    this.openNotificationFilterSettings();
    
    // Reset časovače pro skrytí panelu, stejně jako u jiných tlačítek
    if (hideTimeout) {
        clearTimeout(hideTimeout);
    }
    hideTimeout = setTimeout(() => {
        hidePanel();
    }, 30000);
});

// Přidáme obě tlačítka do kontejneru
notifButtonContainer.appendChild(notifButton);
notifButtonContainer.appendChild(notifSettingsButton);


// Nové tlačítko pro zapnutí/vypnutí vylepšení obrázků
const imageEnhanceToggle = createButton(
    '🖼️ Vylepšení obrázků: ON', 
    'rgba(60, 60, 65, 0.95)', // Gunmetal šedá
    () => {
        if (this.state.isDisabled) return;
        // Přepneme stav
        this.state.imageEnhancementDisabled = !this.state.imageEnhancementDisabled;
        
        // Aktualizujeme text a barvu tlačítka
        imageEnhanceToggle.textContent = `🖼️ Vylepšení obrázků: ${this.state.imageEnhancementDisabled ? 'OFF' : 'ON'}`;
        imageEnhanceToggle.style.backgroundColor = this.state.imageEnhancementDisabled ? 'rgba(80, 40, 30, 0.95)' : 'rgba(60, 60, 65, 0.95)';
        
        Utils.logImportant(`Vylepšení obrázků ${this.state.imageEnhancementDisabled ? 'vypnuto' : 'zapnuto'} uživatelem.`);
        
        // Pokud jsme právě vypnuli vylepšení, mohli bychom případně obnovit původní zobrazení obrázků
        // To by však vyžadovalo sledování všech upravených obrázků a jejich obnovení
    },
    'Zapnout/vypnout automatické vylepšení zobrazení obrázků'
);

// Nové tlačítko pro zapnutí/vypnutí skrývání oznámení administrátorů
const announcementsToggle = createButton(
    '📢 Skrývání oznámení: ON', 
    'rgba(75, 55, 40, 0.95)', // Trochu odlišná hnědá od notifikací
    () => {
        if (this.state.isDisabled) return;
        // Přepneme stav
        this.state.announcementsHidingDisabled = !this.state.announcementsHidingDisabled;
        
        // Aktualizujeme text a barvu tlačítka
        announcementsToggle.textContent = `📢 Skrývání oznámení: ${this.state.announcementsHidingDisabled ? 'OFF' : 'ON'}`;
        announcementsToggle.style.backgroundColor = this.state.announcementsHidingDisabled ? 'rgba(80, 40, 30, 0.95)' : 'rgba(75, 55, 40, 0.95)';
        
        Utils.logImportant(`Automatické skrývání oznámení ${this.state.announcementsHidingDisabled ? 'vypnuto' : 'zapnuto'} uživatelem.`);
        
        // Pokud jsme právě zapnuli skrývání, spustíme ho hned
        if (!this.state.announcementsHidingDisabled) {
            this.hideAdminAnnouncements();
        } else {
            // Pokud jsme vypnuli, obnovíme zobrazení oznámení
            document.querySelectorAll('[data-testid="blockAnnouncementListing"]').forEach(el => {
                if (el.style.display === 'none') {
                    el.style.display = '';
                }
            });
        }
    },
    'Zapnout/vypnout automatické skrývání oznámení administrátorů'
);
// Tlačítko pro zapnutí/vypnutí debug režimu
const debugToggle = createButton(
    '🐛 Debug: OFF',
    'rgba(40, 40, 40, 0.95)', // Taktická černá pro vypnutý stav
    () => {
        // Přepneme obě hodnoty najednou
        CONFIG.DEBUG = !CONFIG.DEBUG;
        CONFIG.IMPORTANT_LOGS = !CONFIG.IMPORTANT_LOGS;
        
        // Aktualizujeme text a barvu tlačítka
        debugToggle.textContent = `🐛 Debug: ${CONFIG.DEBUG ? 'ON' : 'OFF'}`;
        debugToggle.style.backgroundColor = CONFIG.DEBUG ? 'rgba(70, 35, 35, 0.95)' : 'rgba(40, 40, 40, 0.95)'; // Tmavě červená při zapnutí
        
        if (CONFIG.IMPORTANT_LOGS) {
            Utils.logImportant(`Debug režim ${CONFIG.DEBUG ? 'zapnut' : 'vypnut'} uživatelem.`);
        }
    },
    'Zapnout/vypnout veškeré výpisy do konzole'
);

// Vylepšený slogan se solidním bílým pozadím
const sloganLink = document.createElement('a');
sloganLink.href = 'https://www.reloading-tracker.cz';
sloganLink.target = '_blank';
sloganLink.textContent = 'Sparked by Reloading Tracker';
Object.assign(sloganLink.style, {
    color: '#444',
    textDecoration: 'none',
    fontSize: '12px',
    fontWeight: '600',
    textAlign: 'center',
    padding: '4px 0',
    marginBottom: '6px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    display: 'block',
    letterSpacing: '0.3px',
    borderBottom: '1px solid rgba(0,0,0,0.1)',
    paddingBottom: '8px'
});

// Efekty při najetí myší - subtilnější
sloganLink.addEventListener('mouseenter', () => {
    sloganLink.style.color = '#2980b9';
});

sloganLink.addEventListener('mouseleave', () => {
    sloganLink.style.color = '#444';
});

// Přidáme odkaz před ostatní tlačítka
panel.appendChild(sloganLink);
    
  // Přidání všech tlačítek do panelu
panel.appendChild(mainToggle);
panel.appendChild(expandToggle);
panel.appendChild(highlightButtonContainer); 
panel.appendChild(notifButtonContainer);
panel.appendChild(announcementsToggle); 
panel.appendChild(imageEnhanceToggle);  // NOVÉ tlačítko
panel.appendChild(debugToggle);
    
    // Přidání panelu a ikony oka do stránky
    document.body.appendChild(panel);
    document.body.appendChild(eyeButton);
    
    Utils.logImportant('Ovládací panel s ikonou oka přidán');
},
        // Inicializace
        init: function() {
            Utils.logImportant('GunsBook Simple Highlighter se inicializuje...');
            this.addToggleControl();
            this.addLogoRefreshBehavior();
            // Debounced verze hlavní funkce
            const debouncedProcess = Utils.debounce(this.processPosts.bind(this), CONFIG.SCROLL_DEBOUNCE);
        
            // Spustit při scrollování
            window.addEventListener('scroll', debouncedProcess, { passive: true });

            let scrollExpandTimeout;
window.addEventListener('scroll', () => {
    if (scrollExpandTimeout) {
        clearTimeout(scrollExpandTimeout);
    }
    
    scrollExpandTimeout = setTimeout(() => {
        if (!this.state.isDisabled && !this.state.expandingDisabled) {
            // Najdeme tlačítka k rozbalení ve viditelném prostoru a rovnou klikneme
            this.expandContent();
        }
    }, 150);
}, { passive: true });
        
            // Spustit periodicky
            setInterval(() => this.processPosts(), CONFIG.CHECK_INTERVAL);
            
            // Pravidelná kontrola a skrytí nežádoucích notifikací
            setInterval(() => {
              if (!this.state.isDisabled && !this.state.notificationsHidingDisabled) {
                  this.hideUnwantedNotifications();
              }
            }, 2000);
            
            // PŘIDAT ZDE - První část kódu
            // Pravidelná kontrola a skrytí oznámení administrátorů
            setInterval(() => {
                if (!this.state.isDisabled && !this.state.announcementsHidingDisabled) {
                    this.hideAdminAnnouncements();
                }
            }, 2000);
            
            // Pravidelná kontrola a vylepšení obrázků na plnou velikost
            setInterval(() => this.enhanceImages(), 1000);
            
            // MutationObserver pro sledování změn v DOM, zejména otevření dialogů s obrázky
            const throttledEnhanceImages = Utils.throttle(this.enhanceImages.bind(this), 200);
const observer = new MutationObserver((mutations) => {
    if (mutations.some(m => m.addedNodes.length > 0)) {
        throttledEnhanceImages();
    }
});
            
            // Sledujeme změny v celém dokumentu - zejména přidávání dialogů a nových komentářů
            observer.observe(document.body, { 
                childList: true,
                subtree: true 
            });
        
            // První spuštění po načtení
            setTimeout(() => this.processPosts(), 1500); // Dáme stránce chvilku na donačtení
            
            // Spustíme kontrolu notifikací ihned po načtení - pouze pokud není vypnuta
            setTimeout(() => {
                if (!this.state.notificationsHidingDisabled) {
                    this.hideUnwantedNotifications();
                }
            }, 1000);
            
            // Spustíme vylepšení obrázků ihned po načtení
            setTimeout(() => this.enhanceImages(), 1200);
        
            // PŘIDAT ZDE - Druhá část kódu
            // A také okamžitá kontrola oznámení při načtení stránky
setTimeout(() => {
    if (!this.state.announcementsHidingDisabled) {
        this.hideAdminAnnouncements();
    }
}, 1000);
        
            Utils.logImportant('Inicializace dokončena.');
        }
    };

    // --- Spuštění Skriptu ---
    Highlighter.init();

})();
