const fs = require('fs');
const bcrypt = require('bcrypt');

fs.readFile('utilizatori.json', 'utf8', async (err, data) => {
    if (err) throw err;
    let utilizatori = JSON.parse(data);
    
    for (let user of utilizatori) {
        if (!user.parola.startsWith('$2b$')) {
            user.parola = await bcrypt.hash(user.parola, 10);
        }
    }
    
    fs.writeFile('utilizatori.json', JSON.stringify(utilizatori, null, 4), (err) => {
        if (err) throw err;
        console.log("Parolele au fost criptate cu succes!");
    });
});
// rulez cu node criptare.js