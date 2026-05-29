const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./cumparaturi.db');

async function adaugaUtilizator(utilizator, parolaClara, nume, prenume, rol) {
    try {
        const parolaHash = await bcrypt.hash(parolaClara, 10);
        
        const stmt = db.prepare(`INSERT INTO utilizatori (utilizator, parola, nume, prenume, rol) VALUES (?, ?, ?, ?, ?)`);
        
        stmt.run([utilizator, parolaHash, nume, prenume, rol], function(err) {
            if (err) {
                console.error("Eroare la adăugare (probabil utilizatorul există deja):", err.message);
            } else {
                console.log(` Utilizatorul '${utilizator}' a fost adăugat cu succes în baza de date!`);
            }
        });
    } catch (eroare) {
        console.error("Eroare la criptare:", eroare);
    }
}

// adaugaUtilizator('Nume_Cont', 'Parola_Clara', 'Nume_Familie', 'Prenume', 'Rol');

adaugaUtilizator('delia', 'deliapw4thewin', 'delia', 'delia', 'User');

//rulez cu node adauga_user.js 