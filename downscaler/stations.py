"""PMD station names in the FFD workbooks -> PMD stations of realtime.json (WMO id, latitude, longitude).

Coordinates come from public/observation-data/station-meta.csv, which scripts/sync-realtime.mjs writes from realtime.json
(network 'PMD'). The PMD Observatories page (https://www.pmd.gov.pk/Observatories/) is read only as a check: it gives
surveyed station heights, but its positions are to the arc-minute and carry copy errors (Chhor has Barkhan's position,
Hunza has Gupis's height), so a realtime.json position is replaced only when check_positions finds it off the surveyed
height and the PMD position fits better.
"""
import csv
import datetime as dt
import html.parser
import re

from pmd_xlsx import norm_name

# Normalised workbook name -> station-meta.csv name. Typos and old spellings seen in 2012-2023 workbooks. Names that cannot
# be placed without guessing are left out ('ISLAMABAD', 'MUZAFFARABAD', 'LAHORE PBO', 'KARACHI AIRPORT MOS', Lahore and
# Karachi neighbourhood gauges, 'MARRI'); unmatched names are listed in data/pmd_unmatched.csv.
ALIASES = {
    'B NAGAR': 'Bahawalnagar', 'B PUR CITY': 'Bahawalpur City', 'B PUR AIRPORT': 'Bahawalpur Airport',
    'BAHAWALPURA P': 'Bahawalpur Airport', 'BAHAWALPUR AIRPORT': 'Bahawalpur Airport', 'BAHAWALPUR CITY': 'Bahawalpur City',
    'D G KHAN': 'Dera Ghazi Khan', 'DG KHAN': 'Dera Ghazi Khan',
    'D I KHAN': 'Dera Ismail Khan City', 'DI KHAN': 'Dera Ismail Khan City', 'D I KHAN CITY': 'Dera Ismail Khan City',
    'D I KHAN AIRPORT': 'Dera Ismail Khan Airport',
    'FAISALABAD': 'Faisalabad Airport',
    'ISLAMABAD ZP': 'Islamabad Zeropoint', 'ISLAMABAD Z P': 'Islamabad Zeropoint',
    'ISLAMABAD NEW AIRPORT': 'Islamabad Airport', 'ISLAMABAD OLD AIRPORT': 'Chaklala Airbase',
    'GOLRA': 'Golra, Islamabad', 'ISB GOLRA': 'Golra, Islamabad', 'ISLAMABAD GOLRA': 'Golra, Islamabad',
    'BOKRA': 'Bokra, Islamabad', 'ISB BOKRA': 'Bokra, Islamabad', 'ISLAMABAD BOKRA': 'Bokra, Islamabad',
    'SAIDPUR': 'Saidpur, Islamabad', 'SAID PUR': 'Saidpur, Islamabad', 'ISB SD PUR': 'Saidpur, Islamabad',
    'ISLAMABAD SAIDPUR': 'Saidpur, Islamabad',
    'SHAMSABAD': 'Shamsabad, Rawalpindi', 'ISB SH ABAD': 'Shamsabad, Rawalpindi', 'ISLAMABAD SHAMSABAD': 'Shamsabad, Rawalpindi',
    'KACHEHRI': 'Katcheri, Rawalpindi',
    'CHIRAT': 'Cherat', 'DIR': 'Upper Dir',
    'G DOPATTA': 'Garhi Dopatta', 'GARHI DUPATTA': 'Garhi Dopatta',
    'GWADAR': 'Gawadar', 'HYDERABAD': 'Hyderabad Airport', 'JAUHARABAD': 'Joharabad',
    'KAMRA': 'Kamra Airbase', 'KOHAT': 'Kohat Airbase',
    'MALAMJABBA': 'Malam Jabba', 'MANDI BAHA UD DIN': 'Mandi Bahauddin', 'MANDI BAHU DIN': 'Mandi Bahauddin',
    'MANDIBAHAUDDIN': 'Mandi Bahauddin',
    'MIANWALI': 'Mianwali Airbase', 'MIRKHANI': 'Mir Khani', 'MIRPUR KHAS': 'Mir Pur Khas',
    'MOIN JO DARO': 'Mohenjo Daro', 'MOINJODARO': 'Mohenjo Daro', 'M JO DARO': 'Mohenjo Daro',
    'MULTAN': 'Multan Airport',
    'MUZAFFARBAD AIRPORT': 'Muzaffarabad Airport', 'MUZAFFARBAD CITY': 'Muzaffarabad City',
    'NOKUNDI': 'Nokkundi', 'NOORPUR THAL': 'Noor Pur Thal',
    'PERSHWA AIRPORT': 'Peshawar Airport', 'PERSHWAR CITY': 'Peshawar City', 'PESHAWAR AIRBASE': 'Peshawar Airport',
    'SAMUNGLI': 'Quetta Samungli',     # plain 'QUETTA' is listed next to SAMUNGLI with other values: left unmatched
    'QUETTA SH MANDA': 'Quetta Sheikh Manda', 'QUETTA SHAIKHMANDA': 'Quetta Sheikh Manda', 'SH MANDA': 'Quetta Sheikh Manda',
    'SAIDU SHAHRIF': 'Saidu Sharif', 'SAIDU SHAHRIS': 'Saidu Sharif',
    'SARGODHA': 'Sargodha Airbase', 'SARGODHA AIRPORT': 'Sargodha Airbase',
    'SH BENAZIRABAD': 'Nawabshah', 'SHAHEED BENAZIRABAD': 'Nawabshah', 'SHAHEED BAINAZERABAD': 'Nawabshah',
    'SHAHHED BENAZIRABAD': 'Nawabshah', 'SH B ABAD': 'Nawabshah',
    'SHORKOT': 'Shorkot Airbase', 'SIALKOT CANTT': 'Sialkot City',
    'T T SINGH': 'Toba Tek Singh', 'TAKHT BHAI': 'Takht Bai', 'TANDOJAM': 'Tando Jam',
}
# 'ISLAMABAD AIRPORT' is the old airport (shared airfield with PAF Chaklala) until the new airport took over, and the new
# one afterwards; the workbooks list both as OLD / NEW from November 2018 and only the new one from 2020.
ISLAMABAD_NEW_AIRPORT_FROM = dt.date(2018, 11, 1)

# Positions confirmed by WeatherWalay (16 Nov 2026): realtime.json and the PMD page both put these stations on the wrong slope.
# name -> (latitude, longitude, surveyed height m). Used for training and for live assimilation.
POSITION_OVERRIDES = {
    'Astore': (35.366, 74.850, 2168.0),
    'Cherat': (33.817, 71.883, 1372.0),
}


def load_pmd_meta(path):
    """station-meta.csv rows of network PMD -> {name: dict(station_id, name, lat, lon, elev_meta)}."""
    out = {}
    with open(path, encoding='utf-8', newline='') as f:
        for r in csv.DictReader(f):
            if r['network'] != 'PMD':
                continue
            sid = r['id'] or 'PMD-' + norm_name(r['name']).replace(' ', '-')
            out[r['name']] = dict(station_id=sid, name=r['name'], lat=float(r['latitude']), lon=float(r['longitude']),
                                  elev_meta=float(r['elevation_m']) if r['elevation_m'] else None)
    return out


def resolver(meta):
    """-> resolve(raw_name, date) giving the station-meta name or None."""
    by_norm = {norm_name(n): n for n in meta}

    def resolve(raw, day):
        n = norm_name(raw)
        if n in ('ISLAMABAD AIRPORT',):
            return 'Islamabad Airport' if day >= ISLAMABAD_NEW_AIRPORT_FROM else 'Chaklala Airbase'
        name = ALIASES.get(n) or by_norm.get(n)
        return name if name in meta else None
    return resolve


# ---- PMD Observatories page (check only) ----
class _Rows(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(re.sub(r'\s+', ' ', ''.join(self.cell)).strip())
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            if any(self.row):
                self.rows.append(self.row)
            self.row = None

    def handle_data(self, d):
        if self.cell is not None:
            self.cell.append(d)


def parse_angle(s):
    """"29o 20'", "30o-11' N", "25 o 31'", "34.02" -> decimal degrees, or None."""
    nums = re.findall(r'\d+(?:\.\d+)?', s or '')
    if not nums:
        return None
    if len(nums) == 1:
        return float(nums[0])
    return float(nums[0]) + float(nums[1]) / 60


def parse_pmd_page(text):
    """-> {wmo id: [dict(name, lat, lon, elev_pmd), ...]} for rows with a numeric WMO index (an id can repeat: the page
    lists 41504 for both Gupis and Hunza and 41685 for both Chhor and Barkhan; page_entry picks by name)."""
    p = _Rows()
    p.feed(text)
    out = {}
    for r in p.rows:
        off = 1 if re.match(r'^\d+\.$', r[0]) else 0       # some tables start with a serial number column
        if len(r) < off + 5:
            continue
        idx, name, lat, lon, elev = r[off:off + 5]
        m = re.match(r'^(\d{5})$', idx.strip())          # '41625(AP)' is an aeromet index, not the station's
        h = re.search(r'(\d+(?:\.\d+)?)', elev or '')
        if not m:
            continue
        out.setdefault(m.group(1), []).append(dict(name=name, lat=parse_angle(lat), lon=parse_angle(lon),
                                                   elev_pmd=float(h.group(1)) if h else None))
    return out


def page_entry(page, station_id, name):
    """The page row for this WMO id whose name shares a word (first 4 letters) with the realtime.json name. When the id is
    not on the page (it lists Hunza under Gupis's 41504), a row anywhere whose first word matches the name's first word."""
    words = {w[:4] for w in norm_name(name).split() if len(w) >= 4}
    for e in page.get(str(station_id), []):
        if words & {w[:4] for w in norm_name(e['name']).split() if len(w) >= 4}:
            return e
    first = norm_name(name).split()[0][:4]
    for rows in page.values():
        for e in rows:
            if norm_name(e['name']).split()[:1] == [norm_name(name).split()[0]] and len(first) == 4:
                return e
    return None
