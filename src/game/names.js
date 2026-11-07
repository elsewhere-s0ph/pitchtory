
/**
 * Pool di nomi per l'universo fittizio di Football Eleven.
 * Tono voluto: cognomi italiani rari ma reali + stranieri per una lega
 * moderna, club con la struttura dei club veri (prefisso societario +
 * toponimo + spesso anno di fondazione). Niente "Mario Rossi",
 * niente "Lupi Rossi".
 */

export const IT_FIRST = [
  'Aurelio', 'Nadir', 'Amaro', 'Pietro', 'Loris', 'Teodoro', 'Enzo', 'Ivo',
  'Mattia', 'Furio', 'Oreste', 'Dindo', 'Lino', 'Santo', 'Remo', 'Adriano',
  'Fosco', 'Nino', 'Davide', 'Tommaso', 'Emilio', 'Turi', 'Salvo', 'Bruno',
  'Aldo', 'Ottavio', 'Elia', 'Tancredi', 'Germano', 'Fiorenzo', 'Alceo',
  'Secondo', 'Orlando', 'Vittorio', 'Ippolito', 'Rinaldo',
]

export const IT_LAST = [
  'Squillaci', 'Boffadossi', 'Cuffari', 'Sferrazza', 'Malaspina', 'Vandelli',
  'Zannini', 'Colasanti', 'Prandoni', 'Taddei', 'Zampieri', 'Agnoli',
  'Frascà', 'Bertoldo', 'Comitini', 'Ardemagni', 'Caddeo', 'Pintore',
  'Addis', 'Milia', 'Sedda', 'Lubino', 'Feletti', 'Da Ros', 'Baradel',
  'Toffolutti', 'Pravisani', 'Collavoli', 'Sgarbossa', 'Zanette', 'Bortoli',
  'Vitturi', 'Piasentin', 'Colbacchini', 'Manfredini', 'Bertolaso', 'Chiocci',
  'Roversi', 'Sansovini', 'Cappelletti', 'Vangelisti', 'Tiberini', 'Occioni',
  'Bonaffè', 'Scalabrin', 'Morganti', 'Camedda', 'Fancello', 'Corrias',
  'Fois', 'Satta', 'Rizzello', 'Melis', 'Mureddu', 'Pili', 'Pinna', 'Atzori',
  'Puddu', 'Solinas', 'Piras', 'Marras', 'Licheri', 'Cadeddu', 'Zanolli',
  'Follis', 'Neretti', 'Giacomelli', 'Sartori', 'Berton', 'Saccon', 'Tormen',
  'Zanconato', 'Rebellato', 'Faraon', 'Passuello', 'Toffanin', 'Zappalà',
  'Gulotta', 'Ingrassia', 'Mangiapane', 'Bottino', 'Pumo', 'Sciarratta',
  'Anzalone', 'Balistreri', 'Peruzzi', 'Lumini',
]

/** Stranieri: una lega moderna è multiculturale. Quota ~35% della rosa. */
export const FOREIGN_POOLS = [
  {
    firsts: ['Idris', 'Kwadjo', 'Jari', 'Amadou', 'Seydou', 'Ismael', 'Ousmane', 'Yves', 'Aliou', 'Bakary'],
    lasts: ['Kebé', 'Okonkwo', 'Mensah', 'Diallo', 'Traoré', 'Ayité', 'Koné', 'Doumbia', 'Zaki', 'Samassi'],
  },
  {
    firsts: ['Vasilije', 'Luka', 'Milos', 'Andrej', 'Nikola', 'Dragan', 'Zoran', 'Emir'],
    lasts: ['Vlaovic', 'Radovan', 'Perisin', 'Jovanic', 'Maric', 'Tomljanovic', 'Vukov', 'Kulenovic'],
  },
  {
    firsts: ['Andres', 'Facundo', 'Thiago', 'Matias', 'Bruno', 'Emiliano', 'Joaquin', 'Lautaro'],
    lasts: ['Quiroga', 'Almada', 'Bustamante', 'Ferreira', 'Zeballos', 'Cavagnaro', 'Roldan', 'Villalba', 'Arias', 'Palacios'],
  },
  {
    firsts: ['Corentin', 'Lucas', 'Theo', 'Iker', 'Unai', 'Jules', 'Guillaume'],
    lasts: ['Lavergne', 'Combe', 'Marchal', 'Arrieta', 'Quintana', 'Belando', 'Zorita', 'Sablé'],
  },
  {
    firsts: ['Emil', 'Henrik', 'Sondre', 'Jesper', 'Mikkel'],
    lasts: ['Bergklev', 'Sandmo', 'Qvist', 'Halvorsen', 'Lindqvist', 'Nordheim'],
  },
]

/** Toponimi fittizi per i 12 club generati (gli altri 8 sono a mano). */
export const TOPONYMS = [
  'Torlanieri', 'Breganzza', 'Cimazio', 'Sordalo', 'Valsorda', 'Roncale',
  'Montalino', 'Cavaioni', 'Travasona', 'Carvasa', 'Pertegada', 'Ricaldone',
]

/** Toponimi della serie cadetta: l'Abnegazione ha i suoi paesi. */
export const TOPONYMS_CADETTE = [
  'Valbrina', 'Cisogna', 'Montepesco', 'Salvarezza', 'Collefitto', 'Pratale',
  'Rivarotta', 'Camurana', 'Ossella', 'Trecosta', 'Vignalunga', 'Perticana',
]

/** {T} = toponimo, {Y} = anno di fondazione (opzionale). */
export const CLUB_PATTERNS = [
  'AC {T}{Y}', 'SS {T}', 'US {T}', 'FC {T}', 'Fortitudo {T}',
  'Virtus {T}', 'Audax {T}', 'Pro {T}', 'Città di {T}', '{T} Calcio',
]

export const COLOR_PAIRS = [
  { name: 'granata e blu', primary: '#7c2d3e', secondary: '#1d2b53' },
  { name: 'neroazzurro', primary: '#111827', secondary: '#2563eb' },
  { name: 'azzurro', primary: '#1d4ed8', secondary: '#f8fafc' },
  { name: 'giallorosso', primary: '#eab308', secondary: '#b91c1c' },
  { name: 'biancoceleste', primary: '#f8fafc', secondary: '#38bdf8' },
  { name: 'verde e bianco', primary: '#15803d', secondary: '#f8fafc' },
  { name: 'viola', primary: '#6d28d9', secondary: '#f8fafc' },
  { name: 'arancio e nero', primary: '#ea580c', secondary: '#111827' },
  { name: 'rossoblù', primary: '#dc2626', secondary: '#1e40af' },
  { name: 'bianconero', primary: '#f8fafc', secondary: '#111827' },
  { name: 'celeste', primary: '#38bdf8', secondary: '#0c4a6e' },
  { name: 'gialloblù', primary: '#facc15', secondary: '#1e3a8a' },
]

/** Soprannomi da mestiere, come nella tradizione delle piccole società. */
export const TRADE_NICKS = [
  'i minatori', 'i fabbri', 'le vespe', 'i cavallari', 'i pastori',
  'i conciatori', 'i mugnai', 'i ferrovieri', 'i marinai', 'i vetrai',
  'i cartai', 'i boscaioli', 'i muratori', 'i tessitori', 'i bottai', 'i salinari',
]

/** Nomí per gli stadi intitolati (più il "Comunale"). */
export const STADIUM_NAMES = [
  'Luigi Bellandi', 'Ferruccio Boscain', 'Adelina Carminati', 'Giacomo Rubesa',
  'Arduino Pezzotta', 'Otello Vantaggiato', 'Italo Brandolin', 'Secondo Malabaila',
]

/** Gli 8 club validati a mano, con la loro storia. */
export const FIXED_CLUBS = [
  { name: 'AC Velmare 1906', city: 'Velmare', founded: 1906, nickname: 'i portuali', colorPair: 'granata e blu', stadiumName: 'Arena del Sale' },
  { name: 'Fortitudo Claverna', city: 'Claverna', founded: 1901, nickname: 'i fonditori', colorPair: 'neroazzurro', stadiumName: null },
  { name: 'Petrazza Calcio', city: 'Petrazza', founded: 1924, nickname: 'i carrettieri', colorPair: 'azzurro', stadiumName: 'Stadio Luigi Bellandi' },
  { name: 'Virtus Rioverde 1927', city: 'Rioverde', founded: 1927, nickname: 'i giardinieri', colorPair: 'biancoceleste', stadiumName: null },
  { name: 'Audax Marnia 1920', city: 'Marnia', founded: 1920, nickname: 'i mugnai', colorPair: 'viola', stadiumName: null },
  { name: 'Delfino Arzavola', city: 'Arzavola', founded: 1932, nickname: 'i marinai', colorPair: 'celeste', stadiumName: null },
  { name: 'Pro Vergantia 1898', city: 'Vergantia', founded: 1898, nickname: 'i tessitori', colorPair: 'bianconero', stadiumName: 'Velodromo Piave' },
  { name: 'SS Pietrafesa', city: 'Pietrafesa', founded: 1936, nickname: 'i minatori', colorPair: 'rossoblù', stadiumName: null },
]

/** Gli 8 club validati della serie cadetta, con una storia tutta loro. */
export const FIXED_CLUBS_CADETTE = [
  { name: 'Sporting Valmerla 1922', city: 'Valmerla', founded: 1922, nickname: 'i canestrai', colorPair: 'giallorosso', stadiumName: null },
  { name: 'Audax Petrarossa 1913', city: 'Petrarossa', founded: 1913, nickname: 'i tagliapietre', colorPair: 'arancio e nero', stadiumName: null },
  { name: 'Pro Litornese 1927', city: 'Litorno', founded: 1927, nickname: 'i barcaioli', colorPair: 'verde e bianco', stadiumName: null },
  { name: 'Virtus Cavarnina 1918', city: 'Cavarnina', founded: 1918, nickname: 'i segantini', colorPair: 'viola', stadiumName: null },
  { name: 'Fiamma Ostricana 1924', city: 'Ostrica', founded: 1924, nickname: 'i vetrai', colorPair: 'gialloblù', stadiumName: null },
  { name: 'USD Dossarese 1920', city: 'Dossara', founded: 1920, nickname: 'i cavallari', colorPair: 'granata e blu', stadiumName: null },
  { name: 'AC Malveglia 1915', city: 'Malveglia', founded: 1915, nickname: 'i conciatori', colorPair: 'azzurro', stadiumName: null },
  { name: 'SS Rivorotonda 1926', city: 'Rivorotonda', founded: 1926, nickname: 'i fornaciai', colorPair: 'bianconero', stadiumName: null },
]
