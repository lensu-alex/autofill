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
  { key: 'first_name', group: 'identity', label: 'First name · Prenume', syn: ['prenume', 'prenumele', 'first name', 'given name', 'given names', 'firstname', 'forename', 'prenom'] },
  { key: 'full_name', group: 'identity', label: 'Full name · Nume și prenume', hint: 'empty = first + last name', syn: ['nume si prenume', 'numele si prenumele', 'nume de familie si prenume', 'numele de familie si prenumele', 'numele si prenumele complet', 'nume prenume', 'numele complet', 'nume complet', 'full name', 'name', 'name and surname', 'your name', 'applicant name', 'subsemnatul', 'subsemnata', 'subsemnatii', 'undersigned', 'titular', 'titularul', 'solicitant', 'solicitantul', 'eu', 'i the undersigned', 'elevul', 'eleva', 'studentul', 'studenta', 'candidatul', 'candidata'] },
  { key: 'cnp', group: 'identity', label: 'CNP / personal number', syn: ['cnp', 'c n p', 'cod numeric personal', 'codul numeric personal', 'personal numeric code', 'personal identification number', 'national id number', 'pin'] },
  { key: 'birth_date', group: 'identity', label: 'Date of birth · Data nașterii', syn: ['data nasterii', 'data de nastere', 'nascut la data de', 'nascuta la data de', 'nascut la', 'nascuta la', 'date of birth', 'birth date', 'birthdate', 'dob', 'born on'] },
  { key: 'birth_place', group: 'identity', label: 'Place of birth · Locul nașterii', syn: ['locul nasterii', 'loc nastere', 'locul de nastere', 'nascut in', 'nascuta in', 'place of birth', 'birthplace', 'born in'] },
  { key: 'gender', group: 'identity', label: 'Sex / gender', syn: ['sex', 'sexul', 'gender'] },
  { key: 'citizenship', group: 'identity', label: 'Citizenship · Cetățenie', syn: ['cetatenie', 'cetatenia', 'cetatean', 'nationalitate', 'nationalitatea', 'citizenship', 'nationality'] },
  { key: 'father_name', group: 'identity', label: "Father's first name · Tatăl", syn: ['fiul lui', 'fiica lui', 'numele tatalui', 'prenumele tatalui', 'tatal', 'father s name', 'fathers name', 'father name', 'father'] },
  { key: 'mother_name', group: 'identity', label: "Mother's first name · Mama", syn: ['si al', 'numele mamei', 'prenumele mamei', 'mama', 'mother s name', 'mothers name', 'mother name', 'mother'] },

  { key: 'id_series', group: 'id', label: 'ID series · Seria', syn: ['seria', 'serie', 'seria ci', 'seria bi', 'ci seria', 'bi seria', 'id series'] },
  { key: 'id_number', group: 'id', label: 'ID number · Număr', syn: ['numar ci', 'nr ci', 'numarul ci', 'passport number', 'passport no', 'document number', 'numar document', 'nr document', 'numar pasaport', 'nr pasaport', 'id card number', 'id number', 'id no'] },
  { key: 'id_issued_by', group: 'id', label: 'Issued by · Eliberat de', syn: ['eliberat de', 'eliberata de', 'emis de', 'emisa de', 'issued by', 'issuing authority', 'autoritatea emitenta'] },
  { key: 'id_issue_date', group: 'id', label: 'Issue date · Data eliberării', syn: ['data eliberarii', 'eliberat la data de', 'eliberat la data', 'date of issue', 'issue date', 'issued on'] },
  { key: 'id_expiry_date', group: 'id', label: 'Valid until · Valabil până la', syn: ['valabil pana la', 'valabila pana la', 'data expirarii', 'expiry date', 'expiration date', 'valid until', 'date of expiry'] },

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
  { key: 'school', group: 'work', label: 'School / university · Școala', syn: ['unitatea de invatamant', 'scoala', 'liceul', 'colegiul', 'facultatea', 'universitatea', 'universitate', 'institutia de invatamant', 'school', 'university', 'college', 'faculty', 'institution'] },
  { key: 'class_grade', group: 'work', label: 'Class / year · Clasa / anul', syn: ['clasa', 'class', 'grade', 'anul de studiu', 'an de studiu', 'year of study', 'grupa'] },
  { key: 'student_id', group: 'work', label: 'Student ID · Nr. matricol', syn: ['numar matricol', 'nr matricol', 'matricol', 'student id', 'student number'] },

  { key: 'iban', group: 'bank', label: 'IBAN', syn: ['iban', 'cont iban', 'cod iban', 'cont bancar', 'contul', 'bank account', 'account number', 'cont'] },
  { key: 'bank', group: 'bank', label: 'Bank · Banca', syn: ['banca', 'deschis la', 'bank', 'bank name'] },
];

// Not stored: filled automatically
const SPECIAL_FIELDS = [
  { key: 'today', label: "Today's date", syn: ['data completarii', 'data semnarii', 'today', 'today s date'] },
  { key: 'birth_place_date', label: 'Place and date of birth', syn: ['locul si data nasterii', 'data si locul nasterii', 'locul si data de nastere', 'data si locul de nastere', 'place and date of birth', 'date and place of birth'] },
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
  '@an': [['birth_year', ['nascut', 'nascuta', 'nastere', 'nasterii', 'born', 'birth']], ['today_year', ['data', 'date', 'azi', 'astazi', 'today', 'semnatura']]],
  '@in': [
    ['birth_place', ['nascut', 'nascuta', 'nastere']],
    ['address', ['domiciliat', 'domiciliata', 'domiciliul', 'locuiesc', 'locuieste', 'resedinta']],
  ],
};

const OTHER_PERSON = / (parintilor|parintelui|tatalui|mamei|copilului|copiilor|copil|minorului|minorilor|sotului|sotiei|sotul|sotia|reprezentantului|reprezentant|reprezentata prin|reprezentat prin|imputernicitului|imputernicit|mandatarului|tutorelui|decedatului|defunctului|requester s|requester|spouse s|spouse|child s|children|parent s|parents|guardian s|guardian|agent s|employer s|beneficiarului) /;

// Build the matcher list for a vault (defaults + your custom fields)
function compileFields(vault) {
  const list = [...FIELD_DEFS, ...SPECIAL_FIELDS, ...AMBIGUOUS].map((f) => ({ key: f.key, synN: f.syn.map(norm) }));
  // wordings you taught it by correcting a blank
  for (const l of vault?.learned || []) list.push({ key: l.key, synN: [l.phrase] });
  for (const c of vault?.custom || []) {
    const syn = [c.label, ...(c.aliases || '').split(',')].map(norm).filter(Boolean);
    list.push({ key: c.key, synN: syn });
  }
  return list;
}

function lastWordIndex(hay, word) { return hay.lastIndexOf(' ' + word + ' '); }

// Which field does this label ask for? Returns a key or null.
// opts.window: text before the blank (gives context for "nr", "data")
function classify(label, compiled, opts = {}) {
  const L = ' ' + norm(cleanLabel(label)) + ' ';
  if (!L.trim()) return null;
  const maxTail = opts.maxTail ?? 24;
  let best = null, second = null;
  for (const f of compiled) {
    for (const s of f.synN) {
      if (!s) continue;
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
  classify.lastGuess = false;
  if (best) {
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
  if (best.key === '@date') return 'today';
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
