// ==UserScript==
// @name         GunsBook Simple Highlighter
// @namespace    http://tampermonkey.net/
// @version      5.0 Simplified
// @description  Rozbalí příspěvky/komentáře a zvýrazní nejnovější komentář.
// @author       Redsnake
// @match        https://gunsbook.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- Konfigurace ---
   
const CONFIG = {
    CHECK_INTERVAL: 3000,           // Interval pro kontrolu a zvýraznění (ms)
    SCROLL_DEBOUNCE: 500,           // Čekání po doskrolování (ms)
    MAX_EXPAND_ITERATIONS: 5,       // Max pokusů o rozbalení v jednom cyklu
    EXPAND_DELAY: 750,              // Pauza mezi kliknutími na rozbalení (ms)
    HIGHLIGHT_COLOR: 'rgba(46, 204, 113, 0.15)',
    HIGHLIGHT_BORDER: '3px solid #2ecc71',
    HIGHLIGHT_TEXT_COLOR: '#2ecc71',
    DEBUG: false,                   // Pro běžné debug výpisy - výchozí stav vypnuto
    IMPORTANT_LOGS: false           // Pro důležité výpisy - výchozí stav vypnuto
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
        parseTimeToMs: (timeText) => {
            if (!timeText) return Infinity;
            timeText = timeText.toLowerCase();
            
            // Speciální případ pro "právě teď"
            if (timeText.includes('just now')) return 0;
            
            // Získáme celé číslo pomocí regulárního výrazu
            const match = timeText.match(/(\d+)/);
            const value = match ? parseInt(match[0]) : 1;
            
            // Výpočet milisekund podle jednotky času
            if (timeText.includes('second')) return value * 1000;
            if (timeText.includes('minute')) return value * 60 * 1000;
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
        imageEnhancementDisabled: false  //stav pro zapnutí/vypnutí vylepšení obrázků

},
        
        

// Vylepšená funkce pro skrytí nežádoucích notifikací s přesnějšími kritérii
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
            
            // PŘESNÁ kritéria pro skrytí:
            // 1. "posted in" - někdo přidal příspěvek do skupiny (SKRÝT)
            // 2. "new member" - oznámení o novém členovi (SKRÝT)
            // ALE nezahrnuje "reacted to your post in" - reakce na váš příspěvek (PONECHAT)
            
            if ((text.includes('posted in') && !text.includes('reacted to your post in')) || 
                text.includes('new member')) {
                notification.style.display = 'none';
                skrytePocet++;
            }
        }
    });
    
    // Logujeme pouze pokud jsme něco skryli
    if (skrytePocet > 0) {
        Utils.logImportant(`Skryto ${skrytePocet} notifikací "posted in..." nebo "new member"`);
    }
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
            
            // Sbíráme všechny časové údaje nehledě na strukturu
            let allTimeSpans = [];
            
            // Najdeme VŠECHNY span elementy s časovým údajem - bez ohledu na úroveň zanoření
            post.querySelectorAll('span[role="link"]').forEach(span => {
                const text = span.textContent.trim();
                
                // Detekce časového údaje pomocí regex
                if (text.match(/\d+\s*(second|minute|hour|day|week|month|year|just now)/i)) {
                    const timeMs = Utils.parseTimeToMs(text);
                    
                    // Uložíme si všechny potřebné informace
                    allTimeSpans.push({
                        span: span,
                        text: text,
                        timeMs: timeMs
                    });
                }
            });
            
            // Pokud jsme našli časové údaje
            if (allTimeSpans.length > 0) {
                // Seřadíme od nejnovějšího (nejmenší čas)
                allTimeSpans.sort((a, b) => a.timeMs - b.timeMs);
                
                // Nejnovější časový údaj
                const newestTimeSpan = allTimeSpans[0].span;
                const newestTime = allTimeSpans[0].text;
                
                Utils.logImportant(`Nalezen nejnovější čas: ${newestTime}, ms: ${allTimeSpans[0].timeMs}`);
                
                // Zvýrazníme čas
                newestTimeSpan.classList.add('gb-highlighted-time');
                newestTimeSpan.style.color = CONFIG.HIGHLIGHT_TEXT_COLOR;
                newestTimeSpan.style.fontWeight = 'bold';
                
                // ALGORITMUS PRO NALEZENÍ KOMENTÁŘE K ZVÝRAZNĚNÍ
                // Začneme od časového span elementu a postupujeme nahoru k obsahu komentáře
                
                // 1. Najdeme nejbližší kontejner komentáře
                const commentContainer = newestTimeSpan.closest('[data-testid="comment"]');
                
                if (commentContainer) {
                    // 2. Zkusíme nalézt obsah komentáře - postupujeme od konkrétnějších k obecnějším
                    let contentToHighlight = null;
                    
                    // Priority pořadí pro nalezení správného obsahu
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
                    
                    // Zvýrazníme obsah komentáře
                    contentToHighlight.classList.add('gb-highlighted-comment');
                    contentToHighlight.style.backgroundColor = CONFIG.HIGHLIGHT_COLOR;
                    contentToHighlight.style.borderLeft = CONFIG.HIGHLIGHT_BORDER;
                    contentToHighlight.style.borderRadius = '8px';
                    
                    // Pokud zdůraznění není na první pohled viditelné, zkusíme zvýraznit také nadřazený element
                    if (contentToHighlight.offsetWidth < 50 || contentToHighlight.offsetHeight < 30) {
                        const parentElement = contentToHighlight.parentElement;
                        if (parentElement) {
                            parentElement.classList.add('gb-highlighted-comment');
                            parentElement.style.backgroundColor = CONFIG.HIGHLIGHT_COLOR;
                            parentElement.style.borderLeft = CONFIG.HIGHLIGHT_BORDER;
                            parentElement.style.borderRadius = '8px';
                            Utils.logImportant('Zvýrazňuji také nadřazený element pro lepší viditelnost');
                        }
                    }

                    // Přidejme logování DOM cesty pro diagnostiku
                    Utils.logImportant(`DOM cesta zvýrazněného elementu: ${this.getDomPath(contentToHighlight)}`);
                } else {
                    Utils.logImportant('Nenalezen kontejner komentáře');
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

        // Vložte tuto funkci jako metodu Highlighter objektu (před nebo po metodě getDomPath)

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
            
            // Zjistíme, zda se obrázek načetl v plné velikosti
            largeImg.onload = function() {
                loadingText.textContent = 'Obrázek načten v plné velikosti';
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
        gap: '5px',
        zIndex: '9999',
        transition: 'opacity 0.3s ease-in-out'
    });
    
    // --- IKONA OKA ---
    const eyeButton = document.createElement('div');
    Object.assign(eyeButton.style, {
        position: 'fixed',
        bottom: '80px',
        right: '10px',
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        backgroundColor: 'rgba(46, 204, 113, 0.8)',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: '10000',
        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
        transition: 'transform 0.2s, background-color 0.2s',
        fontSize: '18px'
    });
    eyeButton.innerHTML = '👁️'; // Emoji oka
    eyeButton.title = 'Zobrazit/skrýt ovládací panel';
    
    // Proměnné pro správu stavu a časovače
    let isPanelVisible = false;
    let hideTimeout;
    
    // Funkce pro zobrazení panelu
    const showPanel = () => {
        isPanelVisible = true;
        panel.style.display = 'flex';
        panel.style.opacity = '1';
        eyeButton.style.backgroundColor = 'rgba(46, 204, 113, 1)';
        eyeButton.style.transform = 'scale(1.1)';
        
        // Zrušíme existující timeout, pokud existuje
        if (hideTimeout) {
            clearTimeout(hideTimeout);
        }
        
        // Nastavíme nový timeout pro skrytí po 30 sekundách nečinnosti
        hideTimeout = setTimeout(() => {
            hidePanel();
        }, 30000); // 30 sekund
        
        Utils.log('Panel zobrazen');
    };
    
    // Funkce pro skrytí panelu
    const hidePanel = () => {
        isPanelVisible = false;
        panel.style.opacity = '0';
        
        // Přidáme krátké zpoždění, aby byla vidět animace
        setTimeout(() => {
            panel.style.display = 'none';
        }, 300); // 300ms pro dokončení animace
        
        eyeButton.style.backgroundColor = 'rgba(46, 204, 113, 0.8)';
        eyeButton.style.transform = 'scale(1)';
        
        Utils.log('Panel skryt');
    };
    
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
        Object.assign(button.style, {
            backgroundColor: color,
            color: 'white',
            padding: '5px 10px',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '12px',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            userSelect: 'none',
            transition: 'background-color 0.2s, box-shadow 0.2s',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
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
        
        // Efekty při najetí myší
        button.addEventListener('mouseenter', () => {
            button.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
        });
        button.addEventListener('mouseleave', () => {
            button.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        });
        
        return button;
    };
    
    // Tlačítko pro zapnutí/vypnutí celého skriptu
    const mainToggle = createButton(
        'GB Highlighter: ON', 
        'rgba(46, 204, 113, 0.8)',
        () => {
            this.state.isDisabled = !this.state.isDisabled;
            mainToggle.textContent = `GB Highlighter: ${this.state.isDisabled ? 'OFF' : 'ON'}`;
            mainToggle.style.backgroundColor = this.state.isDisabled ? 'rgba(231, 76, 60, 0.8)' : 'rgba(46, 204, 113, 0.8)';
            Utils.logImportant(`Skript ${this.state.isDisabled ? 'vypnut' : 'zapnut'} uživatelem.`);
            
            // Aktualizovat stav ostatních tlačítek
expandToggle.style.opacity = this.state.isDisabled ? '0.5' : '1';
expandToggle.style.pointerEvents = this.state.isDisabled ? 'none' : 'auto';
highlightToggle.style.opacity = this.state.isDisabled ? '0.5' : '1';  
highlightToggle.style.pointerEvents = this.state.isDisabled ? 'none' : 'auto'; 
notifButton.style.opacity = this.state.isDisabled ? '0.5' : '1';
notifButton.style.pointerEvents = this.state.isDisabled ? 'none' : 'auto';
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
        'rgba(52, 152, 219, 0.8)',
        () => {
            if (this.state.isDisabled) return;
            this.state.expandingDisabled = !this.state.expandingDisabled;
            expandToggle.textContent = `🔄 Auto rozbalování: ${this.state.expandingDisabled ? 'OFF' : 'ON'}`;
            expandToggle.style.backgroundColor = this.state.expandingDisabled ? 'rgba(231, 76, 60, 0.8)' : 'rgba(52, 152, 219, 0.8)';
            Utils.logImportant(`Automatické rozbalování ${this.state.expandingDisabled ? 'vypnuto' : 'zapnuto'} uživatelem.`);
        },
        'Zapnout/vypnout automatické rozbalování komentářů'
    );
    
   // Upravené tlačítko pro zapnutí/vypnutí zvýrazňování komentářů
const highlightToggle = createButton(
    '🔍 Zvýrazňování: ON', 
    'rgba(155, 89, 182, 0.8)',
    () => {
        if (this.state.isDisabled) return;
        this.state.highlightingDisabled = !this.state.highlightingDisabled;
        highlightToggle.textContent = `🔍 Zvýrazňování: ${this.state.highlightingDisabled ? 'OFF' : 'ON'}`;
        highlightToggle.style.backgroundColor = this.state.highlightingDisabled ? 'rgba(231, 76, 60, 0.8)' : 'rgba(155, 89, 182, 0.8)';
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
    
    // Přepracované tlačítko pro zapnutí/vypnutí skrývání notifikací
const notifButton = createButton(
    '🔕 Skrývání notifikací: ON', 
    'rgba(243, 156, 18, 0.8)',
    () => {
        if (this.state.isDisabled) return;
        // Přepneme stav
        this.state.notificationsHidingDisabled = !this.state.notificationsHidingDisabled;
        
        // Aktualizujeme text a barvu tlačítka
        notifButton.textContent = `🔕 Skrývání notifikací: ${this.state.notificationsHidingDisabled ? 'OFF' : 'ON'}`;
        notifButton.style.backgroundColor = this.state.notificationsHidingDisabled ? 'rgba(231, 76, 60, 0.8)' : 'rgba(243, 156, 18, 0.8)';
        
        Utils.logImportant(`Automatické skrývání notifikací ${this.state.notificationsHidingDisabled ? 'vypnuto' : 'zapnuto'} uživatelem.`);
        
        // Pokud jsme právě zapnuli skrývání, spustíme ho hned
        if (!this.state.notificationsHidingDisabled) {
            this.hideUnwantedNotifications();
        } else {
            // Pokud jsme vypnuli, lze případně obnovit skryté notifikace
            // Tuto část můžeme přeskočit, protože obnovení skrytých notifikací
            // by mohlo vést k zahlcení uživatele
        }
    },
    'Zapnout/vypnout automatické skrývání nežádoucích notifikací'
);


// Nové tlačítko pro zapnutí/vypnutí vylepšení obrázků
const imageEnhanceToggle = createButton(
    '🖼️ Vylepšení obrázků: ON', 
    'rgba(236, 64, 122, 0.8)',
    () => {
        if (this.state.isDisabled) return;
        // Přepneme stav
        this.state.imageEnhancementDisabled = !this.state.imageEnhancementDisabled;
        
        // Aktualizujeme text a barvu tlačítka
        imageEnhanceToggle.textContent = `🖼️ Vylepšení obrázků: ${this.state.imageEnhancementDisabled ? 'OFF' : 'ON'}`;
        imageEnhanceToggle.style.backgroundColor = this.state.imageEnhancementDisabled ? 'rgba(231, 76, 60, 0.8)' : 'rgba(236, 64, 122, 0.8)';
        
        Utils.logImportant(`Vylepšení obrázků ${this.state.imageEnhancementDisabled ? 'vypnuto' : 'zapnuto'} uživatelem.`);
        
        // Pokud jsme právě vypnuli vylepšení, mohli bychom případně obnovit původní zobrazení obrázků
        // To by však vyžadovalo sledování všech upravených obrázků a jejich obnovení
    },
    'Zapnout/vypnout automatické vylepšení zobrazení obrázků'
);


// Tlačítko pro zapnutí/vypnutí debug režimu
const debugToggle = createButton(
    '🐛 Debug: OFF',  // Změněno z "ON" na "OFF" aby odpovídalo výchozímu nastavení
    'rgba(231, 76, 60, 0.8)',  // Změněno na červenou barvu pro výchozí stav vypnuto
    () => {
        // Přepneme obě hodnoty najednou
        CONFIG.DEBUG = !CONFIG.DEBUG;
        CONFIG.IMPORTANT_LOGS = !CONFIG.IMPORTANT_LOGS;
        
        // Aktualizujeme text a barvu tlačítka
        debugToggle.textContent = `🐛 Debug: ${CONFIG.DEBUG ? 'ON' : 'OFF'}`;
        debugToggle.style.backgroundColor = CONFIG.DEBUG ? 'rgba(41, 128, 185, 0.8)' : 'rgba(231, 76, 60, 0.8)';
        
        if (CONFIG.IMPORTANT_LOGS) {
            Utils.logImportant(`Debug režim ${CONFIG.DEBUG ? 'zapnut' : 'vypnut'} uživatelem.`);
        }
    },
    'Zapnout/vypnout veškeré výpisy do konzole'
);

// Vylepšený slogan se solidním bílým pozadím
const sloganLink = document.createElement('a');
sloganLink.href = 'https://www.reloading-tracker.cz';
sloganLink.target = '_blank'; // Otevírá odkaz v novém okně/záložce
sloganLink.textContent = 'Sparked by Reloading tracker and gunpowder';
Object.assign(sloganLink.style, {
    color: '#2ecc71', // Výrazná zelená barva
    textDecoration: 'none',
    fontSize: '14px', // Větší velikost písma
    fontWeight: 'bold',
    textAlign: 'center',
    padding: '8px',
    marginBottom: '8px',
    textShadow: '1px 1px 3px rgba(0, 0, 0, 0.4)', // Lehčí stín pro bílé pozadí
    fontFamily: '"Trebuchet MS", Arial, sans-serif',
    display: 'block',
    opacity: '1', // Plná viditelnost
    transition: 'all 0.3s ease',
    backgroundColor: '#ffffff', // Solidní bílé pozadí
    borderRadius: '5px',
    border: '1px solid #2ecc71', // Zelený rámeček pro lepší kontrast
    boxShadow: '0 2px 4px rgba(0,0,0,0.15)' // Lehký stín pro 3D efekt
});

// Efekty při najetí myší - výraznější
sloganLink.addEventListener('mouseenter', () => {
    sloganLink.style.color = '#27ae60'; // Tmavší zelená při najetí
    sloganLink.style.transform = 'scale(1.05)';
    sloganLink.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)'; // Výraznější stín
    sloganLink.style.borderColor = '#27ae60'; // Tmavší zelený rámeček
});

sloganLink.addEventListener('mouseleave', () => {
    sloganLink.style.color = '#2ecc71';
    sloganLink.style.transform = 'scale(1)';
    sloganLink.style.boxShadow = '0 2px 4px rgba(0,0,0,0.15)';
    sloganLink.style.borderColor = '#2ecc71';
});

// Přidáme odkaz před ostatní tlačítka
panel.appendChild(sloganLink);
    
  // Přidání všech tlačítek do panelu
panel.appendChild(mainToggle);
panel.appendChild(expandToggle);
panel.appendChild(highlightToggle); 
panel.appendChild(notifButton);
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

    // Debounced verze hlavní funkce
    const debouncedProcess = Utils.debounce(this.processPosts.bind(this), CONFIG.SCROLL_DEBOUNCE);

    // Spustit při scrollování
    window.addEventListener('scroll', debouncedProcess, { passive: true });

    // Spustit periodicky
    setInterval(() => this.processPosts(), CONFIG.CHECK_INTERVAL);
    
    // Pravidelná kontrola a skrytí nežádoucích notifikací
    setInterval(() => {
    if (!this.state.isDisabled && !this.state.notificationsHidingDisabled) {
        this.hideUnwantedNotifications();
    }
}, 2000);
    
    // Pravidelná kontrola a vylepšení obrázků na plnou velikost
    setInterval(() => this.enhanceImages(), 1000);
    
    // MutationObserver pro sledování změn v DOM, zejména otevření dialogů s obrázky
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                setTimeout(() => this.enhanceImages(), 100); // Reagujeme na změny DOM s malou prodlevou
            }
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

    Utils.logImportant('Inicializace dokončena.');
}
    };

    // --- Spuštění Skriptu ---
    Highlighter.init();

})();