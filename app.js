const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const csrf = require('csurf');
const csrfProtection = csrf();

const app = express();
const port = 6789;

const db = new sqlite3.Database('./cumparaturi.db', (err) => {
    if (err) {
        console.error('Eroare la conectarea la baza de date:', err.message);
    } else {
        console.log('Conectat cu succes la baza de date SQLite.');
        
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS utilizatori (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                utilizator TEXT UNIQUE NOT NULL,
                parola TEXT NOT NULL,
                nume TEXT NOT NULL,
                prenume TEXT NOT NULL,
                rol TEXT NOT NULL
            )`);
            
            db.run(`ALTER TABLE utilizatori ADD COLUMN scor_maxim INTEGER DEFAULT 0`, (err) => {});
            
            db.run(`CREATE TABLE IF NOT EXISTS blacklist (
                ip TEXT PRIMARY KEY,
                login_fails INTEGER DEFAULT 0,
                scanner_fails INTEGER DEFAULT 0,
                block_until INTEGER DEFAULT 0,
                last_failed_at INTEGER DEFAULT 0
            )`);

            db.run(`ALTER TABLE blacklist ADD COLUMN last_failed_at INTEGER DEFAULT 0`, (err) => {});

            db.get(`SELECT COUNT(*) as count FROM utilizatori`, [], async (err, row) => {
                if (row && row.count === 0) {
                    try {
                        const parolaAdminHash = await bcrypt.hash('minicooper123', 10);
                        
                        const stmt = db.prepare(`INSERT INTO utilizatori (utilizator, parola, nume, prenume, rol) VALUES (?, ?, ?, ?, ?)`);
                        stmt.run('admin', parolaAdminHash, 'Dumitriu', 'Denis', 'Administrator');
                        stmt.finalize();
                        console.log("Adminul a fost inserat, iar parola a fost criptată automat în spate!");
                    } catch (eroareBcrypt) {
                        console.error("Eroare la criptarea parolei de admin:", eroareBcrypt);
                    }
                }
            });
        });
    }
});

app.set('view engine', 'ejs');
app.use(expressLayouts);
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
    secret: 'cheie_secreta_mini_cooper',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 3600000,
        httpOnly: true,
        secure: false 
    }
}));

//middleware pt verificarea de blacklist 
//daca IP ul e blocat, calculez cate minute au ramas pana la deblocare
//si trimit mesaj de eroare cu timpul ramas, altfel las cererea sa continue
app.use((req, res, next) => {
    db.get(`SELECT * FROM blacklist WHERE ip = ?`, [req.ip], (err, row) => {
        if (row && row.block_until > Date.now()) {
            const minuteRamase = Math.ceil((row.block_until - Date.now()) / 60000);
            return res.status(429).send(`Acces interzis temporar. IP-ul tău este blocat pentru încă ${minuteRamase} minute din cauza activității suspecte.`);
        }
        next();
    });
});


//functia inregistreazaEsec primeste IP ul si 
// tipul de esec (login sau scanner) si actualizeaza
//  in baza de date numarul de esecuri pentru acel IP,
//  iar daca se depaseste pragul de esecuri, 
// seteaza block_until pentru a bloca IP ul pentru 
// o perioada care creste exponential
function inregistreazaEsec(ip, tip) {
    db.get(`SELECT * FROM blacklist WHERE ip = ?`, [ip], (err, row) => {
        const acum = Date.now();
        const fereastraTimp = 15 * 60 * 1000; 

        if (!row) {
            const login_fails = tip === 'login' ? 1 : 0;
            const scanner_fails = tip === 'scanner' ? 1 : 0;
            db.run(`INSERT INTO blacklist (ip, login_fails, scanner_fails, block_until, last_failed_at) VALUES (?, ?, ?, 0, ?)`, [ip, login_fails, scanner_fails, acum]);
        } else {
            let { login_fails, scanner_fails, block_until, last_failed_at } = row;

            if (acum - last_failed_at > fereastraTimp) {
                login_fails = 0;
                scanner_fails = 0;
            }

            if (tip === 'login') login_fails++;
            if (tip === 'scanner') scanner_fails++;

            if (tip === 'login' && login_fails >= 5) {
                const penaltyMinutes = (login_fails - 4) * 5; 
                block_until = acum + (penaltyMinutes * 60000);
            }
            if (tip === 'scanner' && scanner_fails >= 10) {
                const penaltyMinutes = (scanner_fails - 9) * 15; 
                block_until = acum + (penaltyMinutes * 60000);
            }
            
            db.run(`UPDATE blacklist SET login_fails = ?, scanner_fails = ?, block_until = ?, last_failed_at = ? WHERE ip = ?`, [login_fails, scanner_fails, block_until, acum, ip]);
        }
    });
}

app.use((req, res, next) => {
    res.locals.utilizatorLogat = req.session.utilizator || null;
    next();
});

app.get('/', (req, res) => {
    db.all(`SELECT * FROM produse`, [], (err, rows) => {
        if (err) {
            return res.render('index', { cookieUtilizator: req.cookies.utilizator, produse: [] });
        }
        res.render('index', { cookieUtilizator: req.cookies.utilizator, produse: rows });
    });
});

app.get('/autentificare', (req, res) => {
    const mesajEroare = req.cookies.mesajEroare;
    // curat cookie ul de eroare sa nu persiste la refresh
    res.clearCookie('mesajEroare');
    // daca am mesaj de eroare il trimit la pag de autentificare sa l pot afisa
    res.render('autentificare', { eroare: mesajEroare });
});



app.get('/creare-cont', (req, res) => {
    const mesajEroare = req.cookies.mesajEroareInregistrare;
    res.clearCookie('mesajEroareInregistrare');
    res.render('creare-cont', { eroare: mesajEroare });
});

app.post('/procesare-inregistrare', [
    body('utilizator').trim().escape(),
    body('parola').trim().escape(),
    body('nume').trim().escape(),
    body('prenume').trim().escape()
], (req, res) => {
    const eroriValidare = validationResult(req);
    if (!eroriValidare.isEmpty() || !req.body.utilizator || !req.body.parola) {
        res.cookie('mesajEroareInregistrare', 'Date invalide sau incomplete!');
        return res.redirect('/creare-cont');
    }

    const { utilizator, parola, nume, prenume } = req.body;
    // protectie sql injection
    db.get(`SELECT id FROM utilizatori WHERE utilizator = ?`, [utilizator], async (err, rand) => {
        if (err) return res.status(500).send('Eroare la baza de date.');
        
        if (rand) {
            res.cookie('mesajEroareInregistrare', 'Acest nume de utilizator este deja folosit!');
            return res.redirect('/creare-cont');
        }

        try {
            //hash-uiesc parola
            const parolaHash = await bcrypt.hash(parola, 10);
            const rolImplicit = 'User'; 

            const stmt = db.prepare(`INSERT INTO utilizatori (utilizator, parola, nume, prenume, rol) VALUES (?, ?, ?, ?, ?)`);
            stmt.run([utilizator, parolaHash, nume, prenume, rolImplicit], (err) => {
                if (err) {
                    res.cookie('mesajEroareInregistrare', 'Eroare la crearea contului.');
                    return res.redirect('/creare-cont');
                }
                
                res.cookie('mesajEroare', 'Cont creat cu succes! Te poți loga acum.');
                res.redirect('/autentificare');
            });
        } catch (eroareCriptare) {
            res.status(500).send('Eroare la securizarea parolei.');
        }
    });
});










app.post('/verificare-autentificare', [
    //protectie la XSS si sql injection
    body('utilizator').trim().escape(),
    body('parola').trim().escape()
], (req, res) => {
    const eroriValidare = validationResult(req);
    if (!eroriValidare.isEmpty()) {
        inregistreazaEsec(req.ip, 'login');
        res.cookie('mesajEroare', 'Date invalide introduse!');
        return res.redirect('/autentificare');
    }

    const { utilizator, parola } = req.body;
    
    db.get(`SELECT * FROM utilizatori WHERE utilizator = ?`, [utilizator], async (err, userGasit) => {
        if (err) return res.status(500).send('Eroare server.');
        
        if (userGasit) {
            const parolaCorecta = await bcrypt.compare(parola, userGasit.parola);
            if (parolaCorecta) {
                db.run(`UPDATE blacklist SET login_fails = 0 WHERE ip = ?`, [req.ip]);
                
                res.cookie('utilizator', userGasit.utilizator);
                // la login cu succes salvez in sesiune datele utilizatorului
                //asta seteaza automat si cookie ul de sesiune cu id ul sesiunii
                req.session.utilizator = {
                    username: userGasit.utilizator,
                    nume: userGasit.nume,
                    prenume: userGasit.prenume,
                    rol: userGasit.rol
                };
                return res.redirect('/');
            }
        }
        
        inregistreazaEsec(req.ip, 'login');
        //cookie de eroare care se seteaza in caz de fail la autentificare
        res.cookie('mesajEroare', 'Utilizator sau parolă greșite !!!');
        res.redirect('/autentificare');
    });
});

app.get('/delogare', (req, res) => {
    //la delogare distrug sesiunea si cookie ul de utilizator
    req.session.destroy();
    res.clearCookie('utilizator');
    res.redirect('/');
});

app.post('/adaugare-cos', (req, res) => {
    const idProdus = req.body.id;
    if (!req.session.utilizator) {
        return res.json({ status: 'eroare', redirect: '/autentificare' });
    }
    if (!req.session.cos) {
        req.session.cos = [];
    }
    req.session.cos.push(idProdus);
    res.json({ status: 'succes', mesaj: 'Model adăugat cu succes în coș!' });
    //salvez produsele in sesiune, practic stochez un array de id uri de produse, 
    //iar la vizualizare cos o sa fac o interogare ca 
    //sa aduc detaliile produselor din baza de date folosind id urile din sesiune
});

app.post('/modifica-cos', (req, res) => {
    if (!req.session.utilizator || !req.session.cos) {
        return res.redirect('/autentificare');
    }
    const idProdus = req.body.id;
    const actiune = req.body.actiune;
    if (actiune === 'plus') {
        req.session.cos.push(idProdus);
    } else if (actiune === 'minus') {
        const index = req.session.cos.indexOf(idProdus);
        if (index > -1) {
            req.session.cos.splice(index, 1);
        }
    }
    res.redirect('/vizualizare-cos');
});

app.get('/vizualizare-cos', (req, res) => {
    if (!req.session.utilizator) {
        return res.redirect('/autentificare');
    }
    
    const mesajSucces = req.query.status === 'succes' ? 'Comanda ta a fost plasată cu succes! Machetele sunt pe drum.' : null;
    //preiau cosul din sesiune
    const cosSesiune = req.session.cos || [];
    if (cosSesiune.length === 0) {
        return res.render('vizualizare-cos', { produseCos: [], total: 0, mesaj: mesajSucces });
    }

    db.all(`SELECT * FROM produse`, [], (err, toateProdusele) => {
        if (err) return res.render('vizualizare-cos', { produseCos: [], total: 0, mesaj: mesajSucces });
        let frecventaProduse = {};
        cosSesiune.forEach(id => {
            frecventaProduse[id] = (frecventaProduse[id] || 0) + 1;
        });
        //parcurg produsele din bd si le grupez cu cantitatea din cos, 
        // iar la final calculez si pretul total
        let produseGrupate = [];
        let pretTotal = 0;
        for (let idDinCos in frecventaProduse) {
            const produsGasit = toateProdusele.find(p => p.id.toString() === idDinCos.toString());
            if (produsGasit) {
                const cantitate = frecventaProduse[idDinCos];
                produseGrupate.push({ detalii: produsGasit, cantitate: cantitate });
                pretTotal += (produsGasit.pret * cantitate);
            }
        }
        res.render('vizualizare-cos', { produseCos: produseGrupate, total: pretTotal, mesaj: mesajSucces });
    });
});


app.post('/finalizare-comanda', (req, res) => {
    if (!req.session.utilizator) {
        return res.redirect('/autentificare');
    }
    
    req.session.cos = [];
    
    res.redirect('/vizualizare-cos?status=succes');
});



app.get('/chestionar', (req, res) => {
    //citire asincrona cu readFile, sincron era cu readFileSync 
    fs.readFile('intrebari.json', 'utf8', (err, data) => {
        if (err) return res.status(500).send('Eroare.');
        res.render('chestionar', { intrebari: JSON.parse(data) });
        //trimit cu render in ejs si folosesc json.parse ca sa fac din string in array de obiecte
    });
});

app.post('/rezultat-chestionar', (req, res) => {
    fs.readFile('intrebari.json', 'utf8', (err, data) => {
        if (err) return res.status(500).send('Eroare.');
        const listaIntrebari = JSON.parse(data);
        const raspunsuriUtilizator = req.body;
        let raspunsuriCorecte = 0;
        let detaliiRezultate = [];
        
        for (let i = 0; i < listaIntrebari.length; i++) {
            const raspunsDat = parseInt(raspunsuriUtilizator['q' + i]);
            const corect = listaIntrebari[i].corect;
            const esteCorect = (raspunsDat === corect);
            if (esteCorect) raspunsuriCorecte++;
            detaliiRezultate.push({
                intrebare: listaIntrebari[i].intrebare,
                variante: listaIntrebari[i].variante,
                raspunsDat: isNaN(raspunsDat) ? -1 : raspunsDat,
                corect: corect,
                esteCorect: esteCorect
            });
        }

        if (req.session.utilizator) {
            const username = req.session.utilizator.username;
            
            db.get(`SELECT scor_maxim FROM utilizatori WHERE utilizator = ?`, [username], (err, row) => {
                if (!err && row) {
                    const scorCurentSalvat = row.scor_maxim || 0;
                    
                    if (raspunsuriCorecte > scorCurentSalvat) {
                        db.run(`UPDATE utilizatori SET scor_maxim = ? WHERE utilizator = ?`, [raspunsuriCorecte, username], (err) => {
                            res.render('rezultat-chestionar', { corecte: raspunsuriCorecte, total: listaIntrebari.length, detalii: detaliiRezultate });
                        });
                    } else {
                        res.render('rezultat-chestionar', { corecte: raspunsuriCorecte, total: listaIntrebari.length, detalii: detaliiRezultate });
                    }
                } else {
                    res.render('rezultat-chestionar', { corecte: raspunsuriCorecte, total: listaIntrebari.length, detalii: detaliiRezultate });
                }
            });
        } else {
            res.render('rezultat-chestionar', { corecte: raspunsuriCorecte, total: listaIntrebari.length, detalii: detaliiRezultate });
        }
    });
});

//middleware de verificare rol admin
const verificareAdmin = (req, res, next) => {
    if (req.session.utilizator && req.session.utilizator.rol === 'Administrator') {
        next();
    } else {
        res.status(403).send('403 Forbidden - Acces interzis!');
    }
};

app.get('/admin', verificareAdmin, csrfProtection, (req, res) => {
    //csrfProtection e middleware care adauga token ul 
    // csrf in request, iar cu req.csrfToken() pot prelua 
    // token ul si trimite in pagina de admin ca sa il pot folosi 
    // in formularul de adaugare produs
    res.render('admin', { csrfToken: req.csrfToken() });
});

app.post('/admin/adaugare-produs', verificareAdmin, csrfProtection, (req, res) => {
    const { nume, descriere, pret, imagine } = req.body;
    
    //validare simpla pe server, in plus fata de cea de pe client
    if (parseFloat(pret) <= 1) {
        return res.status(400).send("<h2>Eroare: Prețul produsului trebuie să fie strict mai mare de 1 €!</h2><a href='/admin'>Întoarce-te înapoi</a>");
    }

    db.get(`SELECT id FROM produse WHERE nume = ?`, [nume], (err, rand) => {
        if (err) return res.status(500).send("Eroare internă la baza de date.");
        
        if (rand) {
            return res.status(400).send("<h2>Eroare: O machetă cu acest nume există deja în magazin!</h2><a href='/admin'>Întoarce-te înapoi</a>");
        }

        const stmt = db.prepare(`INSERT INTO produse (nume, descriere, pret, imagine) VALUES (?, ?, ?, ?)`);
        stmt.run([nume, descriere, pret, imagine], (err) => {
            if (err) {
                return res.status(500).send("Eroare la adăugarea produsului.");
            }
            res.redirect('/');
        });
    });
});

app.get('/creare-bd', (req, res) => {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS produse (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nume TEXT UNIQUE NOT NULL,
            descriere TEXT,
            pret REAL NOT NULL,
            imagine TEXT
        )
    `;
    db.run(createTableQuery, (err) => {
        if (err) console.error(err.message);
        res.redirect('/');
    });
});

app.get('/inserare-bd', (req, res) => {
    const produseDeInserat = [
        ['Mini Cooper S (2024) - Midnight Black', 'Hot hatch veritabil, motorizare 2.0L TwinPower Turbo, 204 CP. O experiență pură de kart pe stradă cu accente roșii distinctive.', 1850, 'mini_cooper_2.jpg'],
        ['Mini JCW GP Edition - Racing Grey', 'Cel mai rapid Mini construit vreodată. 306 CP, suspensie sport adaptivă și aerodinamică extremă de circuit.', 2490, 'mini_cooper_3.jpg'],
        ['Mini Cooper S JCW Trim - Chili Red', 'Design iconic, reinterpretat pentru era modernă. Agilitate legendară și un profil inconfundabil, gata să cucerească drumurile.', 1200, 'mini_cooper_1.jpg'],
        ['Mini Cooper SE (Electric) - Island Blue', 'Viitorul mobilității urbane. Motorizare complet electrică, cuplu instant și un design aerodinamic, perfect pentru oraș.', 1450, 'mini_cooper_4.jpg'],
        ['Mini Countryman JCW - Moonwalk Grey', 'Cel mai spațios și capabil Mini. Tracțiune integrală ALL4, gardă la sol înălțată și un plafon roșu contrastant pentru un spirit de aventură.', 2100, 'mini_cooper_5.jpg'],
        ['Mini Clubman - Starlight Blue', 'Eleganță practică cu portiere split-door iconice pe spate. Un profil rafinat, spațiu generos și linii aerodinamice fluide.', 1950, 'mini_cooper_6.jpg'],
        ['Mini JCW Cabrio - Enigmatic Black', 'Senzația libertății absolute. Performanță JCW de 231 CP, evacuare sport cu sunet inconfundabil și plafon care se deschide în 18 secunde.', 1900, 'mini_cooper_7.jpg'],
        ['Mini Cooper S 5-Uși - Ocean Wave Green', 'Dinamică de kart, acum cu spațiu extins. Ampatament mărit pentru confort superior al pasagerilor, finisat într-o nuanță pastelată inedită.', 1650, 'mini_cooper_8.jpg'],
        ['Mini Cooper S Rally - Clasic', 'Legenda raliurilor. Configurație clasică cu proiectoare auxiliare, detalii de competiție și numărul 78 pregătit pentru cursă.', 1350, 'mini_cooper_9.jpg'],
        ['Mini Aceman Concept - Aurora Green', 'O privire spre viitorul designului complet electric. Faruri unghiulare, interfață digitală OLED circulară și sustenabilitate fără compromisuri.', 2200, 'mini_cooper_10.jpeg']
    ];

    db.serialize(() => {
        db.run(`DELETE FROM produse`);
        const stmt = db.prepare(`INSERT INTO produse (nume, descriere, pret, imagine) VALUES (?, ?, ?, ?)`);
        let masiniInserate = 0;
        produseDeInserat.forEach(produs => {
            stmt.run(produs, (err) => {
                if (err) console.error("Eroare inserare:", err);
                masiniInserate++;
                if (masiniInserate === produseDeInserat.length) {
                    stmt.finalize();
                    res.redirect('/');
                }
            });
        });
    });
});

app.use((req, res) => {
    inregistreazaEsec(req.ip, 'scanner');
    res.status(404).send('404 - Pagina nu a fost găsită!');
});

app.listen(port, () => console.log(`Serverul rulează la adresa http://localhost:${port}/`));

process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Eroare la închiderea bazei de date:', err.message);
        } else {
            console.log('Conexiunea la baza de date a fost închisă în siguranță.');
        }
        process.exit(0);
    });
});