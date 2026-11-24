'use strict';
// The information you can store, and the words forms use to ask for it
// (Romanian + English, written without diacritics because labels are normalized first).

const FIELD_GROUPS = [
  ['identity', 'Identity'],
  ['id', 'ID card / passport'],
  ['address', 'Address'],
  ['contact', 'Contact'],
  ['work', 'School / work'],
  ['bank', 'Bank'],
  ['custom', 'My extra fields'],
];

const FIELD_DEFS = [
  { key: 'last_name', group: 'identity', label: 'Last name · Nume', syn: ['nume de familie', 'numele de familie', 'last name', 'surname', 'family name', 'lastname', 'nom'] },
  { key: 'first_name', group: 'identity', label: 'First name · Prenume', syn: ['prenume', 'prenumele', 'first name', 'given name', 'given names', 'firstname', 'forename', 'forenames', 'first and middle names', 'first and middle name', 'first names', 'prenom'] },
  { key: 'full_name', group: 'identity', label: 'Full name · Nume și prenume', hint: 'empty = first + last name', syn: ['nume si prenume', 'numele si prenumele', 'nume de familie si prenume', 'numele de familie si prenumele', 'numele si prenumele complet', 'nume prenume', 'numele complet', 'nume complet', 'full name', 'name', 'name and surname', 'your name', 'applicant name', 'subsemnatul', 'subsemnata', 'subsemnatii', 'undersigned', 'titular', 'titularul', 'solicitant', 'solicitantul', 'eu', 'i the undersigned', 'elevul', 'eleva', 'studentul', 'studenta', 'candidatul', 'candidata'] },
  { key: 'cnp', group: 'identity', label: 'CNP / personal number', syn: ['cnp', 'c n p', 'cod numeric personal', 'codul numeric personal', 'personal numeric code', 'personal identification number', 'national id number', 'pin'] },
  { key: 'birth_date', group: 'identity', label: 'Date of birth · Data nașterii', syn: ['data nasterii', 'data de nastere', 'nascut la data de', 'nascuta la data de', 'nascut la', 'nascuta la', 'date of birth', 'birth date', 'birthdate', 'dob', 'born on'] },
  { key: 'birth_place', group: 'identity', label: 'Place of birth · Locul nașterii', syn: ['locul nasterii', 'loc nastere', 'locul de nastere', 'nascut in', 'nascuta in', 'place of birth', 'birthplace', 'born in', 'town of birth', 'city of birth', 'localitatea nasterii', 'localitatea de nastere'] },
  { key: 'gender', group: 'identity', label: 'Sex / gender', syn: ['sex', 'sexul', 'gender'] },
  { key: 'citizenship', group: 'identity', label: 'Citizenship · Cetățenie', syn: ['cetatenie', 'cetatenia', 'cetatean', 'nationalitate', 'nationalitatea', 'citizenship', 'nationality'] },
  { key: 'father_name', group: 'identity', label: "Father's first name · Tatăl", syn: ['fiul lui', 'fiica lui', 'numele tatalui', 'prenumele tatalui', 'tatal', 'father s name', 'fathers name', 'father name', 'father'] },
  { key: 'mother_name', group: 'identity', label: "Mother's first name · Mama", syn: ['si al', 'numele mamei', 'prenumele mamei', 'mama', 'mother s name', 'mothers name', 'mother name', 'mother'] },

  { key: 'id_series', group: 'id', label: 'ID series · Seria', syn: ['seria ci', 'seria bi', 'ci seria', 'bi seria', 'id series'] },
  { key: 'id_number', group: 'id', label: 'ID number · Număr', syn: ['numar ci', 'nr ci', 'numarul ci', 'passport number', 'passport no', 'document number', 'numar document', 'nr document', 'numar pasaport', 'nr pasaport', 'id card number', 'id number', 'id no'] },
  { key: 'id_issued_by', group: 'id', label: 'Issued by · Eliberat de', syn: ['eliberat de', 'eliberata de', 'emis de', 'emisa de', 'issued by', 'issuing authority', 'autoritatea emitenta'] },
  { key: 'id_issue_date', group: 'id', label: 'Issue date · Data eliberării', syn: ['data eliberarii', 'eliberat la data de', 'eliberat la data', 'date of issue', 'issue date', 'issued on'] },
  { key: 'id_expiry_date', group: 'id', label: 'Valid until · Valabil până la', syn: ['valabil pana la', 'valabila pana la', 'valabilitatea', 'valabilitate', 'valabilitatea actului', 'data expirarii', 'expiry date', 'expiration date', 'valid until', 'date of expiry'] },

  { key: 'street', group: 'address', label: 'Street · Strada', syn: ['strada', 'str', 'street', 'bulevardul', 'bd', 'b dul', 'soseaua', 'sos', 'calea', 'aleea', 'splaiul'] },
  { key: 'street_number', group: 'address', label: 'Street number · Nr.', syn: ['numar strada', 'nr strada', 'street number', 'house number', 'house no'] },
  { key: 'building', group: 'address', label: 'Block · Bloc', syn: ['bloc', 'blocul', 'bl', 'building', 'bldg'] },
  { key: 'entrance', group: 'address', label: 'Entrance · Scara', syn: ['scara', 'sc', 'entrance'] },
  { key: 'floor', group: 'address', label: 'Floor · Etaj', syn: ['etaj', 'etajul', 'et', 'floor'] },
  { key: 'apartment', group: 'address', label: 'Apartment · Ap.', syn: ['apartament', 'apartamentul', 'ap', 'apt', 'apartment', 'flat'] },
  { key: 'city', group: 'address', label: 'City · Localitatea', syn: ['localitatea', 'localitate', 'loc', 'orasul', 'oras', 'municipiul', 'comuna', 'satul', 'city', 'town', 'locality', 'town city'] },
  { key: 'sector', group: 'address', label: 'Sector', syn: ['sectorul', 'sector'] },
  { key: 'county', group: 'address', label: 'County · Județ', syn: ['judetul', 'judet', 'jud', 'county', 'state', 'province', 'region'] },
  { key: 'postal_code', group: 'address', label: 'Postal code · Cod poștal', syn: ['cod postal', 'codul postal', 'postal code', 'zip code', 'zip', 'postcode'] },
  { key: 'country', group: 'address', label: 'Country · Țara', syn: ['tara', 'country'] },
  { key: 'address', group: 'address', label: 'Full address · Domiciliul', hint: 'empty = built from the parts above', syn: ['domiciliul', 'domiciliat in', 'domiciliata in', 'domiciliat', 'domiciliata', 'cu domiciliul in', 'cu domiciliul', 'domiciliu', 'adresa', 'adresa de domiciliu', 'adresa completa', 'resedinta', 'address', 'home address', 'residing at', 'residing in', 'residence', 'living at'] },

  { key: 'phone', group: 'contact', label: 'Phone · Telefon', syn: ['telefon', 'tel', 'nr telefon', 'numar de telefon', 'numar telefon', 'telefon mobil', 'mobil', 'phone', 'phone number', 'telephone', 'telephone number', 'contact number', 'mobile', 'mobile number', 'cell'] },
  { key: 'email', group: 'contact', label: 'Email', syn: ['e mail', 'email', 'adresa de e mail', 'adresa de email', 'adresa email', 'mail', 'email address', 'e mail address'] },

  { key: 'occupation', group: 'work', label: 'Occupation · Ocupația', syn: ['ocupatia', 'ocupatie', 'profesia', 'profesie', 'functia', 'functie', 'occupation', 'profession', 'job title', 'position'] },
  { key: 'employer', group: 'work', label: 'Employer · Loc de muncă', syn: ['angajator', 'angajatorul', 'loc de munca', 'locul de munca', 'employer', 'company', 'companie', 'firma'] },
  { key: 'school', group: 'work', label: 'School / university · Școala / Universitatea', syn: ['unitatea de invatamant', 'scoala', 'liceul', 'colegiul', 'universitatea', 'universitate', 'institutia de invatamant', 'school', 'university', 'college', 'institution'] },
  { key: 'faculty', group: 'work', label: 'Faculty · Facultatea', syn: ['facultatea', 'facultatii', 'facultate', 'faculty', 'faculty of', 'school of', 'departamentul', 'department'] },
  { key: 'study_program', group: 'work', label: 'Study programme · Programul de studii', syn: ['programul de studii', 'program de studii', 'programul de studiu', 'specializarea', 'specializare', 'specializarii', 'specialization', 'study programme', 'study program', 'programme', 'major', 'domeniul de studii', 'domeniul'] },
  { key: 'study_cycle', group: 'work', label: 'Study level · Ciclul de studii', hint: 'e.g. Licență / Master', syn: ['ciclul de studii', 'ciclu de studii', 'ciclul de studiu', 'nivelul de studii', 'nivel de studii', 'study cycle', 'level of study', 'degree level', 'study level'] },
  { key: 'study_form', group: 'work', label: 'Study mode · Forma de învățământ', hint: 'e.g. IF (cu frecvență)', syn: ['forma de invatamant', 'forma invatamant', 'forma de studiu', 'forma de studii', 'mode of study', 'study mode', 'attendance'] },
  { key: 'class_grade', group: 'work', label: 'Class / year of study · Clasa / anul de studiu', syn: ['clasa', 'class', 'grade', 'anul de studiu', 'an de studiu', 'anul de studii', 'year of study', 'study year'] },
  { key: 'study_group', group: 'work', label: 'Group / series · Grupa / seria', syn: ['grupa', 'grupa de studiu', 'seria de studiu', 'seria de studii', 'formatia de studiu', 'group', 'study group'] },
  { key: 'student_id', group: 'work', label: 'Student ID · Nr. matricol', syn: ['numar matricol', 'nr matricol', 'matricol', 'student id', 'student number'] },

  { key: 'iban', group: 'bank', label: 'IBAN', syn: ['iban', 'cont iban', 'cod iban', 'cont bancar', 'contul', 'bank account', 'account number', 'cont'] },
  { key: 'bank', group: 'bank', label: 'Bank · Banca', syn: ['banca', 'deschis la', 'bank', 'bank name'] },
];

// Not stored: filled automatically
const SPECIAL_FIELDS = [
  { key: 'today', label: "Today's date", syn: ['data completarii', 'data semnarii', 'today', 'today s date'] },
  { key: 'birth_place_date', label: 'Place and date of birth', syn: ['locul si data nasterii', 'data si locul nasterii', 'locul si data de nastere', 'data si locul de nastere', 'place and date of birth', 'date and place of birth'] },
  { key: 'academic_year', label: 'Academic year (e.g. 2026-2027)', syn: ['anul universitar', 'an universitar', 'anului universitar', 'anul scolar', 'an scolar', 'anului scolar', 'academic year', 'school year'] },
  { key: 'academic_year_start', label: 'Academic year: first year', syn: [] },
  { key: 'academic_year_end', label: 'Academic year: second year', syn: [] },
  { key: 'age', label: 'Age (from birth date)', syn: ['varsta', 'varsta ani', 'in varsta de', 'age', 'years old', 'ani impliniti'] },
  { key: 'birth_day', label: 'Birth day (dd)', syn: ['ziua nasterii'] },
  { key: 'birth_month', label: 'Birth month (mm)', syn: ['luna nasterii'] },
  { key: 'birth_year', label: 'Birth year (yyyy)', syn: ['anul nasterii', 'year of birth'] },
  { key: 'today_day', label: "Today's day (dd)", syn: [] },
  { key: 'today_month', label: "Today's month (mm)", syn: [] },
  { key: 'today_year', label: "Today's year (yyyy)", syn: [] },
  { key: 'signature', label: '✍︎ Signature', syn: ['semnatura', 'semnatura solicitantului', 'semnatura titularului', 'semnatura elevului', 'semnatura studentului', 'semnatura candidatului', 'semnatura mea', 'signature', 'signed', 'sign here', 'applicant signature', 'applicant s signature', 'semnat'] },
];

// Words whose meaning depends on what comes before them
const AMBIGUOUS = [
  { key: '@nr', syn: ['nr', 'numar', 'numarul', 'no', 'number'] },
  { key: '@date', syn: ['data', 'date', 'la data de', 'la data', 'din data de', 'pe data de', 'in data de', 'data de'] },
  { key: '@nume', syn: ['nume', 'numele'] },
  { key: '@in', syn: ['in'] },
  { key: '@seria', syn: ['seria', 'serie'] },
  { key: '@zi', syn: ['ziua', 'zi', 'day'] },
  { key: '@luna', syn: ['luna', 'month'] },
  { key: '@an', syn: ['anul', 'an', 'year'] },
];
const AMBIG_CONTEXT = {
  '@nr': [
    ['id_number', ['seria', 'serie', 'ci', 'bi', 'buletin', 'carte de identitate', 'pasaport', 'passport', 'act', 'legitimat', 'legitimata', 'identitate']],
    ['street_number', ['str', 'strada', 'street', 'sos', 'soseaua', 'bd', 'bulevardul', 'calea', 'aleea', 'splaiul', 'intrarea']],
    ['phone', ['telefon', 'tel', 'phone', 'mobil']],
    ['student_id', ['matricol']],
  ],
  '@date': [
    ['id_issue_date', ['eliberat', 'eliberata', 'emis', 'emisa', 'issued', 'eliberarii']],
    ['birth_date', ['nascut', 'nascuta', 'nastere', 'nasterii', 'born', 'birth']],
  ],
  '@zi': [['birth_day', ['nascut', 'nascuta', 'nastere', 'nasterii', 'born', 'birth']], ['today_day', ['data', 'date', 'azi', 'astazi', 'today', 'semnatura']]],
  '@luna': [['birth_month', ['nascut', 'nascuta', 'nastere', 'nasterii', 'born', 'birth']], ['today_month', ['data', 'date', 'azi', 'astazi', 'today', 'semnatura']]],
  '@an': [['class_grade', ['student', 'studenta', 'studentul', 'studentei', 'facultatii', 'facultatea', 'studii', 'specializarea', 'elev', 'eleva', 'elevul']], ['birth_year', ['nascut', 'nascuta', 'nastere', 'nasterii', 'born', 'birth']], ['today_year', ['data', 'date', 'azi', 'astazi', 'today', 'semnatura']]],
  '@seria': [
    ['id_series', ['ci', 'bi', 'buletin', 'buletinul', 'act', 'actul', 'identitate', 'pasaport', 'legitimat', 'legitimata', 'posesor', 'posesoare', 'cartea', 'carte', 'carnet']],
    ['study_group', ['anul', 'an', 'specializarea', 'grupa', 'student', 'studenta', 'facultatea', 'facultatii', 'licenta', 'master', 'programul', 'studiu', 'studii']],
  ],
  '@in': [
    ['birth_place', ['nascut', 'nascuta', 'nastere']],
    ['address', ['domiciliat', 'domiciliata', 'domiciliul', 'locuiesc', 'locuieste', 'resedinta']],
  ],
};

const OTHER_PERSON = / (parintilor|parintelui|tatalui|mamei|copilului|copiilor|copil|minorului|minorilor|sotului|sotiei|sotul|sotia|reprezentantului|reprezentant|reprezentata prin|reprezentat prin|imputernicitului|imputernicit|mandatarului|tutorelui|decedatului|defunctului|requester s|requester|spouse s|spouse|child s|children|parent s|parents|guardian s|guardian|agent s|employer s|beneficiarului|father s|mother s|father|mother|parent 1|parent 2|partner s|tatalui|mamei) /;

// Build the matcher list for a vault (defaults + your custom fields)
function compileFields(vault) {
  const list = [...FIELD_DEFS, ...SPECIAL_FIELDS, ...AMBIGUOUS].map((f) => ({ key: f.key, synN: f.syn.map(norm) }));
  // wordings you taught it by correcting a blank
  for (const l of vault?.learned || []) list.push({ key: l.key, synN: [l.phrase] });
  // your extra fields: their name and aliases, plus the same words in the other language
  for (const c of vault?.custom || []) {
    const syn = [c.label, ...(c.aliases || '').split(',')].map(norm).filter(Boolean);
    for (const x of [...syn]) {
      const t = translatePhrase(x);
      if (!t) continue;
      // "scholarship type" -> "bursa tip" and "tip bursa": Romanian often puts the words the other way round
      for (const v of [t, t.split(' ').reverse().join(' ')]) if (!syn.includes(v)) syn.push(v);
    }
    list.push({ key: c.key, synN: syn, custom: true });
  }
  for (const f of list) f.synS = f.synN.map(stemPhrase);
  return list;
}

// A light Romanian stemmer: "facultății" -> "facultat", "domiciliului" -> "domicili", "studenta" -> "student"
const RO_SUFFIXES = ['urilor', 'iilor', 'ilor', 'elor', 'ului', 'atii', 'atea', 'urile', 'uri', 'ul', 'ua', 'lor', 'iu', 'ii', 'ei', 'ea', 'ia', 'le', 'ie', 'a', 'e', 'i', 'u'];
function stemWord(w) {
  if (w.length < 6 || /\d/.test(w)) return w; // short words stay whole ("state" is not "stat")
  for (const suf of RO_SUFFIXES) if (w.endsWith(suf) && w.length - suf.length >= 4) return w.slice(0, -suf.length);
  return w;
}
function stemPhrase(s) { return String(s).split(' ').filter(Boolean).map(stemWord).join(' '); }

// Romanian <-> English words found on forms (to match your extra fields in either language)
const RO_EN = {
  nume: 'name', prenume: 'first name', numar: 'number', nr: 'no', data: 'date', adresa: 'address', telefon: 'phone', cod: 'code',
  oras: 'city', localitate: 'city', judet: 'county', tara: 'country', scoala: 'school', liceu: 'high school', facultate: 'faculty', facultatea: 'faculty',
  universitate: 'university', an: 'year', anul: 'year', clasa: 'class', grupa: 'group', specializare: 'specialization', program: 'programme',
  studii: 'studies', profesor: 'teacher', coordonator: 'coordinator', indrumator: 'supervisor', echipa: 'team', club: 'club', firma: 'company',
  societate: 'company', functie: 'position', functia: 'position', salariu: 'salary', venit: 'income', masina: 'car', auto: 'car',
  inmatriculare: 'registration', permis: 'licence', conducere: 'driving', pasaport: 'passport', grupa_sanguina: 'blood type', sange: 'blood',
  alergii: 'allergies', medic: 'doctor', asigurare: 'insurance', contract: 'contract', cont: 'account', banca: 'bank', sot: 'husband',
  sotie: 'wife', parinte: 'parent', mama: 'mother', tata: 'father', frate: 'brother', sora: 'sister', varsta: 'age', inaltime: 'height',
  greutate: 'weight', marime: 'size', olimpiada: 'olympiad', concurs: 'competition', premiu: 'prize', medie: 'average', media: 'average',
  nota: 'grade', matricol: 'registration number', legitimatie: 'card', camera: 'room', camin: 'dormitory', bursa: 'scholarship',
  limba: 'language', nationalitate: 'nationality', religie: 'religion', profesie: 'profession', ocupatie: 'occupation', angajator: 'employer',
  site: 'website', utilizator: 'username', parola: 'password', semnatura: 'signature', serie: 'series', seria: 'series', titlu: 'title',
  lucrare: 'paper', tema: 'topic', proiect: 'project', mentor: 'mentor', categorie: 'category', disciplina: 'subject', materie: 'subject',
  rezultat: 'result', punctaj: 'score', loc: 'place', nivel: 'level', experienta: 'experience', competente: 'skills', hobby: 'hobby',
  contact: 'contact', urgenta: 'emergency', persoana: 'person', tip: 'type', tipul: 'type', student: 'student', coordonatorul: 'coordinator',
  marca: 'brand', model: 'model', culoare: 'colour', tricou: 't shirt', bluza: 'shirt', pantof: 'shoe', marimea: 'size', inregistrare: 'registration', echipament: 'equipment', masura: 'size', de: 'of', si: 'and', al: 'of', a: 'of',
};
const EN_RO = Object.fromEntries(Object.entries(RO_EN).filter(([k]) => !['de', 'si', 'al', 'a'].includes(k)).map(([r, e]) => [e, r.replace('_', ' ')]));
let RO_EN_STEM = null;
function translatePhrase(p) {
  if (!RO_EN_STEM) RO_EN_STEM = Object.fromEntries(Object.entries(RO_EN).map(([k, v]) => [stemWord(k), v]));
  const words = p.split(' ').filter(Boolean);
  const one = (w) => RO_EN[w] || RO_EN_STEM[stemWord(w)] || EN_RO[w];
  const out = words.map(one);
  return out.every(Boolean) ? out.join(' ').replace(/_/g, ' ') : null;
}

function lastWordIndex(hay, word) { return hay.lastIndexOf(' ' + word + ' '); }

// Which field does this label ask for? Returns a key or null.
// opts.window: text before the blank (gives context for "nr", "data")
// "previous names", "maiden name", "former address": not your current details
const NOT_CURRENT = / (previous|former|maiden|other names|alias|fost|anterior|anterioara|vechi|vechiul|vechea) /;
function classify(label, compiled, opts = {}) {
  // explanations in brackets must not outvote the label: "Current address (house number, street, town/city)"
  if (!opts._inner && /\([^)]{3,}\)/.test(label)) {
    const outside = String(label).replace(/\([^)]*\)/g, ' ');
    if (outside.replace(/[\s:.,;-]/g, '').length >= 3) {
      const k = classify(outside, compiled, { ...opts, _inner: true });
      if (k) return k;
    }
  }
  if (NOT_CURRENT.test(' ' + norm(label) + ' ')) { classify.lastGuess = false; return null; }
  const L = ' ' + norm(cleanLabel(label)) + ' ';
  if (!L.trim()) return null;
  const maxTail = opts.maxTail ?? 24;
  let best = null, second = null;
  // pass 1: exact words; pass 2: Romanian word stems ("facultății" = "facultatea", "domiciliului" = "domiciliul")
  let Lm = L;
  for (const pass of ['synN', 'synS']) {
  if (pass === 'synS') { if (best || opts.stem === false) break; Lm = ' ' + stemPhrase(L.trim()) + ' '; }
  for (const f of compiled) {
    for (const s of f[pass] || []) {
      if (!s) continue;
      const L = Lm;
      const idx = lastWordIndex(L, s);
      if (idx < 0) continue;
      const tail = L.length - (idx + s.length + 2);
      if (tail > maxTail) continue;
      // "Label:" lines: the field word must open the label ("Data:", not "poate fi dată:")
      if (opts.maxLead != null && L.slice(0, idx).trim().split(' ').filter(Boolean).length > opts.maxLead) continue;
      const score = s.length * 2 - tail * 6; // the word closest to the blank matters most
      if (!best || score > best.score) { if (best && best.key[0] !== '@') second = best; best = { key: f.key, syn: s, score, tail }; }
      else if (f.key[0] !== '@' && (!second || score > second.score)) second = { key: f.key, syn: s, score, tail };
    }
  }
  }
  classify.lastGuess = false;
  if (best) {
    const L = Lm;
    const after = L.slice(L.lastIndexOf(' ' + best.syn + ' ') + best.syn.length + 1) + ' ';
    // "prenumele părinţilor", "Requester's name": asks about someone else
    const at = L.lastIndexOf(' ' + best.syn + ' ');
    const before = ' ' + L.slice(Math.max(0, at - 25), at) + ' ';
    if ((OTHER_PERSON.test(after) || OTHER_PERSON.test(before)) && !/^(father_name|mother_name)$/.test(best.key)) return null;
    // in Romanian "date" means data ("următoarele date"); as an English label it comes first ("Date:", "Date signed")
    if (best.syn === 'date' && L.trim().split(' ').indexOf('date') > 1) return null;
  }
  if (!best) {
    // nothing matched exactly: try similarity (typos, scan misreads, other languages)
    if (opts.fuzzy === false || typeof fuzzyClassify !== 'function') return null;
    const g = fuzzyClassify(label, compiled, opts.fuzzyMin ?? 0.7);
    if (!g) return null;
    classify.lastGuess = true;
    return g.key;
  }
  // a rule hit followed by other words ("Date de naissance", "Numele si prenumel") may really be
  // a longer phrase that only similarity recognises
  if (best.tail >= 4 && opts.fuzzy !== false && typeof fuzzyClassify === 'function') {
    const g = fuzzyClassify(label, compiled, 0.82);
    if (g && g.key !== best.key && g.phrase.length > best.syn.length + 2) { classify.lastGuess = true; return g.key; }
  }
  if (best.key[0] !== '@') return best.key;

  if (best.key === '@nume') return opts.docHasPrenume ? 'last_name' : 'full_name';
  const ctxAll = ' ' + norm(cleanLabel(opts.window ?? label)) + ' ';
  const cut = ctxAll.lastIndexOf(' ' + best.syn + ' ');
  const ctx = ctxAll.slice(Math.max(0, cut - 70), cut + 1);
  let pick = null, pickAt = -1;
  for (const [key, words] of AMBIG_CONTEXT[best.key]) {
    for (const w of words) {
      const i = lastWordIndex(ctx, w);
      if (i > pickAt) { pickAt = i; pick = key; }
    }
  }
  if (pick) return pick;
  // "Date of loss", "Date of marriage": some other date, not today
  if (best.key === '@date' && / date of (?!(application|signing|signature|completion|submission|request|declaration|filling)\b)\w+/.test(' ' + norm(label) + ' ')) return null;
  if (best.key === '@date') return 'today';
  if (best.key === '@seria') return 'id_series';
  // "Telephone Number": the vague word lost its meaning, so the next best word decides
  return second && second.tail <= maxTail ? second.key : null;
}

function fieldLabel(key, vault) {
  const d = FIELD_DEFS.find((f) => f.key === key) || SPECIAL_FIELDS.find((f) => f.key === key);
  if (d) return d.label;
  const c = (vault?.custom || []).find((f) => f.key === key);
  return c ? c.label : key;
}

// key -> text value, including derived ones
// personId: another person stored in the vault (child, spouse…); default = you
function computeValues(vault, personId) {
  const person = personId && personId !== 'me' ? (vault?.people || []).find((p) => p.id === personId) : null;
  const v = { ...((person ? person.values : vault?.values) || {}) };
  if (!person) for (const c of vault?.custom || []) if (c.value) v[c.key] = c.value;
  for (const k of Object.keys(v)) if (typeof v[k] === 'string') v[k] = v[k].trim();
  const fmt = vault?.settings?.dateFormat;
  // A Romanian CNP holds sex and birth date: S YY MM DD …
  const cnp = /^([1-8])(\d\d)(\d\d)(\d\d)\d{6}$/.exec((v.cnp || '').replace(/\s/g, ''));
  if (cnp) {
    const cent = { 1: 1900, 2: 1900, 3: 1800, 4: 1800, 5: 2000, 6: 2000, 7: 1900, 8: 1900 }[cnp[1]];
    const d = new Date(cent + +cnp[2], +cnp[3] - 1, +cnp[4]);
    if (!v.birth_date && d.getDate() === +cnp[4]) v.birth_date = formatDate(d, fmt);
    if (!v.gender) v.gender = +cnp[1] % 2 ? 'M' : 'F';
  }
  if (!v.full_name && (v.first_name || v.last_name)) {
    const parts = vault?.settings?.nameOrder === 'last-first' ? [v.last_name, v.first_name] : [v.first_name, v.last_name];
    v.full_name = parts.filter(Boolean).join(' ');
  }
  // Pieces of dates: "ziua __ luna __ anul __"
  const bd = parseDate(v.birth_date);
  if (bd) {
    v.birth_day = String(bd.d).padStart(2, '0'); v.birth_month = String(bd.m).padStart(2, '0'); v.birth_year = String(bd.y);
    const now = new Date();
    let age = now.getFullYear() - bd.y;
    if (now.getMonth() + 1 < bd.m || (now.getMonth() + 1 === bd.m && now.getDate() < bd.d)) age--;
    if (age >= 0 && age < 130) v.age = String(age);
  }
  const t = new Date();
  // the academic year starts in autumn: Nov 2026 -> 2026-2027, Mar 2027 -> 2026-2027
  if (!v.academic_year) { const y0 = t.getMonth() >= 8 ? t.getFullYear() : t.getFullYear() - 1; v.academic_year = y0 + '-' + (y0 + 1); }
  const ay = /(\d{4})\D+(\d{2,4})/.exec(v.academic_year);
  if (ay) { v.academic_year_start = ay[1]; v.academic_year_end = ay[2].length === 2 ? ay[1].slice(0, 2) + ay[2] : ay[2]; }
  v.today_day = String(t.getDate()).padStart(2, '0'); v.today_month = String(t.getMonth() + 1).padStart(2, '0'); v.today_year = String(t.getFullYear());
  if (!v.address) {
    const parts = [];
    if (v.street) parts.push(/^(str|bd|b-dul|sos|calea|aleea|splaiul)\b/i.test(v.street) ? v.street : 'Str. ' + v.street);
    if (v.street_number) parts.push('nr. ' + v.street_number);
    if (v.building) parts.push('bl. ' + v.building);
    if (v.entrance) parts.push('sc. ' + v.entrance);
    if (v.floor) parts.push('et. ' + v.floor);
    if (v.apartment) parts.push('ap. ' + v.apartment);
    let a = parts.join(', ');
    const place = [v.city, v.sector ? 'Sector ' + v.sector : '', v.county ? 'jud. ' + v.county : ''].filter(Boolean).join(', ');
    if (place) a = a ? a + ', ' + place : place;
    if (a) v.address = a;
  }
  v.today = formatDate(new Date(), vault?.settings?.dateFormat);
  if (v.birth_place || v.birth_date) v.birth_place_date = [v.birth_place, v.birth_date].filter(Boolean).join(', ');
  if (vault?.signature && !person) v.signature = '✍︎ (your signature)';
  for (const k of Object.keys(v)) if (!v[k]) delete v[k];
  return v;
}

// "03.02.2001", "3/2/2001", "2001-02-03", "3 februarie 2001" -> {d, m, y}
const MONTHS = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'noi', 'dec'];
const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseDate(s) {
  if (!s) return null;
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s.trim());
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = /^(\d{1,2})[-./ ](\d{1,2})[-./ ](\d{4})$/.exec(s.trim());
  if (m) return { d: +m[1], m: +m[2], y: +m[3] };
  m = /^(\d{1,2})\s+([a-zăâîșț]+)\.?\s+(\d{4})$/i.exec(s.trim());
  if (m) {
    const w = norm(m[2]).slice(0, 3);
    const i = MONTHS.indexOf(w) >= 0 ? MONTHS.indexOf(w) : MONTHS_EN.indexOf(w);
    if (i >= 0) return { d: +m[1], m: i + 1, y: +m[3] };
  }
  return null;
}

// All choices for the "fill with" dropdowns
function allFieldOptions(vault) {
  const out = [];
  for (const [g, gl] of FIELD_GROUPS) {
    const items = g === 'custom'
      ? (vault?.custom || []).map((c) => ({ key: c.key, label: c.label }))
      : FIELD_DEFS.filter((f) => f.group === g).map((f) => ({ key: f.key, label: f.label }));
    if (items.length) out.push({ group: gl, items });
  }
  out.push({ group: 'Other', items: SPECIAL_FIELDS.map((f) => ({ key: f.key, label: f.label })) });
  return out;
}

// The words right before a blank, as a phrase to remember
function learnPhrase(label) {
  const t = norm(cleanLabel(String(label || '').split(/_{3,}|\.{4,}|\u2026|\t/).pop()));
  const w = t.split(' ').filter((x) => x && !/^\d+$/.test(x)).slice(-4);
  return w.join(' ');
}

const RELATIONS = [['child', 'Child · Copil'], ['spouse', 'Spouse · Soț/soție'], ['parent', 'Parent · Părinte'], ['other', 'Other person']];

// Shorter ways to write an address, longest first, for blanks with little room
function addressVariants(v) {
  const out = [v.address];
  const street = [v.street && (/^(str|bd|b-dul|sos|calea|aleea|splaiul)\b/i.test(v.street) ? v.street : 'Str. ' + v.street),
    v.street_number && 'nr. ' + v.street_number].filter(Boolean).join(' ');
  const flat = [v.building && 'bl. ' + v.building, v.entrance && 'sc. ' + v.entrance, v.floor && 'et. ' + v.floor, v.apartment && 'ap. ' + v.apartment].filter(Boolean).join(', ');
  const cityLong = v.city && v.sector ? v.city + ', Sector ' + v.sector : v.city;
  const city = v.city && v.sector ? v.city + ', S' + v.sector : v.city;
  out.push([street, flat, cityLong].filter(Boolean).join(', '));
  out.push([street, cityLong].filter(Boolean).join(', '));
  out.push([street, flat, city].filter(Boolean).join(', '));
  out.push([street, city].filter(Boolean).join(', '));
  out.push([street, v.city].filter(Boolean).join(', '));
  return [...new Set(out.filter(Boolean))];
}

// Romanian or English document? (diacritics and common words)
function detectLang(text) {
  const t = ' ' + String(text).toLowerCase() + ' ';
  const ro = (t.match(/[ăâîșțşţ]/g) || []).length + (t.match(/ (și|si|de|al|cu|pentru|în|subsemnatul|domiciliat|data|nume|prenume) /g) || []).length * 2;
  const en = (t.match(/ (the|of|and|your|name|date|address|please|signature|number|birth|surname) /g) || []).length * 2;
  return en > ro * 1.2 && en >= 4 ? 'en' : 'ro';
}

// Some values have to be in the document's language
const VALUE_WORDS = {
  citizenship: [['română', 'romana', 'roman', 'romanian'], ['moldovenească', 'moldoveneasca', 'moldovan'], ['maghiară', 'maghiara', 'hungarian'], ['germană', 'germana', 'german'], ['franceză', 'franceza', 'french'], ['italiană', 'italiana', 'italian'], ['spaniolă', 'spaniola', 'spanish'], ['britanică', 'britanica', 'british'], ['americană', 'americana', 'american']],
  country: [['România', 'romania'], ['Republica Moldova', 'moldova'], ['Ungaria', 'hungary'], ['Germania', 'germany'], ['Franța', 'franta', 'france'], ['Italia', 'italy'], ['Spania', 'spain'], ['Marea Britanie', 'regatul unit', 'united kingdom', 'uk'], ['Statele Unite', 'sua', 'usa', 'united states']],
  gender: [['M', 'masculin', 'm', 'male', 'barbat'], ['F', 'feminin', 'f', 'female', 'femeie']],
};
const VALUE_EN = { citizenship: ['Romanian', 'Moldovan', 'Hungarian', 'German', 'French', 'Italian', 'Spanish', 'British', 'American'],
  country: ['Romania', 'Moldova', 'Hungary', 'Germany', 'France', 'Italy', 'Spain', 'United Kingdom', 'United States'], gender: ['Male', 'Female'] };
const VALUE_RO = { citizenship: ['română', 'moldovenească', 'maghiară', 'germană', 'franceză', 'italiană', 'spaniolă', 'britanică', 'americană'],
  country: ['România', 'Republica Moldova', 'Ungaria', 'Germania', 'Franța', 'Italia', 'Spania', 'Marea Britanie', 'Statele Unite'], gender: ['Masculin', 'Feminin'] };
function translateValue(key, v, lang) {
  const groups = VALUE_WORDS[key];
  if (!groups || !lang || !v) return v;
  const n = norm(v);
  const i = groups.findIndex((g) => g.some((w) => norm(w) === n));
  if (i < 0) return v;
  if (key === 'gender' && v.length <= 1) return lang === 'en' ? ['M', 'F'][i] : v; // single letters stay as they are
  return (lang === 'en' ? VALUE_EN : VALUE_RO)[key][i];
}

function dropRepeatedWord(label, v) {
  const lw = norm(cleanLabel(String(label).split(/_{3,}|\.{4,}|\u2026|\t/).pop())).split(' ').filter(Boolean);
  while (lw.length && ['de', 'din', 'al', 'a', 'la', 'of', 'at'].includes(lw[lw.length - 1])) lw.pop();
  const last = lw[lw.length - 1];
  const parts = String(v).split(/\s+/);
  if (!last || parts.length < 2 || stemWord(norm(parts[0])) !== stemWord(last)) return v;
  parts.shift();
  if (['de', 'din', 'of'].includes(norm(parts[0])) && parts.length > 1) parts.shift();
  return parts.join(' ');
}
