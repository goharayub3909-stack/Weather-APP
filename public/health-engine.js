// Health, wellness & environmental disease intelligence engine for Pakistan.
//
// SCREENING ONLY. Each module checks whether published weather / environment
// conditions associated with a health or crop-pest risk are present. It does not
// diagnose illness, predict cases, or replace official advisories (NIH, provincial
// health departments, PDMA, Department of Plant Protection, agriculture extension).
//
// Rules shared with the rest of this site:
//  - missing or invalid values are never zero-filled; they make a module
//    'partial' or 'unavailable' (level UNKNOWN), never LOW
//  - timestamps need an explicit UTC offset; all clock rules use Pakistan time (UTC+5)
//  - thresholds live in CONFIG so they can be calibrated locally

const finite = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const HOUR = 3600000, DAY = 24 * HOUR, PKT_OFFSET = 5 * HOUR;

export const SCHEMA_VERSION = 1;
export const LEVELS = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

/** Tunable thresholds. Values marked "user spec" came from the project brief; others are engineering defaults to calibrate. */
export const CONFIG = {
  staleHours: 3,
  history_hours: 72,
  dengue: { temp: [25, 30], tempTol: 5, rh: 75, rhTol: 15, wetMm: 1, wetTol: 5, eipTemp: 28, eipHours: 48, eipMinCoverage: 0.9, biteWindows: [[6, 9], [16.5, 18.5]] },
  malaria: { nightStart: 21, nightEnd: 5, tempLow: [20, 28], tempTol: 5, rh: 70, rhTol: 15, minBins: 5 },
  locust: { soilMoisture: 60, moistTol: 20, soilTemp: [25, 35], soilTempTol: 5, wetMm: 1, wetTol: 5 },
  rust: { nightTemp: [8, 13], tempTol: 4, rh: 85, rhTol: 15, runHours: 6, nightFrom: 19, nightTo: 7, lookbackHours: 24, months: [11, 12, 1, 2, 3, 4], minCoverage: 0.7 },
  cotton: { hotC: 38, hotHours: 6, hotTol: 6, rhDrop: 20, rhDropTol: 20, rhHigh: 60, rhDropWindowHours: 6, months: [9, 10, 11], lookbackHours: 24, minCoverage: 0.7 },
  migraine: { dropHpa: 3.0, tol: 3, windowHours: 3, lookbackHours: 12, minCoverage: 0.5 },
  arthritis: { dropHpa: 2.0, dropTol: 2, rh: 80, rhTol: 15, tempC: 18, tempTol: 6 },
  heat: { moderate: 25, high: 28, critical: 31 },
  smog: { pm25: 150, pm25Tol: 75, wind: 2, windTol: 2, moderatePm25: 75 },
  asthma: { dropC: 5, dropTol: 5, windowHours: 4, lookbackHours: 12, pm25: 75, pm25Tol: 40, rh: 80, rhTol: 15, minCoverage: 0.5 },
  flu: { rh: 40, rhTol: 20, tempC: 16, tempTol: 6 },
};

// Physically plausible ranges. Values outside become null and are reported as invalid.
const LIMITS = {
  temp_c: [-30, 60], rh: [0, 100], pressure_hpa: [500, 1100], pm25: [0, 1000], pm10: [0, 2000],
  wind_speed_ms: [0, 75], soil_moisture: [0, 100], soil_temp_c: [-10, 70], solar_wm2: [0, 1500],
  rain_acc_48h: [0, 1000], rain_acc_72h: [0, 1500],
};
const NUMERIC = Object.keys(LIMITS);

// ---------------------------------------------------------------- input handling

/** Parse an ISO 8601 stamp that carries an explicit offset. Returns ms or NaN. */
export function parseStamp(stamp) {
  if (typeof stamp !== 'string' || !/(?:Z|[+-]\d\d:?\d\d)$/.test(stamp)) return NaN;
  return Date.parse(stamp);
}

/** Calendar parts in Pakistan time (UTC+5, no daylight saving). */
export function pktParts(ms) {
  const d = new Date(ms + PKT_OFFSET);
  return { hour: d.getUTCHours() + d.getUTCMinutes() / 60, month: d.getUTCMonth() + 1, dayStart: Math.floor((ms + PKT_OFFSET) / DAY) * DAY - PKT_OFFSET };
}

/** Validate one sensor payload. Invalid values become null and are listed. */
export function normalizeSample(raw) {
  const t = parseStamp(raw?.timestamp);
  if (!finite(t)) return { ok: false, reason: 'timestamp needs an ISO 8601 stamp with an explicit UTC offset' };
  const s = { t }, invalid = [], missing = [];
  for (const key of NUMERIC) {
    const v = raw[key];
    if (v === undefined || v === null) { s[key] = null; missing.push(key); continue; }
    if (!finite(v) || v < LIMITS[key][0] || v > LIMITS[key][1]) { s[key] = null; invalid.push(key); continue; }
    s[key] = v;
  }
  s.vegetation_dry = typeof raw.vegetation_dry === 'boolean' ? raw.vegetation_dry : null;
  s.pm25_source = raw.pm25_source === 'model' ? 'model' : 'sensor';
  return { ok: true, sample: s, invalid, missing };
}

/** Clean history: valid, de-duplicated, ascending, no later than `now`, inside the look-back window. */
export function prepareSeries(current, history, now, hours) {
  const byTime = new Map();
  for (const raw of [...(Array.isArray(history) ? history : []), current]) {
    const n = normalizeSample(raw);
    if (n.ok && n.sample.t <= now && n.sample.t > now - hours * HOUR) byTime.set(n.sample.t, n.sample);
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** Average a series into fixed bins ending at `now`. Chronological; empty bins are null. */
export function bin(samples, now, hours, binMs, key) {
  const n = Math.round(hours * HOUR / binMs), acc = Array.from({ length: n }, () => null);
  for (const s of samples) {
    const v = s[key];
    if (!finite(v) || s.t > now) continue;
    const i = n - 1 - Math.floor((now - s.t) / binMs);
    if (i < 0 || i >= n) continue;
    const b = acc[i] ||= { sum: 0, n: 0, min: Infinity, max: -Infinity };
    b.sum += v; b.n++; b.min = Math.min(b.min, v); b.max = Math.max(b.max, v);
  }
  return acc.map((b, i) => b && { mean: b.sum / b.n, min: b.min, max: b.max, n: b.n, start: now - (n - i) * binMs });
}
const coverage = bins => bins.length ? bins.filter(Boolean).length / bins.length : 0;

/** Largest fall (earlier − later) between two bins at most `window` bins apart. */
export function largestDrop(bins, window) {
  let best = null;
  for (let j = 1; j < bins.length; j++) {
    if (!bins[j]) continue;
    for (let k = 1; k <= window && j - k >= 0; k++) {
      if (!bins[j - k]) continue;
      const drop = bins[j - k].mean - bins[j].mean;
      if (best === null || drop > best) best = drop;
    }
  }
  return best;
}

// ---------------------------------------------------------------- biometeorology maths

/** Saturation vapour pressure, hPa (Magnus form used in meteorology). */
export const saturationVapourPressure = t => 6.105 * Math.exp(17.27 * t / (237.7 + t));

/** Approximate shade/outdoor WBGT from air temperature and humidity (Australian Bureau of Meteorology form).
 *  This is an empirical approximation, not a globe-thermometer measurement. */
export function wbgtApprox(tempC, rh) {
  if (!finite(tempC) || !finite(rh)) return null;
  const e = rh / 100 * saturationVapourPressure(tempC);
  return 0.567 * tempC + 0.393 * e + 3.94;
}

/** NWS heat index (Rothfusz regression with standard adjustments), in °C. Below ~27 °C it equals air temperature. */
export function heatIndexC(tempC, rh) {
  if (!finite(tempC) || !finite(rh)) return null;
  const T = tempC * 9 / 5 + 32, R = rh;
  let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + R * 0.094);
  if ((hi + T) / 2 >= 80) {
    hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T - 0.05481717 * R * R + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    if (R < 13 && T >= 80 && T <= 112) hi -= (13 - R) / 4 * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    else if (R > 85 && T >= 80 && T <= 87) hi += (R - 85) / 10 * (87 - T) / 5;
  } else if (hi < 80) hi = T;
  return (hi - 32) * 5 / 9;
}

// ---------------------------------------------------------------- criterion scoring

// Closeness runs 0..1. A met criterion scores 0.75 at the threshold and rises to 1 with margin;
// an unmet one scores up to 0.75 when it is almost met, falling to 0 beyond `tol`.
const metScore = (margin01) => 0.75 + 0.25 * clamp(margin01, 0, 1);
const missScore = (gap, tol) => 0.75 * clamp(1 - gap / tol, 0, 1);
const unknown = () => ({ met: null, closeness: null });
function atLeast(x, t, tol, strict = false) {
  if (!finite(x)) return unknown();
  const met = strict ? x > t : x >= t;
  return { met, closeness: met ? metScore((x - t) / tol) : missScore(t - x, tol) };
}
function below(x, t, tol) {
  if (!finite(x)) return unknown();
  const met = x < t;
  return { met, closeness: met ? metScore((t - x) / tol) : missScore(x - t, tol) };
}
function within(x, lo, hi, tol) {
  if (!finite(x)) return unknown();
  const met = x >= lo && x <= hi, mid = (lo + hi) / 2, half = (hi - lo) / 2;
  return { met, closeness: met ? metScore(1 - Math.abs(x - mid) / half) : missScore(x < lo ? lo - x : x - hi, tol) };
}
const crit = (id, label, value, unit, rule, result, extra = {}) => ({ id, label, value: finite(value) ? Number(value.toFixed(2)) : value ?? null, unit, rule, met: result.met, closeness: result.closeness, ...extra });

/** Turn criteria into {score, level, status}. All required criteria met → HIGH. */
export function grade(criteria) {
  const known = criteria.filter(c => c.met !== null);
  if (!known.length) return { score: null, level: 'UNKNOWN', status: 'unavailable' };
  const score = Math.round(100 * known.reduce((a, c) => a + c.closeness, 0) / known.length);
  const missing = criteria.length - known.length, allMet = known.every(c => c.met);
  if (!missing) return { score, level: allMet ? 'HIGH' : score >= 50 ? 'MODERATE' : 'LOW', status: 'ok' };
  // Some inputs are unavailable: never claim HIGH, and never report LOW on the strength of unknowns alone.
  return { score, level: allMet ? 'MODERATE' : score >= 50 ? 'MODERATE' : 'LOW', status: 'partial' };
}
const raise = (level, n = 1) => level === 'UNKNOWN' ? level : LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(level) + n)];
const cap = (level, max) => level === 'UNKNOWN' || LEVELS.indexOf(level) <= LEVELS.indexOf(max) ? level : max;
const confidenceFrom = cov => cov >= 0.9 ? 'high' : cov >= 0.7 ? 'medium' : 'low';

// ---------------------------------------------------------------- bilingual text

const bi = (en, ur) => ({ en, ur });
export const TEXT = {
  dengue: {
    title: bi('Dengue & Chikungunya breeding risk', 'ڈینگی اور چکن گنیا کے مچھروں کی افزائش کا خطرہ'),
    warning: bi('Conditions favour Aedes aegypti breeding and biting', 'حالات ایڈیز ایجپٹائی مچھر کی افزائش اور کاٹنے کے لیے سازگار ہیں'),
    eip: bi('High Viral Transmission Potential', 'وائرس پھیلنے کا زیادہ امکان'),
    actions: [
      bi('Aedes aegypti breeds in clean standing water: empty or cover desert coolers, flower pots, rooftop tanks, tyres and buckets every 2–3 days.',
        'ڈینگی مچھر صاف کھڑے پانی میں پیدا ہوتا ہے۔ ہر 2 سے 3 دن بعد کولر، گملوں، ٹینکیوں، ٹائروں اور بالٹیوں کا پانی خالی کریں یا انہیں ڈھانپ دیں۔'),
      bi('Wear long sleeves and use repellent from 06:00–09:00 and 16:30–18:30 PKT, when these mosquitoes bite most.',
        'صبح 6 سے 9 بجے اور شام 4:30 سے 6:30 بجے مچھر زیادہ کاٹتے ہیں؛ اس وقت پوری آستین کے کپڑے پہنیں اور مچھر بھگانے والا لوشن لگائیں۔'),
      bi('Fit window screens. For high fever, severe headache, joint pain or bleeding see a doctor early and avoid aspirin or ibuprofen unless a doctor advises.',
        'کھڑکیوں پر جالی لگائیں۔ تیز بخار، شدید سر درد، جوڑوں کا درد یا خون آنے کی صورت میں جلد ڈاکٹر سے رجوع کریں؛ ڈاکٹر کے مشورے کے بغیر اسپرین یا آئبوپروفین نہ لیں۔'),
    ],
  },
  malaria: {
    title: bi('Malaria mosquito activity', 'ملیریا مچھروں کی سرگرمی'),
    warning: bi('Warm, humid nights favour malaria mosquito activity', 'گرم اور مرطوب راتیں ملیریا کے مچھروں کی سرگرمی کے لیے سازگار ہیں'),
    actions: [bi('Sleep under an insecticide-treated net or behind screens, use repellent from dusk to dawn, and clear stagnant water near the home. Get a malaria test for any fever after mosquito exposure.',
      'غروبِ آفتاب سے صبح تک مچھر دانی یا جالی استعمال کریں، مچھر بھگانے والا لوشن لگائیں اور گھر کے آس پاس کھڑا پانی ختم کریں۔ مچھر کاٹنے کے بعد بخار ہو تو ملیریا کا ٹیسٹ کروائیں۔')],
  },
  locust: {
    title: bi('Locust breeding risk', 'ٹڈی دل کی افزائش کا خطرہ'),
    warning: bi('Soil and rain conditions favour locust egg-laying and hopper survival', 'مٹی اور بارش کے حالات ٹڈی کے انڈے دینے اور بچوں کے بچاؤ کے لیے سازگار ہیں'),
    actions: [bi('Scout sandy, moist, thinly vegetated ground for egg pods and hoppers. Report any locusts to your agriculture extension office or the Department of Plant Protection, and do not spray without official guidance.',
      'ریتلی، نم اور کم سبزے والی زمین میں انڈوں کی تھیلیوں اور بچہ ٹڈیوں کا معائنہ کریں۔ کسی بھی ٹڈی کی اطلاع محکمہ زراعت (توسیع) یا ڈیپارٹمنٹ آف پلانٹ پروٹیکشن کو دیں اور سرکاری رہنمائی کے بغیر سپرے نہ کریں۔')],
  },
  rust: {
    title: bi('Wheat yellow (stripe) rust risk', 'گندم کی زرد کنگی کا خطرہ'),
    warning: bi('Cool, humid nights favour wheat yellow rust infection', 'ٹھنڈی اور مرطوب راتیں گندم کی زرد کنگی کے حملے کے لیے سازگار ہیں'),
    actions: [bi('Scout wheat every 3–4 days for yellow stripes on leaves, starting at field edges and low patches. If found, ask your agriculture extension office for the recommended fungicide and timing, and avoid excess nitrogen.',
      'ہر 3 سے 4 دن بعد گندم کے پتوں پر زرد دھاریوں کا معائنہ کریں، خصوصاً کھیت کے کناروں اور نشیبی حصوں میں۔ علامات ملیں تو محکمہ زراعت (توسیع) سے سفارش کردہ فنگس کش اور وقت معلوم کریں، اور نائٹروجن کھاد ضرورت سے زیادہ نہ ڈالیں۔')],
  },
  cotton: {
    title: bi('Cotton whitefly & pink bollworm stress', 'کپاس میں سفید مکھی اور گلابی سنڈی کا دباؤ'),
    warning: bi('Heat stress with sharp humidity drops: scout cotton for whitefly and pink bollworm', 'شدید گرمی اور نمی میں اچانک کمی: کپاس میں سفید مکھی اور گلابی سنڈی کا معائنہ کریں'),
    actions: [bi('Scout cotton at least twice a week: leaf undersides for whitefly, bolls and pheromone traps for pink bollworm. Follow extension economic thresholds and avoid needless spraying that kills natural enemies.',
      'کپاس کا ہفتے میں کم از کم دو بار معائنہ کریں: سفید مکھی کے لیے پتوں کی نچلی سطح اور گلابی سنڈی کے لیے ڈوڈیاں اور فیرومون ٹریپ۔ محکمہ زراعت کی مقرر کردہ معاشی حد کے مطابق عمل کریں اور غیر ضروری سپرے سے بچیں تاکہ مفید کیڑے محفوظ رہیں۔')],
  },
  migraine: {
    title: bi('Migraine pressure-change trigger', 'میگرین کا فضائی دباؤ محرک'),
    warning: bi('Rapid barometric fall: a common migraine trigger', 'فضائی دباؤ میں تیزی سے کمی: میگرین کا عام محرک'),
    actions: [bi('Drink water, keep meals and sleep regular, limit bright light and screens, and keep your prescribed medicine with you. Follow your doctor\'s plan.',
      'پانی پئیں، کھانے اور نیند کا وقت باقاعدہ رکھیں، تیز روشنی اور اسکرین کم کریں اور ڈاکٹر کی تجویز کردہ دوا ساتھ رکھیں۔ ڈاکٹر کے مشورے پر عمل کریں۔')],
  },
  arthritis: {
    title: bi('Arthritis & joint discomfort', 'گٹھیا اور جوڑوں کی تکلیف'),
    warning: bi('Falling pressure, damp and cold can aggravate joint pain', 'دباؤ میں کمی، نمی اور سردی جوڑوں کا درد بڑھا سکتی ہے'),
    actions: [bi('Keep joints warm, do gentle indoor movement and stretching, avoid cold damp exposure, and continue prescribed treatment.',
      'جوڑوں کو گرم رکھیں، گھر کے اندر ہلکی حرکت اور کھنچاؤ کی ورزش کریں، سرد اور نم ماحول سے بچیں اور تجویز کردہ علاج جاری رکھیں۔')],
  },
  heat: {
    title: bi('Heat stress (WBGT & heat index)', 'گرمی کا دباؤ (WBGT اور ہیٹ انڈیکس)'),
    moderate: bi('Heat stress building: take regular drinking and shade breaks', 'گرمی کا دباؤ بڑھ رہا ہے: باقاعدہ پانی اور سائے میں وقفے لیں'),
    high: bi('Dangerous heat stress for outdoor work', 'بیرونی کام کے لیے خطرناک گرمی کا دباؤ'),
    critical: bi('Extreme Danger: High Risk of Heat Stroke & Cardiac Stress', 'انتہائی خطرہ: لو لگنے اور دل پر دباؤ کا شدید خطرہ'),
    actions: [bi('Stop or reschedule heavy outdoor work, move to shade or a cooled space, drink water or ORS regularly (about a cup every 15–20 minutes while working), and check on colleagues. Confusion, fainting, hot dry skin or no sweating means heat stroke: cool the person with water and call Rescue 1122 or go to hospital at once.',
      'بھاری بیرونی کام روک دیں یا وقت بدلیں، سائے یا ٹھنڈی جگہ پر جائیں، پانی یا او آر ایس باقاعدگی سے پئیں (کام کے دوران تقریباً ہر 15 سے 20 منٹ میں ایک کپ) اور ساتھیوں کا خیال رکھیں۔ الجھن، بے ہوشی، گرم خشک جلد یا پسینہ بند ہونا لو لگنے کی علامت ہے: جسم کو پانی سے ٹھنڈا کریں اور فوراً ریسکیو 1122 کو بلائیں یا ہسپتال جائیں۔')],
  },
  smog: {
    title: bi('Smog & particulate exposure', 'اسموگ اور ذرّاتی آلودگی'),
    warning: bi('Heavy particulate pollution', 'ذرّاتی آلودگی کی شدید سطح'),
    critical: bi('Severe Temperature Inversion Smog: Toxic Particulate Trapping', 'شدید درجۂ حرارت الٹاؤ کی اسموگ: زہریلے ذرات کا جمع ہونا'),
    actions: [bi('Avoid outdoor exercise and work where possible. Wear a well-fitted N95/KN95 mask outdoors (cloth and surgical masks do little against PM2.5), keep windows closed and use an air purifier if you have one. Children, older people and those with asthma or heart disease should stay indoors.',
      'جہاں ممکن ہو باہر ورزش اور کام سے گریز کریں۔ باہر نکلتے وقت درست فٹنگ والا N95/KN95 ماسک پہنیں (کپڑے یا سرجیکل ماسک PM2.5 کے خلاف کم مؤثر ہیں)، کھڑکیاں بند رکھیں اور ممکن ہو تو ایئر پیوریفائر استعمال کریں۔ بچے، بزرگ اور دمہ یا دل کے مریض گھر کے اندر رہیں۔')],
  },
  asthma: {
    title: bi('Asthma & bronchospasm trigger', 'دمہ اور سانس کی نالیوں کے سکڑاؤ کا محرک'),
    warning: bi('Sudden cooling with polluted or humid air can trigger asthma', 'اچانک ٹھنڈک کے ساتھ آلودہ یا مرطوب ہوا دمے کا سبب بن سکتی ہے'),
    actions: [bi('Keep your reliever inhaler with you, follow your doctor\'s asthma action plan, avoid sudden cold air and outdoor exertion, and cover nose and mouth with a scarf or mask in cold or polluted air.',
      'ریلیور انہیلر ساتھ رکھیں، ڈاکٹر کے دمہ منصوبے پر عمل کریں، اچانک ٹھنڈی ہوا اور بیرونی مشقت سے بچیں اور ٹھنڈی یا آلودہ ہوا میں ناک اور منہ مفلر یا ماسک سے ڈھانپیں۔')],
  },
  flu: {
    title: bi('Influenza & RSV transmission window', 'نزلہ، فلو اور آر ایس وی کے پھیلاؤ کا موسم'),
    warning: bi('Cold, dry air: respiratory viruses survive longer in the air', 'سرد اور خشک ہوا: سانس کے وائرس ہوا میں زیادہ دیر زندہ رہتے ہیں'),
    actions: [bi('Ventilate rooms, use a humidifier or an open bowl of water to keep indoor humidity near 40–60%, wash hands, stay home when ill, and ask your doctor about the seasonal flu vaccine.',
      'کمروں میں تازہ ہوا کا انتظام کریں، گھر کے اندر نمی 40 سے 60 فیصد کے قریب رکھنے کے لیے ہیومیڈیفائر یا پانی کا کھلا برتن استعمال کریں، ہاتھ دھوئیں، بیمار ہوں تو گھر رہیں اور موسمی فلو ویکسین کے بارے میں ڈاکٹر سے پوچھیں۔')],
  },
};
const WATCH = bi('Watch: some trigger conditions are present', 'نگرانی کریں: کچھ محرک حالات موجود ہیں');
const CLEAR = bi('Trigger conditions are not met', 'محرک حالات موجود نہیں');
const UNKNOWN_TEXT = bi('Not enough valid sensor data to assess', 'جائزے کے لیے درست سینسر ڈیٹا ناکافی ہے');
const OUT_OF_SEASON = bi('Outside the usual crop season for this risk', 'اس خطرے کے عام فصلی موسم سے باہر');

function finish(id, ctx, graded, { criteria, label, status, confidence, metrics = {}, flags = {}, notes = [] }) {
  const t = TEXT[id], level = graded.level;
  const headline = label ?? (level === 'UNKNOWN' ? UNKNOWN_TEXT : level === 'LOW' ? CLEAR : level === 'MODERATE' ? WATCH : t.warning);
  const actionable = level === 'MODERATE' || level === 'HIGH' || level === 'CRITICAL';
  return {
    id, title: t.title, index_score: graded.score, level, status: status ?? graded.status, confidence,
    headline, criteria, metrics, flags, notes,
    actions: actionable ? t.actions : [],
  };
}

// ---------------------------------------------------------------- the eleven indices

function dengue(ctx) {
  const { cur, samples, now, pkt, cfg } = ctx, c = cfg.dengue;
  const wet = [cur.rain_acc_48h, cur.rain_acc_72h].filter(finite).length ? Math.max(...[cur.rain_acc_48h, cur.rain_acc_72h].filter(finite)) : null;
  const criteria = [
    crit('temp', 'Air temperature', cur.temp_c, '°C', '25–30 °C', within(cur.temp_c, c.temp[0], c.temp[1], c.tempTol)),
    crit('rh', 'Relative humidity', cur.rh, '%', '≥ 75 %', atLeast(cur.rh, c.rh, c.rhTol)),
    crit('wetness', 'Rain in the last 48–72 h', wet, 'mm', `≥ ${c.wetMm} mm`, atLeast(wet, c.wetMm, c.wetTol)),
  ];
  const g = grade(criteria);
  // Extrinsic-incubation accelerator: every hour of the last 48 h above 28 °C.
  const bins = bin(samples, now, c.eipHours, HOUR, 'temp_c'), cov = coverage(bins);
  const eip = cov >= c.eipMinCoverage ? bins.filter(Boolean).every(b => b.min > c.eipTemp) : null;
  let level = g.level, label;
  if (eip && level !== 'UNKNOWN') { level = raise(level); label = TEXT.dengue.eip; }
  const h = pkt.hour, inWindow = c.biteWindows.some(([a, b]) => h >= a && h < b);
  return finish('dengue', ctx, { ...g, level }, {
    criteria, label, confidence: g.status === 'ok' ? 'high' : 'medium',
    metrics: { temp_above_28c_hours_coverage: Number(cov.toFixed(2)) },
    flags: { high_viral_transmission_potential: eip, peak_biting_window_now: inWindow, peak_biting_windows_pkt: ['06:00–09:00', '16:30–18:30'] },
    notes: eip === null ? ['Less than 90% of the last 48 h of temperature is available, so the incubation accelerator was not evaluated.'] : [],
  });
}

function malaria(ctx) {
  const { samples, now, pkt, cfg } = ctx, c = cfg.malaria;
  // The latest 21:00–05:00 PKT night, in progress or just finished.
  const h = pkt.hour;
  const nightStart = h >= c.nightStart ? pkt.dayStart + c.nightStart * HOUR : pkt.dayStart - (24 - c.nightStart) * HOUR;
  const nightEnd = h >= c.nightStart || h < c.nightEnd ? now : pkt.dayStart + c.nightEnd * HOUR;
  const inNight = samples.filter(s => s.t >= nightStart && s.t <= nightEnd);
  const tBins = bin(inNight, nightEnd, (nightEnd - nightStart) / HOUR, HOUR, 'temp_c'), rBins = bin(inNight, nightEnd, (nightEnd - nightStart) / HOUR, HOUR, 'rh');
  const enough = tBins.filter(Boolean).length >= c.minBins;
  const tMin = enough ? Math.min(...tBins.filter(Boolean).map(b => b.min)) : null;
  const rVals = rBins.filter(Boolean), rMean = enough && rVals.length ? rVals.reduce((a, b) => a + b.mean, 0) / rVals.length : null;
  const criteria = [
    crit('night_low', 'Night-time lowest temperature (21:00–05:00 PKT)', tMin, '°C', '20–28 °C', within(tMin, c.tempLow[0], c.tempLow[1], c.tempTol)),
    crit('night_rh', 'Night-time mean humidity', rMean, '%', '≥ 70 %', atLeast(rMean, c.rh, c.rhTol)),
  ];
  const g = grade(criteria), cov = coverage(tBins);
  const ongoing = h >= c.nightStart || h < c.nightEnd;
  return finish('malaria', ctx, g, {
    criteria, confidence: enough ? confidenceFrom(cov) : 'low',
    flags: { night_in_progress: ongoing }, metrics: { night_coverage: Number(cov.toFixed(2)) },
    notes: [...(enough ? [] : [`Fewer than ${c.minBins} hourly night readings are available.`]), ...(ongoing ? ['The night is still in progress, so the lowest temperature so far can still fall.'] : [])],
  });
}

function locust(ctx) {
  const { cur, cfg } = ctx, c = cfg.locust;
  const wet = [cur.rain_acc_48h, cur.rain_acc_72h].filter(finite).length ? Math.max(...[cur.rain_acc_48h, cur.rain_acc_72h].filter(finite)) : null;
  const proxy = !finite(cur.soil_temp_c) && finite(cur.temp_c);
  const soilTemp = finite(cur.soil_temp_c) ? cur.soil_temp_c : null;
  const wetResult = cur.vegetation_dry === true ? { met: true, closeness: 0.85 } : atLeast(wet, c.wetMm, c.wetTol);
  const criteria = [
    crit('soil_moisture', 'Soil moisture', cur.soil_moisture, '%', '> 60 %', atLeast(cur.soil_moisture, c.soilMoisture, c.moistTol, true)),
    crit('soil_temp', proxy ? 'Soil temperature (air temperature used as a proxy)' : 'Soil temperature (0–10 cm)', proxy ? cur.temp_c : soilTemp, '°C', '25–35 °C', within(proxy ? cur.temp_c : soilTemp, c.soilTemp[0], c.soilTemp[1], c.soilTempTol), { proxy }),
    crit('rain_or_dry_vegetation', 'Rainfall event or dry vegetation', cur.vegetation_dry === true ? 'dry vegetation' : wet, cur.vegetation_dry === true ? '' : 'mm', `≥ ${c.wetMm} mm or vegetation flagged dry`, wetResult),
  ];
  const g = grade(criteria);
  const level = proxy ? cap(g.level, 'MODERATE') : g.level;
  return finish('locust', ctx, { ...g, level }, {
    criteria, confidence: proxy ? 'low' : g.status === 'ok' ? 'high' : 'medium',
    notes: [...(proxy ? ['No soil-temperature sensor: air temperature was used as a proxy, so the level is capped at MODERATE.'] : []), 'The 60% volumetric threshold means near-saturated soil; calibrate against local sandy-soil sensor readings before relying on it.'],
  });
}

function seasonal(id, months, ctx) { return months.includes(ctx.pkt.month); }

function rust(ctx) {
  const { samples, now, cfg } = ctx, c = cfg.rust;
  const tB = bin(samples, now, c.lookbackHours, HOUR, 'temp_c'), rB = bin(samples, now, c.lookbackHours, HOUR, 'rh');
  const cov = Math.min(coverage(tB), coverage(rB));
  let run = 0, longest = 0, ongoing = false;
  tB.forEach((b, i) => {
    const r = rB[i], mid = pktParts(b ? b.start + HOUR / 2 : 0).hour;
    const night = b && (mid >= c.nightFrom || mid < c.nightTo);
    const ok = b && r && night && b.mean >= c.nightTemp[0] && b.mean <= c.nightTemp[1] && r.mean > c.rh;
    run = ok ? run + 1 : 0; longest = Math.max(longest, run);
    if (i === tB.length - 1) ongoing = !!ok;
  });
  const enoughData = cov >= c.minCoverage;
  const runResult = longest > c.runHours ? { met: true, closeness: metScore((longest - c.runHours) / 4) } : enoughData ? { met: false, closeness: missScore(c.runHours + 1 - longest, c.runHours + 1) } : unknown();
  const lastT = tB.filter(Boolean).at(-1)?.mean ?? null, lastR = rB.filter(Boolean).at(-1)?.mean ?? null;
  const criteria = [
    crit('wet_cool_run', 'Consecutive night hours at 8–13 °C with humidity > 85 %', longest, 'h', '> 6 consecutive hours', runResult, { latest_temp_c: lastT && Number(lastT.toFixed(1)), latest_rh: lastR && Number(lastR.toFixed(1)) }),
  ];
  const g = grade(criteria);
  const inSeason = seasonal('rust', c.months, ctx);
  return finish('rust', ctx, inSeason ? g : { ...g, level: 'LOW' }, {
    criteria, status: inSeason ? undefined : 'out_of_season', label: inSeason ? undefined : OUT_OF_SEASON,
    confidence: confidenceFrom(cov), flags: { in_season: inSeason, event_in_progress: ongoing },
    metrics: { longest_run_hours: longest, coverage: Number(cov.toFixed(2)) },
    notes: ['Leaf wetness is not measured; humidity above 85% during cool nights is used as its proxy.'],
  });
}

function cotton(ctx) {
  const { samples, now, cfg } = ctx, c = cfg.cotton;
  const tB = bin(samples, now, c.lookbackHours, HOUR, 'temp_c'), rB = bin(samples, now, c.lookbackHours, HOUR, 'rh');
  const hot = tB.filter(b => b && b.max > c.hotC).length, tCov = coverage(tB), rCov = coverage(rB);
  const hotResult = hot >= c.hotHours ? atLeast(hot, c.hotHours, c.hotTol) : tCov >= c.minCoverage ? atLeast(hot, c.hotHours, c.hotTol) : unknown();
  // A "humidity drop" is a fall of at least 20 points within 6 h that starts from humid air.
  let drop = null;
  for (let j = 1; j < rB.length; j++) {
    if (!rB[j]) continue;
    for (let k = 1; k <= c.rhDropWindowHours && j - k >= 0; k++) {
      if (!rB[j - k] || rB[j - k].mean < c.rhHigh) continue;
      const d = rB[j - k].mean - rB[j].mean;
      if (drop === null || d > drop) drop = d;
    }
  }
  const dropResult = drop !== null && drop >= c.rhDrop ? atLeast(drop, c.rhDrop, c.rhDropTol) : rCov >= c.minCoverage ? atLeast(drop ?? 0, c.rhDrop, c.rhDropTol) : unknown();
  const criteria = [
    crit('hot_hours', 'Hours above 38 °C in the last 24 h', hot, 'h', `≥ ${c.hotHours} h`, hotResult),
    crit('humidity_drop', 'Largest humidity fall within 6 h (from ≥ 60 %)', drop, 'points', '≥ 20 points', dropResult),
  ];
  const g = grade(criteria), inSeason = seasonal('cotton', c.months, ctx);
  return finish('cotton', ctx, inSeason ? g : { ...g, level: 'LOW' }, {
    criteria, status: inSeason ? undefined : 'out_of_season', label: inSeason ? undefined : OUT_OF_SEASON,
    confidence: confidenceFrom(Math.min(tCov, rCov)), flags: { in_season: inSeason },
    notes: ['"Extended" heat is read as at least 6 hours above 38 °C and a "humidity drop" as 20 points in 6 h; confirm these interpretations with entomologists.'],
  });
}

function pressureDrop(ctx, hours) {
  const { samples, now } = ctx;
  const bins = bin(samples, now, hours, HOUR / 2, 'pressure_hpa');
  return { drop: largestDrop(bins, 6), coverage: coverage(bins) };
}

// An observed fall is positive evidence even from sparse data; only a "no fall" verdict needs good coverage.
function dropResult(drop, coverage, minCoverage, threshold, tol) {
  if (drop === null) return unknown();
  return drop > threshold || coverage >= minCoverage ? atLeast(drop, threshold, tol, true) : unknown();
}

function migraine(ctx) {
  const { cfg } = ctx, c = cfg.migraine, p = pressureDrop(ctx, c.lookbackHours);
  const criteria = [crit('pressure_drop_3h', 'Largest pressure fall within 3 h', p.drop, 'hPa', '> 3.0 hPa', dropResult(p.drop, p.coverage, c.minCoverage, c.dropHpa, c.tol))];
  return finish('migraine', ctx, grade(criteria), { criteria, confidence: confidenceFrom(p.coverage), metrics: { coverage: Number(p.coverage.toFixed(2)) } });
}

function arthritis(ctx) {
  const { cur, cfg } = ctx, c = cfg.arthritis, p = pressureDrop(ctx, cfg.migraine.lookbackHours);
  const criteria = [
    crit('pressure_drop_3h', 'Largest pressure fall within 3 h', p.drop, 'hPa', '> 2 hPa', dropResult(p.drop, p.coverage, cfg.migraine.minCoverage, c.dropHpa, c.dropTol)),
    crit('rh', 'Relative humidity', cur.rh, '%', '> 80 %', atLeast(cur.rh, c.rh, c.rhTol, true)),
    crit('temp', 'Air temperature', cur.temp_c, '°C', '< 18 °C', below(cur.temp_c, c.tempC, c.tempTol)),
  ];
  return finish('arthritis', ctx, grade(criteria), { criteria, confidence: confidenceFrom(p.coverage) });
}

function heat(ctx) {
  const { cur, cfg } = ctx, c = cfg.heat;
  const wbgt = wbgtApprox(cur.temp_c, cur.rh), hi = heatIndexC(cur.temp_c, cur.rh);
  const level = wbgt === null ? 'UNKNOWN' : wbgt > c.critical ? 'CRITICAL' : wbgt > c.high ? 'HIGH' : wbgt >= c.moderate ? 'MODERATE' : 'LOW';
  const score = wbgt === null ? null : Math.round(clamp((wbgt - 20) / 13, 0, 1) * 100);
  const criteria = [crit('wbgt', 'Estimated WBGT', wbgt, '°C', '> 31 °C critical, > 28 °C high, ≥ 25 °C moderate', wbgt === null ? unknown() : atLeast(wbgt, c.critical, 3, true))];
  const label = level === 'CRITICAL' ? TEXT.heat.critical : level === 'HIGH' ? TEXT.heat.high : level === 'MODERATE' ? TEXT.heat.moderate : undefined;
  return finish('heat', ctx, { score, level, status: wbgt === null ? 'unavailable' : 'ok' }, {
    criteria, label, confidence: wbgt === null ? 'low' : 'medium',
    metrics: { wbgt_c: wbgt && Number(wbgt.toFixed(1)), heat_index_c: hi && Number(hi.toFixed(1)) },
    notes: ['WBGT is estimated from air temperature and humidity only. Direct sun, still air, protective clothing and heavy work make real heat stress higher.'],
  });
}

function smog(ctx) {
  const { cur, cfg } = ctx, c = cfg.smog, modelPm = cur.pm25_source === 'model';
  const criteria = [
    crit('pm25', 'PM2.5', cur.pm25, 'µg/m³', '> 150 µg/m³', atLeast(cur.pm25, c.pm25, c.pm25Tol, true), { source: modelPm ? 'model' : 'sensor' }),
    crit('calm_wind', 'Wind speed (calm air proxy for an inversion)', cur.wind_speed_ms, 'm/s', '< 2 m/s', below(cur.wind_speed_ms, c.wind, c.windTol)),
  ];
  const g = grade(criteria), [pm, wind] = criteria;
  let level = g.level;
  if (pm.met === null) level = 'UNKNOWN';
  else if (pm.met && wind.met) level = 'CRITICAL';
  else if (pm.met) level = 'HIGH';
  else level = cur.pm25 >= c.moderatePm25 ? 'MODERATE' : 'LOW';
  return finish('smog', ctx, { ...g, level, status: pm.met === null ? 'unavailable' : wind.met === null ? 'partial' : 'ok' }, {
    criteria, label: level === 'CRITICAL' ? TEXT.smog.critical : undefined, confidence: modelPm ? 'low' : wind.met === null ? 'medium' : 'high',
    flags: { inversion_inferred_from_calm_wind: !!(pm.met && wind.met) },
    notes: ['A temperature inversion is inferred from calm surface wind; it is not measured with a temperature profile.', ...(modelPm ? ['PM2.5 came from a model (for example CAMS), not a local sensor.'] : [])],
  });
}

function asthma(ctx) {
  const { cur, samples, now, cfg } = ctx, c = cfg.asthma;
  const bins = bin(samples, now, c.lookbackHours, HOUR / 2, 'temp_c'), cov = coverage(bins), drop = largestDrop(bins, c.windowHours * 2);
  const pm = atLeast(cur.pm25, c.pm25, c.pm25Tol, true), rh = atLeast(cur.rh, c.rh, c.rhTol, true);
  let aggravator = unknown();
  if (pm.met || rh.met) aggravator = { met: true, closeness: Math.max(pm.closeness ?? 0, rh.closeness ?? 0) };
  else if (pm.met === false && rh.met === false) aggravator = { met: false, closeness: Math.max(pm.closeness, rh.closeness) };
  const criteria = [
    crit('temp_drop_4h', 'Largest temperature fall within 4 h', drop, '°C', '> 5 °C', dropResult(drop, cov, c.minCoverage, c.dropC, c.dropTol)),
    crit('aggravator', 'PM2.5 or humidity', cur.pm25 ?? cur.rh, '', 'PM2.5 > 75 µg/m³ or humidity > 80 %', aggravator, { pm25_met: pm.met, rh_met: rh.met }),
  ];
  return finish('asthma', ctx, grade(criteria), { criteria, confidence: confidenceFrom(cov) });
}

function flu(ctx) {
  const { cur, cfg } = ctx, c = cfg.flu;
  const criteria = [
    crit('rh', 'Relative humidity', cur.rh, '%', '< 40 %', below(cur.rh, c.rh, c.rhTol)),
    crit('temp', 'Air temperature', cur.temp_c, '°C', '< 16 °C', below(cur.temp_c, c.tempC, c.tempTol)),
  ];
  return finish('flu', ctx, grade(criteria), { criteria, confidence: 'high' });
}

const MODULES = { dengue, malaria, locust, rust, cotton, migraine, arthritis, heat, smog, asthma, flu };
const GROUPS = {
  vector_borne: ['dengue', 'malaria'], crop_pest: ['locust', 'rust', 'cotton'],
  biometeorology: ['migraine', 'arthritis', 'heat'], respiratory: ['smog', 'asthma'], seasonal_virus: ['flu'],
};

// ---------------------------------------------------------------- public API

const DISCLAIMER = bi(
  'Weather-based screening for awareness only. It is not a diagnosis, a case forecast or an official warning. For symptoms or emergencies contact a doctor or Rescue 1122.',
  'یہ صرف موسمی حالات پر مبنی آگاہی کا جائزہ ہے، تشخیص، بیماری کی پیش گوئی یا سرکاری انتباہ نہیں۔ علامات یا ہنگامی صورت میں ڈاکٹر سے رجوع کریں یا ریسکیو 1122 کو بلائیں۔');

/**
 * @typedef {Object} SensorPayload
 * @property {number} temp_c @property {number} rh @property {number} pressure_hpa @property {number} wind_speed_ms
 * @property {number} [pm25] @property {number} [soil_moisture] @property {number} [rain_acc_48h] @property {string} timestamp ISO 8601 with offset
 * Optional: pm10, soil_temp_c, solar_wm2, rain_acc_72h, vegetation_dry (boolean), pm25_source ('sensor' | 'model').
 */

/**
 * Assess every health index for one moment.
 * @param {SensorPayload} current  latest reading
 * @param {SensorPayload[]} [history]  earlier readings (any interval, up to 72 h are used)
 * @param {{now?: string, config?: object}} [options]
 */
export function assessHealth(current, history = [], options = {}) {
  const cfg = { ...CONFIG, ...(options.config || {}) };
  const first = normalizeSample(current);
  if (!first.ok) throw new Error(`Invalid current reading: ${first.reason}`);
  const cur = first.sample, now = options.now ? parseStamp(options.now) : cur.t;
  if (!finite(now)) throw new Error('options.now needs an ISO 8601 stamp with an explicit UTC offset');
  const ageHours = (now - cur.t) / HOUR, stale = ageHours > cfg.staleHours || ageHours < -0.01;
  const samples = prepareSeries(current, history, cur.t, cfg.history_hours);
  const pkt = pktParts(cur.t), ctx = { cur, samples, now: cur.t, pkt, cfg };
  const modules = {};
  for (const [id, fn] of Object.entries(MODULES)) {
    modules[id] = stale
      ? finish(id, ctx, { score: null, level: 'UNKNOWN', status: 'unavailable' }, { criteria: [], confidence: 'low', notes: ['The latest reading is too old to assess current conditions.'] })
      : fn(ctx);
  }
  const alerts = Object.values(modules).filter(m => LEVELS.indexOf(m.level) >= 1)
    .sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || b.index_score - a.index_score)
    .map(m => ({ module: m.id, level: m.level, title: m.title, headline: m.headline, actions: m.actions }));
  const known = Object.values(modules).map(m => m.level).filter(l => l !== 'UNKNOWN');
  const missing = first.missing, invalid = first.invalid;
  const pktIso = new Date(cur.t + PKT_OFFSET).toISOString().replace('Z', '+05:00');
  return {
    schema_version: SCHEMA_VERSION,
    timestamp: current.timestamp, timestamp_pkt: pktIso,
    overall_level: known.length ? LEVELS[Math.max(...known.map(l => LEVELS.indexOf(l)))] : 'UNKNOWN',
    data_quality: {
      stale, latest_reading_age_hours: Number(ageHours.toFixed(2)), history_samples: samples.length - 1,
      history_span_hours: samples.length > 1 ? Number(((cur.t - samples[0].t) / HOUR).toFixed(1)) : 0,
      missing_inputs: missing, invalid_inputs: invalid,
      fallbacks: [...(!finite(cur.soil_temp_c) && finite(cur.temp_c) ? ['soil_temp_c → air temperature proxy (locust, capped at MODERATE)'] : []), ...(cur.pm25_source === 'model' && finite(cur.pm25) ? ['pm25 from model, not sensor'] : [])],
    },
    groups: GROUPS,
    modules, alerts,
    disclaimer: DISCLAIMER,
  };
}

/**
 * Forward-looking screen from forecast hours. Each step re-runs the engine with the history
 * plus forecast values up to that step, so duration rules (48 h heat, 3 h pressure fall) apply.
 * Forecast payloads need the same fields; missing ones leave modules partial or UNKNOWN.
 */
export function assessOutlook(current, history, forecast, { stepHours = 3, horizonHours = 72 } = {}) {
  const start = parseStamp(current?.timestamp), steps = [];
  const future = (Array.isArray(forecast) ? forecast : []).map(f => ({ f, t: parseStamp(f.timestamp) })).filter(x => finite(x.t) && x.t > start).sort((a, b) => a.t - b.t);
  const past = [...(Array.isArray(history) ? history : []), current];
  for (const { f, t } of future) {
    if (t - start > horizonHours * HOUR || (t - start) % (stepHours * HOUR)) continue;
    const upTo = future.filter(x => x.t < t).map(x => x.f);
    const r = assessHealth(f, [...past, ...upTo]);
    steps.push({ timestamp: f.timestamp, timestamp_pkt: r.timestamp_pkt, overall_level: r.overall_level, levels: Object.fromEntries(Object.entries(r.modules).map(([id, m]) => [id, { level: m.level, index_score: m.index_score }])) });
  }
  return { schema_version: SCHEMA_VERSION, source: 'forecast', note: 'Forecast screening carries model error and should be refreshed with new observations.', steps };
}
