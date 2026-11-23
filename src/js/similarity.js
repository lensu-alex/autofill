'use strict';
// Similarity matching: when no rule recognises a label, compare it with many ways of
// asking for each piece of information (several languages) using letter-trigram TF-IDF.
// Copes with typos, scan misreads ("Telefo", "domicilul") and word endings ("domiciliului").
// Optionally a local AI embedding model (smart.js) adds meaning-based matching on top.

const MORE_PHRASES = {
  last_name: ['nom de famille', 'nachname', 'familienname', 'cognome', 'apellido', 'apellidos', 'vezeteknev', 'nume familie', 'numele de familie al'],
  first_name: ['prenom', 'vorname', 'nome proprio', 'nombre', 'keresztnev', 'prenumele titularului'],
  full_name: ['nom complet', 'nom et prenom', 'vollstandiger name', 'nome e cognome', 'nombre completo', 'nume si prenume titular', 'numele solicitantului', 'numele candidatului', 'numele elevului', 'numele studentului', 'name of applicant', 'student name', 'participant name', 'nume participant', 'beneficiar', 'numele beneficiarului', 'reprezentant', 'nume angajat', 'employee name'],
  cnp: ['cod numeric', 'cnp titular', 'cnp solicitant', 'cod personal', 'numar personal de identificare', 'social security number', 'ssn', 'personal id code'],
  birth_date: ['date de naissance', 'geburtsdatum', 'data di nascita', 'fecha de nacimiento', 'data nastere', 'nascut la data', 'zi luna an nastere', 'date born'],
  birth_place: ['lieu de naissance', 'geburtsort', 'luogo di nascita', 'lugar de nacimiento', 'localitatea nasterii', 'judetul nasterii'],
  gender: ['sexe', 'geschlecht', 'sesso', 'sexo', 'gen masculin feminin'],
  citizenship: ['nationalite', 'staatsangehorigkeit', 'cittadinanza', 'nacionalidad', 'cetatenia romana'],
  father_name: ['prenumele tatalui', 'nume tata', 'tata', 'nom du pere', 'vater'],
  mother_name: ['prenumele mamei', 'nume mama', 'nom de la mere', 'mutter'],
  id_series: ['seria actului', 'serie act identitate', 'seria buletinului', 'seria cartii de identitate'],
  id_number: ['numarul actului', 'numar act identitate', 'numar buletin', 'numar carte identitate', 'numero de carte', 'ausweisnummer', 'numero documento', 'numero de documento', 'passport no'],
  id_issued_by: ['emitent', 'eliberat de catre', 'autoritate emitenta', 'delivre par', 'ausgestellt von'],
  id_issue_date: ['data emiterii', 'eliberat la data', 'date de delivrance', 'ausstellungsdatum'],
  id_expiry_date: ['valabilitate pana la', 'data expirarii actului', 'gultig bis', 'date d expiration'],
  street: ['strada nr', 'denumirea strazii', 'rue', 'strasse', 'via', 'calle', 'street name', 'address line'],
  street_number: ['numarul strazii', 'nr imobil', 'hausnummer', 'numero civico'],
  building: ['bloc nr', 'blocul nr'],
  apartment: ['apartament nr', 'ap nr', 'wohnung'],
  city: ['ville', 'stadt', 'ort', 'citta', 'ciudad', 'localitate domiciliu', 'municipiu oras comuna', 'oras sat'],
  county: ['judet sector', 'judetul domiciliului', 'departement', 'bundesland', 'provincia'],
  postal_code: ['code postal', 'postleitzahl', 'plz', 'cap', 'codigo postal', 'cod postal domiciliu'],
  country: ['pays', 'land', 'paese', 'pais', 'tara de resedinta'],
  address: ['adresse', 'anschrift', 'wohnort', 'indirizzo', 'direccion', 'domicile', 'adresa domiciliu', 'domiciliul stabil', 'adresa de corespondenta', 'adresa postala', 'domiciliul actual', 'mailing address', 'residential address'],
  phone: ['telephone', 'telefono', 'telefonnummer', 'numero de telephone', 'tel mobil', 'nr de telefon', 'telefon contact', 'contact telefonic', 'phone no'],
  email: ['courriel', 'correo electronico', 'posta elettronica', 'adresa de posta electronica', 'e mail contact', 'email contact'],
  occupation: ['profession', 'beruf', 'professione', 'profesion', 'ocupatie actuala', 'functia detinuta'],
  employer: ['employeur', 'arbeitgeber', 'datore di lavoro', 'empleador', 'locul de munca actual', 'unitatea angajatoare'],
  school: ['ecole', 'schule', 'scuola', 'escuela', 'unitate scolara', 'liceu', 'facultate', 'universitate', 'institutie de invatamant'],
  class_grade: ['clasa a', 'anul de studii', 'grupa', 'an universitar'],
  student_id: ['numar legitimatie', 'nr legitimatie', 'matricola'],
  iban: ['compte bancaire', 'bankverbindung', 'conto corrente', 'cuenta bancaria', 'cont curent', 'cod iban'],
  bank: ['banque', 'nume banca', 'banca la care'],
  today: ['datum', 'date du jour', 'fecha', 'data completarii', 'data depunerii', 'data cererii'],
  signature: ['unterschrift', 'firma', 'semnatura olografa', 'signature du demandeur', 'semnatura titularului', 'semnatura solicitant', 'semnatura si stampila'],
};

let _fz = null, _fzFor = null;

function trigrams(s) {
  const t = ' ' + s + ' ';
  const m = new Map();
  for (let i = 0; i < t.length - 2; i++) { const g = t.slice(i, i + 3); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}

function buildFuzzy(compiled) {
  const entries = [];
  for (const f of compiled) {
    if (f.key[0] === '@') continue;
    const phrases = new Set([...f.synN, ...(MORE_PHRASES[f.key] || []).map(norm)]);
    for (const p of phrases) if (p.length >= 3) entries.push({ key: f.key, phrase: p, tf: trigrams(p) });
  }
  const df = new Map();
  for (const e of entries) for (const g of e.tf.keys()) df.set(g, (df.get(g) || 0) + 1);
  const N = entries.length;
  const idf = (g) => Math.log(1 + N / (df.get(g) || 0.5));
  for (const e of entries) {
    e.vec = new Map();
    let n = 0;
    for (const [g, c] of e.tf) { const w = c * idf(g); e.vec.set(g, w); n += w * w; }
    e.norm = Math.sqrt(n);
  }
  return { entries, idf };
}

function fuzzyTop(query, fz, k = 6) {
  const v = new Map();
  let n = 0;
  for (const [g, c] of trigrams(query)) { const w = c * fz.idf(g); v.set(g, w); n += w * w; }
  n = Math.sqrt(n);
  const out = [];
  for (const e of fz.entries) {
    let dot = 0;
    for (const [g, w] of v) { const x = e.vec.get(g); if (x) dot += w * x; }
    out.push({ key: e.key, score: dot / (n * e.norm || 1), phrase: e.phrase });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}

const FZ_STOP = new Set(['si', 'de', 'la', 'in', 'al', 'a', 'ale', 'the', 'of', 'and', 'du', 'des', 'et', 'di', 'del', 'y', 'e', 'cu', 'pe', 'din', 'le', 'your', 'my', 'nr', 'no']);
function wordSim(a, b) {
  if (a === b) return 1;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.9;
  const ta = trigrams(a), tb = trigrams(b);
  let common = 0, na = 0, nb = 0;
  for (const c of ta.values()) na += c;
  for (const c of tb.values()) nb += c;
  for (const [g, c] of ta) common += Math.min(c, tb.get(g) || 0);
  return (2 * common) / (na + nb);
}
// Most of the words on both sides must have a partner: "motivul cererii" is not "data cererii"
function coverage(q, phrase) {
  const qa = q.split(' ').filter((w) => !FZ_STOP.has(w)), pa = phrase.split(' ').filter((w) => !FZ_STOP.has(w));
  if (!qa.length || !pa.length) return 0;
  const hit = (w, list) => list.some((x) => wordSim(w, x) >= 0.6);
  return Math.min(qa.filter((w) => hit(w, pa)).length / qa.length, pa.filter((w) => hit(w, qa)).length / pa.length);
}

// The label's last few words, compared at several lengths; returns {key, score} or null
function fuzzyClassify(label, compiled, min = 0.66) {
  if (_fzFor !== compiled) { _fz = buildFuzzy(compiled); _fzFor = compiled; }
  const words = norm(cleanLabel(label)).split(' ').filter((w) => w && !/^\d+$/.test(w)).slice(-5);
  let best = null;
  for (let n = 1; n <= words.length; n++) {
    const q = words.slice(-n).join(' ');
    if (q.replace(/ /g, '').length < 4) continue;
    const r = fuzzyTop(q, _fz).find((c) => coverage(q, c.phrase) >= 0.6);
    // a longer piece of the label has to be clearly better to win
    if (r && (!best || r.score > best.score + 0.02 * (n > 1))) best = r;
  }
  return best && best.score >= min ? best : null;
}
