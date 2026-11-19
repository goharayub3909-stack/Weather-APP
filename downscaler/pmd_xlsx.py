"""Read PMD (FFD) daily station workbooks into one long table.

Two workbook families, both one sheet per month with stations as rows and days 1..31 as columns:
  * rain:        "FFD-Monthly Rainfall Statement (YYYY).xlsx", sheets January..December (+ 'Annual Rainfall', skipped)
  * temperature: "FFd Monthly Temperature (2016-2022).xlsx", sheets 'March 2016' .. 'February-2023' (+ 'AWS + PMD'),
                 each holding a MAXIMUM block and a MINIMUM block in either order.
Province header rows carry the day numbers (['PUNJAB', 1, 2, 3, ...]); the column of each day is taken from them.
Station names are normalised and resolved to PMD WMO ids with station_aliases (see stations.py).
"""
import calendar
import re
from pathlib import Path

import openpyxl

MONTHS = {m.upper(): i for i, m in enumerate(calendar.month_name) if m}
MONTHS.update({m.upper(): i for i, m in enumerate(calendar.month_abbr) if m})
MISSING_TOKENS = {'', '*', '**', '***', '-', '--', 'NA', 'N/A', 'NR', 'NIL REPORT', 'M', 'X'}
TRACE_TOKENS = {'T', 'TR', 'TRACE', 'TR.'}
SKIP_WORDS = ('HIGHEST', 'LOWEST', 'TOTAL', 'MEAN', 'AVERAGE', 'STATIONS', 'INDICATES', 'NOTE', 'TEMPERATURE', 'RAINFALL',
              'PREPARED', 'SOURCE', 'PARAMETERS', 'WARMEST', 'COOLEST')
NUM = re.compile(r'^-?\d+(?:\.\d+)?$')


def parse_value(v):
    """Cell -> (value, flag). flag: 'ok', 'trace' (rain below measurable, stored as 0.0) or 'missing'."""
    if v is None:
        return None, 'missing'
    if isinstance(v, bool):
        return None, 'missing'
    if isinstance(v, (int, float)):
        return float(v), 'ok'
    s = str(v).replace('\xa0', ' ').strip().upper().rstrip('*').strip()
    if s in TRACE_TOKENS:
        return 0.0, 'trace'
    if s in MISSING_TOKENS:
        return None, 'missing'
    s = s.replace(' ', '')
    if NUM.match(s):
        return float(s), 'ok'
    return None, 'missing'


def norm_name(s):
    s = str(s).replace('\xa0', ' ').upper()
    s = s.replace('A/P', ' AIRPORT ').replace('A /P', ' AIRPORT ')
    s = re.sub(r'[^A-Z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def month_from_text(text):
    """'January-2022', 'March 2016', 'Daily Rainfall (MM),January-2022', 'MAY -2020-' -> (year, month) or None.
    Titles carry typos ('Month ofJune -2021', 'Octoberr -2021', 'MONTHJANUARY-2017'), so the month name may be glued to the
    word before it or have extra letters after it."""
    t = str(text).upper().replace('\xa0', ' ')
    m = MONTH_YEAR.search(t)
    return (int(m.group(2)), MONTHS[m.group(1)]) if m else None


MONTH_YEAR = re.compile('(' + '|'.join(sorted(MONTHS, key=len, reverse=True)) + r')[A-Z]*\.?[\s\-,/]*((?:19|20)\d\d)')


def day_columns(row):
    """Province header row: {day: column index} when days 1..28 sit in consecutive columns. A station row of whole-number
    winter temperatures (1, 2, 3, ...) must not pass, so the days have to run 1, 2, 3, ... left to right without a gap."""
    day = lambda v: int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and float(v).is_integer() else None
    for j in range(1, len(row)):
        if day(row[j]) == 1:
            cols = {}
            for d in range(1, 32):
                if j + d - 1 < len(row) and day(row[j + d - 1]) == d:
                    cols[d] = j + d - 1
                else:
                    break
            return cols if len(cols) >= 28 else None
    return None


def block_kind(row):
    """'tmax' / 'tmin' for a temperature block title row, else None. The title can sit in any column; it names a month and
    year, which tells it apart from legend lines such as 'indicates Daily Highest Maximum Temperature'."""
    for v in row:
        if isinstance(v, str):
            u = v.upper()
            if 'TEMPERATURE' in u and month_from_text(u):
                if 'MAX' in u:
                    return 'tmax'
                if 'MIN' in u:
                    return 'tmin'
    return None


def station_name(row):
    """Station name: column A, or column B when column A holds a serial number (older rain sheets)."""
    if isinstance(row[0], str) and row[0].strip():
        return row[0]
    if (row[0] is None or isinstance(row[0], (int, float))) and len(row) > 1 and isinstance(row[1], str) and row[1].strip():
        return row[1]
    return None


def read_sheet(ws, variable, sheet_month=None):
    """Yield dicts (name, province, year, month, day, variable, value, flag, sheet) from one month sheet.
    variable: 'rain' for a rain sheet, None for a temperature sheet (the kind comes from each block's title).
    sheet_month: (year, month) from the sheet and file names. It wins over the titles, which carry typos (the 'July 2017'
    sheet's minimum block is titled 2016); titles are used only when it is None (the 'AWS + PMD' sheet)."""
    kind = variable
    ym = sheet_month
    cols = None
    province = None
    for row in ws.iter_rows(values_only=True):
        if not row:
            continue
        row = list(row)
        k = block_kind(row) if variable is None else None
        if k:
            kind, cols = k, None
            if sheet_month is None:
                ym = next(month_from_text(v) for v in row if isinstance(v, str) and month_from_text(v))
            if isinstance(row[0], str) and 'TEMPERATURE' not in row[0].upper():
                province = row[0].strip()
            continue
        dc = day_columns(row)
        if dc:
            cols = dc
            if isinstance(row[0], str) and row[0].strip():
                province = row[0].strip()
            continue
        name = station_name(row)
        if kind is None or ym is None or name is None:
            continue
        if any(w in name.upper() for w in SKIP_WORDS):
            continue
        year, month = ym
        ndays = calendar.monthrange(year, month)[1]
        use = cols or {d: d for d in range(1, 32)}
        vals = []
        for d in range(1, ndays + 1):
            j = use.get(d)
            vals.append(parse_value(row[j]) if j is not None and j < len(row) else (None, 'missing'))
        if not any(f != 'missing' for _, f in vals) and isinstance(row[0], str):
            # a province or group heading without values ('G.BALTISTAN & AJK')
            province = name.strip()
            continue
        for d, (v, f) in enumerate(vals, 1):
            if f != 'missing':
                yield dict(name=name.strip(), province=province, year=year, month=month, day=d, variable=kind,
                           value=v, flag=f, sheet=ws.title)


def read_rain_workbook(path):
    path = Path(path)
    m = re.search(r'\((\d{4})\)', path.name)
    year = int(m.group(1)) if m else None
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for ws in wb.worksheets:
        if ws.title.strip().upper() not in MONTHS:
            continue
        fallback = (year, MONTHS[ws.title.strip().upper()]) if year else None
        yield from read_sheet(ws, 'rain', fallback)


def read_temperature_workbook(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for ws in wb.worksheets:
        yield from read_sheet(ws, None, month_from_text(ws.title))
