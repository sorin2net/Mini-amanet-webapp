const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./cumparaturi.db');

db.run(`DELETE FROM blacklist`, function(err) {
    if (err) {
        console.error("Eroare la ștergerea listei negre:", err.message);
    } else {
        console.log(" Blacklist-ul a fost curățat cu succes! Toate IP-urile au fost deblocate.");
    }
    
    db.close();
});
//node reset_blacklist.js