const dotenvResult = require('dotenv').config();
if (dotenvResult.error) {
    console.error('[ERROR] File .env non trovato o non leggibile.');
}

const express = require('express');
const app = express();

// Serve file statici dalla cartella public (client html/js)
app.use(express.static('public'));

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Percorso file di persistenza dei job
const JOBS_FILE = path.join(__dirname, 'jobs.json');

// Salva jobs su disco (async)
const saveJobsToDisk = async () => {
    try {
        const plain = Array.from(jobs.entries()).map(([id, job]) => {
            // non serializziamo riferimenti non serializzabili come page/browser
            const copy = Object.assign({}, job);
            delete copy.page;
            return [id, copy];
        });
        await fs.promises.writeFile(JOBS_FILE, JSON.stringify(Object.fromEntries(plain), null, 2), 'utf8');
    } catch (e) {
        console.warn('[WARN] Impossibile salvare jobs su disco:', e);
    }
};

// Carica jobs da disco (sincrono all'avvio)
const loadJobsFromDisk = () => {
    try {
        if (!fs.existsSync(JOBS_FILE)) return;
        const content = fs.readFileSync(JOBS_FILE, 'utf8');
        const obj = JSON.parse(content || '{}');
        for (const [id, job] of Object.entries(obj)) {
            jobs.set(id, job);
        }
        console.log('[LOG] Jobs caricati da disco:', jobs.size);
    } catch (e) {
        console.warn('[WARN] Impossibile caricare jobs da disco:', e);
    }
};

//funzioni per il progetto
const avvioBrowser = async () => {
    try {
        console.log("[LOG] Avvio browser...");
        const browser = await puppeteer.launch({headless: false});
        const page = await browser.newPage();
        console.log("[LOG] Browser avviato...");
        return { browser, page };
    } catch (e) {
        console.error("[ERROR] Errore avvio browser: ", e);
        throw new Error("Errore avvio browser " + e);
    }

}

const acconsentiCookie = async (page) => {
    try {
        // Esegui nel contesto della pagina: cerca e clicca il pulsante cookie
        const result = await page.evaluate(() => {
            const texts = [
                'Consenti tutti i cookie'
            ];
            let found = false;
            const buttons = Array.from(document.querySelectorAll('button'));
            for (const btn of buttons) {
                if (btn && btn.innerText) {
                    for (const txt of texts) {
                        if (btn.innerText.trim().includes(txt)) {
                            btn.click();
                            found = true;
                            return true;
                        }
                    }
                }
            }
            return false;
        });
        if (result) {
            console.log('[LOG] Cookie: pulsante acconsento cliccato.');
            return true;
        } else {
            console.log('[LOG] Nessun banner cookie trovato.');
            return false;
        }
    } catch (e) {
        console.log('[ERROR] Errore nel cliccare il consenso cookie:', e);
        // Non rilanciamo: gestiamo l'assenza del pulsante e proseguiamo
        return false;
    }
}

const login = async (page) => {
    const {USERNAME, PASSWORD} = process.env;
    if (!USERNAME || !PASSWORD) {
        throw new Error("USERNAME o PASSWORD non definiti nelle variabili d'ambiente.");
    }
    try {
        console.log("[LOG] Effettuo login...");
        await page.goto('https://www.instagram.com/accounts/login/', {waitUntil: 'networkidle2'});
        await acconsentiCookie(page); // <-- Clicca su acconsento ai cookie se presente
        await page.waitForSelector('input[name="username"]');
        await page.type('input[name="username"]', USERNAME);
        await page.type('input[name="password"]', PASSWORD);
        // Cerca e clicca il pulsante "Accedi" tramite page.evaluate
        const accediClicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            for (const btn of buttons) {
                if (btn && btn.innerText && btn.innerText.trim().includes('Accedi')) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });
        if (accediClicked) {
            console.log('[LOG] Pulsante Accedi cliccato.');
        } else {
            throw new Error("Pulsante Accedi non trovato!");
        }
        await page.waitForNavigation({waitUntil: 'networkidle2'});
        console.log("[LOG] Login effettuato...");
    } catch (e) {
        console.error("[ERROR] Errore login: ", e);
        throw e;
    }
}
const goToLikePage = async (page) => {
    try {
        console.log("[LOG] Accedo alla pagina dei like...");
        await page.goto('https://www.instagram.com/your_activity/interactions/likes/', { waitUntil: 'networkidle2' });
        await page.waitForFunction(
            () => {
                const spans = Array.from(document.querySelectorAll('span'));
                return spans.some(span => span.innerText && span.innerText.trim() === 'Seleziona');
            },
            { timeout: 15000 }
        );

        console.log("[LOG] Pagina dei like caricata con successo e pulsante 'Seleziona' trovato.");
    } catch (e) {
        console.error("[ERROR] Errore indirizzamento alla pagina dei like o pulsante non trovato: ", e);
        throw new Error("Errore durante l'indirizzamento alla pagina dei like o caricamento incompleto.");
    }
}


const clickSeleziona = async (page) => {
    try {
        const selezionaClicked = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('span'));
            for (const span of spans) {
                if (span && span.innerText && span.innerText.trim() === 'Seleziona') {
                    span.scrollIntoView({behavior: 'auto', block: 'center'});
                    span.click();
                    return true;
                }
            }
            return false;
        });
        if (selezionaClicked) {
            console.log('[LOG] Pulsante "Seleziona" cliccato con successo.');
            return true;
        } else {
            console.log('[LOG] Nessun pulsante "Seleziona" trovato.');
            return false;
        }
    } catch (error) {
        console.error('[ERROR] clickSeleziona:', error);
        return false;
    }
};

const selectLikes = async (page) => {
    const MAX_TO_DELETE = 45;

    const clicked = await page.evaluate(async (maxLikes) => {
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));

        console.log("[LOG] Inizio selezione like da eliminare...");
        const selectableDivs = Array.from(
            document.querySelectorAll('div[tabindex="0"][role="button"][aria-label="Seleziona o deseleziona la casella"]')
        );

        let clickedCount = 0;

        for (let i = 0; i < Math.min(maxLikes, selectableDivs.length); i++) {
            const el = selectableDivs[i];
            if (el.style.pointerEvents === 'none') {
                el.style.pointerEvents = 'auto';
            }

            el.scrollIntoView({behavior: 'instant', block: 'center'});
            el.click();
            el.setAttribute('data-clicked', 'true');
            clickedCount++;

            await delay(100); // piccolo delay per sicurezza tra i click
        }

        return clickedCount;
    }, MAX_TO_DELETE);

    console.log(`[LOG] Totale like selezionati: ${clicked}`);
    return clicked;
};

const clickUnlike = async (page) => {
    console.log('[LOG] Cerco e clicco su “Non mi piace più”...');

    const success = await page.evaluate(() => {
        // Trova tutti gli span con quel testo
        const spans = Array.from(document.querySelectorAll('span'));
        for (const span of spans) {
            if (span.innerText.trim() === 'Non mi piace più') {
                // Risali al div contenitore più vicino
                const parentDiv = span.closest('div[role="button"], div, button');
                if (parentDiv) {
                    parentDiv.scrollIntoView({behavior: 'smooth', block: 'center'});
                    parentDiv.click();
                    parentDiv.setAttribute('data-clicked', 'true');
                    return true;
                } else {
                    // Se non trova un contenitore, clicca lo span come fallback
                    span.scrollIntoView({behavior: 'smooth', block: 'center'});
                    span.click();
                    span.setAttribute('data-clicked', 'true');
                    return true;
                }
            }
        }
        return false;
    });

    if (success) {
        console.log('[LOG] “Non mi piace più” cliccato con successo ');
    } else {
        console.log('[ERROR] Pulsante “Non mi piace più” non trovato ');
    }

    return success;
};

const confirmUnlike = async (page) => {
    console.log('[LOG] Cerco e clicco su “Non mi piace più” di conferma...');

    const success = await page.evaluate(() => {
        // Trova tutti i bottoni nella pagina
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
            // Controlla se contiene il testo esatto
            if (btn.innerText && btn.innerText.trim() === 'Non mi piace più') {
                btn.scrollIntoView({behavior: 'smooth', block: 'center'});
                btn.click();
                btn.setAttribute('data-clicked', 'true');
                return true;
            }
        }
        return false;
    });

    if (success) {
        console.log('[LOG] Pulsante “Non mi piace più” di conferma cliccato con successo ');
    } else {
        console.log('[ERROR] Pulsante “Non mi piace più” non trovato ');
    }

    return success;
};

const loopDislike = async(page) =>{
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    // Prova a cliccare "Seleziona"; non fallisce l'esecuzione se non trova il pulsante
    await clickSeleziona(page);

    // Breve attesa per permettere aggiornamento DOM
    await delay(1000);

    // Verifica quanti elementi selezionabili sono presenti
    const selectableCount = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll(
            'div[tabindex="0"][role="button"][aria-label="Seleziona o deseleziona la casella"], div[role="button"][tabindex="0"]'
        ));
        return els.length;
    });

    if (selectableCount === 0) {
        console.log('[LOG] Nessun elemento selezionabile trovato dopo aver provato a cliccare "Seleziona".');
        return 0;
    }

    // Se ci sono elementi selezionabili, procedi con la selezione
    const clicked = await selectLikes(page);

    if (clicked === 0) {
        console.log('[LOG] selectLikes ha selezionato 0 elementi.');
        return 0;
    }

    // Attesa per permettere al UI di mostrare il menu di azione
    await delay(3000);

    // Prova a cliccare "Non mi piace più"; se non trovato, prova un reload leggero e esci per riprovare al prossimo loop
    const unlikeClicked = await clickUnlike(page);
    if (!unlikeClicked) {
        console.log('[LOG] Pulsante "Non mi piace più" non trovato dopo selezione. Ricarico la pagina e riprovo.');
        try {
            await page.reload({ waitUntil: 'networkidle2' });
            await delay(2000);
        } catch (e) {
            console.warn('[WARN] Reload fallito: ', e);
        }
        return 0;
    }

    await delay(2000);

    // Conferma l'unlike (se presente)
    await confirmUnlike(page);

    // Aspetta che il DOM si aggiorni e che i like vengano rimossi
    await delay(2500);

    return clicked;
}

// semplice job manager in memoria
const jobs = new Map();

const runDeleteJob = async (jobId, options = {}) => {
    const job = jobs.get(jobId);
    if (!job) return;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    // persist
    await saveJobsToDisk();

    let browser;
    try {
        const started = await avvioBrowser();
        browser = started.browser;
        const page = started.page;
        job.page = true; // flag indicativo

        await login(page);
        await goToLikePage(page);

        let totalDeleted = 0;
        let consecutiveZeros = 0;
        const MAX_CONSECUTIVE_ZERO = options.maxConsecutiveZero || 3; // default

        while (!job.stopRequested && consecutiveZeros < MAX_CONSECUTIVE_ZERO) {
            job.progress = { totalDeleted };
            await saveJobsToDisk();
            const clicked = await loopDislike(page);
            if (clicked > 0) {
                totalDeleted += clicked;
                consecutiveZeros = 0;
                job.progress.totalDeleted = totalDeleted;
                await saveJobsToDisk();
                // Piccola pausa prima di riprendere
                await page.waitForTimeout(1200);
                continue;
            }

            // clicked === 0
            consecutiveZeros++;
            // Ricarica la pagina per forzare il ricaricamento degli elementi e riprova
            try {
                await page.reload({ waitUntil: 'networkidle2' });
                await page.waitForTimeout(1500);
            } catch (e) {
                console.warn('[WARN] Reload fallito durante i retry: ', e);
            }
        }

        job.status = job.stopRequested ? 'stopped' : 'done';
        job.finishedAt = new Date().toISOString();
        job.progress = { totalDeleted };
        await saveJobsToDisk();
    } catch (e) {
        console.error('[ERROR] runDeleteJob:', e);
        job.status = 'error';
        job.error = e && e.message ? e.message : String(e);
        job.finishedAt = new Date().toISOString();
        await saveJobsToDisk();
    } finally {
        if (browser) {
            try {
                await browser.close();
                console.log('[LOG] Browser chiuso dal job.');
            } catch (closeErr) {
                console.warn('[WARN] Errore durante la chiusura del browser: ', closeErr);
            }
        }
    }
};

// Nuovo endpoint: avvia il job in background
app.post('/startDelete', express.json(), (req, res) => {
    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const job = {
        id: jobId,
        status: 'queued',
        createdAt: new Date().toISOString(),
        progress: { totalDeleted: 0 },
        stopRequested: false,
        options: req.body || {}
    };
    jobs.set(jobId, job);
    // salva subito su disco
    saveJobsToDisk();

    // esegui il job in background (non blocca la risposta)
    (async () => {
        await runDeleteJob(jobId, req.body || {});
    })();

    res.json({ jobId, status: 'started' });
});

// Endpoint per ottenere lo stato del job
app.get('/status/:id', (req, res) => {
    const id = req.params.id;
    const job = jobs.get(id);
    if (!job) return res.status(404).json({ error: 'Job non trovato' });
    res.json({ id: job.id, status: job.status, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, progress: job.progress, error: job.error });
});

// Endpoint per richiedere lo stop del job
app.post('/stop/:id', (req, res) => {
    const id = req.params.id;
    const job = jobs.get(id);
    if (!job) return res.status(404).json({ error: 'Job non trovato' });
    job.stopRequested = true;
    saveJobsToDisk();
    res.json({ id, status: 'stop_requested' });
});

// Endpoint per ottenere tutti i job salvati (sommario)
app.get('/jobs', (req, res) => {
    const arr = Array.from(jobs.entries()).map(([id, job]) => ({ id, status: job.status, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, progress: job.progress }));
    res.json(arr);
});

//Server
app.get("/deleteLike", async (req, res) => {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    let browser;
    try {
        const started = await avvioBrowser();
        browser = started.browser;
        const page = started.page;
        await login(page);
        await goToLikePage(page);

        let totalDeleted = 0;
        let consecutiveZeros = 0;
        const MAX_CONSECUTIVE_ZERO = 3; // quante volte consecutive accettiamo 0 prima di terminare

        while (consecutiveZeros < MAX_CONSECUTIVE_ZERO) {
            const clicked = await loopDislike(page);
            if (clicked > 0) {
                totalDeleted += clicked;
                consecutiveZeros = 0;
                console.log(`[LOG] Totale eliminati finora: ${totalDeleted}`);
                // Piccola pausa prima di riprendere
                await delay(1200);
                continue;
            }

            // clicked === 0
            consecutiveZeros++;
            console.log(`[LOG] Nessun like eliminato in questo ciclo. Tentativo ${consecutiveZeros}/${MAX_CONSECUTIVE_ZERO}`);

            // Ricarica la pagina per forzare il ricaricamento degli elementi e riprova
            try {
                await page.reload({ waitUntil: 'networkidle2' });
                // Attendi che la pagina mostri eventualmente il pulsante "Seleziona"
                await  delay(1500);
            } catch (e) {
                console.warn('[WARN] Reload fallito durante i retry: ', e);
            }
        }

        res.send(`Eliminazione like completata. Totale eliminati: ${totalDeleted}`);
    } catch (e) {
        console.error("[ERROR] deleteLike: ", e);
        res.send("Errore durante l'eliminazione del like: " + e.message);
    } finally {
        if (browser) {
            try {
                await browser.close();
                console.log('[LOG] Browser chiuso.');
            } catch (closeErr) {
                console.warn('[WARN] Errore durante la chiusura del browser: ', closeErr);
            }
        }
    }
});


app.listen(process.env.PORT || 3000, () => {
    console.log(`Server avviato su http://localhost:${process.env.PORT || 3000}`);
    // al boot carichiamo eventuali job salvati e riavviamo quelli pendenti
    loadJobsFromDisk();
    for (const [id, job] of jobs.entries()) {
        // riprendi job che erano queued o running e non erano stoppati/completati
        if (['queued', 'running'].includes(job.status) && !job.finishedAt && !job.stopRequested) {
            console.log('[LOG] Ripristino job pendente:', id);
            // assicuriamoci lo stato sia queued
            job.status = 'queued';
            // rilancia in background
            (async () => {
                await runDeleteJob(id, job.options || {});
            })();
        }
    }
});
