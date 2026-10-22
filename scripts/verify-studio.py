#!/usr/bin/env python3
"""Optional network audit: compare cached 500 hPa nodes with ECMWF API fields.

Run after refreshing the snapshot. A later upstream model run may legitimately
change forecasts; differences then require a refresh, not a tolerance increase.
"""
import importlib.util
import json
import math
from pathlib import Path
from urllib.parse import urlencode

spec=importlib.util.spec_from_file_location('studio',Path(__file__).with_name('sync-studio.py'))
studio=importlib.util.module_from_spec(spec);spec.loader.exec_module(studio)

def verify(path=Path('public/studio-data/forecast.json')):
    data=json.loads(path.read_text());g=data['grid'];fields=data['levels']['500']
    for lat,lon in [(25,67),(34,73),(36,75)]:
        query={'latitude':lat,'longitude':lon,'models':'ecmwf_ifs025','hourly':'temperature_500hPa,relative_humidity_500hPa,wind_speed_500hPa,wind_direction_500hPa,geopotential_height_500hPa,surface_pressure','wind_speed_unit':'ms','timezone':'UTC','cell_selection':'nearest','start_hour':data['times'][0][:16],'end_hour':data['times'][-1][:16]}
        source=studio.get(studio.ENDPOINT+'?'+urlencode(query));h=source['hourly'];index=(lat-g['south'])*g['columns']+lon-g['west']
        assert [studio.utc(t) for t in h['time']]==data['times'],'Forecast hours differ'
        count=0
        for t in range(len(data['times'])):
            if h['surface_pressure'][t]<500:
                assert fields['u'][t][index] is None,'Below-terrain vector was shown'
                continue
            angle=math.radians(h['wind_direction_500hPa'][t]);speed=h['wind_speed_500hPa'][t]
            expected={'temperature':h['temperature_500hPa'][t],'humidity':h['relative_humidity_500hPa'][t],'u':-speed*math.sin(angle),'v':-speed*math.cos(angle),'height':h['geopotential_height_500hPa'][t]}
            for field,value in expected.items():
                cached=fields[field][t][index]
                assert cached is not None and abs(cached-value)<=.001,f'{lat},{lon} hour {t}: {field} differs ({cached} vs {value}); upstream may have updated'
            count+=1
        print(f'{lat}°N {lon}°E: {count} hours matched temperature, RH, U/V and geopotential height at 500 hPa; first height {h["geopotential_height_500hPa"][0]:.0f} m')
    print('PASS: exact grid-node source comparison (not independent observation validation).')

if __name__=='__main__':verify()
