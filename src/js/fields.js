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
  { key: 'full_name', group: 'identity', label: 'Full name · Nume și prenume', hint: 'empty = first + last name', syn: ['nume si prenume', 'numele si prenumele', 'nume prenume', 'numele complet', 'nume complet', 'full name', 'name', 'name and surname', 'your name', 'applicant name', 'subsemnatul', 'subsemnata', 'subsemnatii', 'undersigned', 'titular', 'titularul', 'solicitant', 'solicitantul', 'eu', 'i', 'elevul', 'eleva', 'studentul', 'studenta', 'candidatul', 'candidata'] },
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
  { key: 'city', group: 'address', label: 'City · Localitatea', syn: ['localitatea', 'localitate', 'orasul', 'oras', 'municipiul', 'comuna', 'satul', 'city', 'town', 'locality', 'town city'] },
  { key: 'sector', group: 'address', label: 'Sector', syn: ['sectorul', 'sector'] },
  { key: 'county', group: 'address', label: 'County · Județ', syn: ['judetul', 'judet', 'jud', 'county', 'state', 'province', 'region'] },
  { key: 'postal_code', group: 'address', label: 'Postal code · Cod poștal', syn: ['cod postal', 'codul postal', 'postal code', 'zip code', 'zip', 'postcode'] },
  { key: 'country', group: 'address', label: 'Country · Țara', syn: ['tara', 'country'] },
  { key: 'address', group: 'address', label: 'Full address · Domiciliul', hint: 'empty = built from the parts above', syn: ['domiciliul', 'domiciliat in', 'domiciliata in', 'domiciliat', 'domiciliata', 'cu domiciliul in', 'cu domiciliul', 'domiciliu', 'adresa', 'adresa de domiciliu', 'adresa completa', 'resedinta', 'address', 'home address', 'residing at', 'residing in', 'residence', 'living at'] },

  { key: 'phone', group: 'contact', label: 'Phone · Telefon', syn: ['telefon', 'tel', 'nr telefon', 'numar de telefon', 'numar telefon', 'telefon mobil', 'mobil', 'phone', 'phone number', 'telephone', 'mobile', 'mobile number', 'cell'] },
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
  { key: 'signature', label: '✍︎ Signature', syn: ['semnatura', 'semnatura solicitantului', 'semnatura titularului', 'semnatura elevului', 'semnatura studentului', 'semnatura candidatului', 'semnatura mea', 'signature', 'signed', 'sign here', 'applicant signature', 'applicant s signature', 'semnat'] },
];

// Words whose meaning depends on what comes before them
const AMBIGUOUS = [
  { key: '@nr', syn: ['nr', 'numar', 'numarul', 'no', 'number'] },
  { key: '@date', syn: ['data', 'date', 'la data de', 'la data', 'din data de', 'pe data de', 'in data de', 'data de'] },
  { key: '@nume', syn: ['nume', 'numele'] },
  { key: '@in', syn: ['in'] },
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
  '@in': [
    ['birth_place', ['nascut', 'nascuta', 'nastere']],
    ['address', ['domiciliat', 'domiciliata', 'domiciliul', 'locuiesc', 'locuieste', 'resedinta']],
  ],
};

// Build the matcher list for a vault (defaults + your custom fields)
function compileFields(vault) {
  const list = [...FIELD_DEFS, ...SPECIAL_FIELDS, ...AMBIGUOUS].map((f) => ({ key: f.key, synN: f.syn.map(norm) }));
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
  let best = null;
  for (const f of compiled) {
    for (const s of f.synN) {
      if (!s) continue;
      const idx = lastWordIndex(L, s);
      if (idx < 0) continue;
      const tail = L.length - (idx + s.length + 2);
      if (tail > maxTail) continue;
      const score = s.length * 2 - tail * 3;
      if (!best || score > best.score) best = { key: f.key, syn: s, score };
    }
  }
  if (!best) return null;
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
  return best.key === '@date' ? 'today' : null;
}

function fieldLabel(key, vault) {
  const d = FIELD_DEFS.find((f) => f.key === key) || SPECIAL_FIELDS.find((f) => f.key === key);
  if (d) return d.label;
  const c = (vault?.custom || []).find((f) => f.key === key);
  return c ? c.label : key;
}

// key -> text value, including derived ones
function computeValues(vault) {
  const v = { ...(vault?.values || {}) };
  for (const c of vault?.custom || []) if (c.value) v[c.key] = c.value;
  for (const k of Object.keys(v)) if (typeof v[k] === 'string') v[k] = v[k].trim();
  if (!v.full_name && (v.first_name || v.last_name)) v.full_name = [v.first_name, v.last_name].filter(Boolean).join(' ');
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
  if (vault?.signature) v.signature = '✍︎ (your signature)';
  for (const k of Object.keys(v)) if (!v[k]) delete v[k];
  return v;
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
