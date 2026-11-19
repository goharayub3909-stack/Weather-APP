// Value colours per parameter, ported from the WeatherWalay realtime page (ColorPalettes.js). Pollutants and air quality are not included.
export function getTextColor(value, parameter, category = '') {
    if (parameter === 'rainfall' || parameter === 'rain_rate') {
        return value > 1000 ? '#808080' :
               value > 750 ? '#B2B2B2' :
               value > 500 ? '#DDDDDD' :
               value > 250 ? '#ffcaff' :
               value > 200 ? '#E673FF' :
               value > 150 ? '#B30890' :
               value > 125 ? '#A00000' :
               value > 100 ? '#FF0000' :
               value > 75 ? '#FF5200' :
               value > 60 ? '#ffa900' :
               value > 45 ? '#FFF300' :
               value > 35 ? '#14a414' :
               value > 25 ? '#07f700' :
               value > 15 ? '#0504F9' :
               value > 5 ? '#008DFF' :
               value >= 0.01 ? '#00e9f0' :
               value = 0 ? '#FFFFFF' :
                             '#FFFFFF';
    } else if (parameter === 'wind_speed') {
        if (category.includes('Average')) {
            return value > 50 ? '#fedffd' :
               value > 40 ? '#fd80f9' :
               value > 30 ? '#fc22f6' :
               value > 25 ? '#fc22a6' :
               value > 20 ? '#ff0000' :
               value > 15 ? '#ff7300' :
               value > 12 ? '#FFCC00' :
               value > 8 ? '#FFFF00' :
               value > 5 ? '#e4f500' :
               value > 2 ? '#83cf00' :
               value > 0  ? '#38a800' :
                            '#fff';
        } else {
            return value > 130 ? '#fedffd' :
               value > 110 ? '#fd80f9' :
               value > 90 ? '#fc22f6' :
               value > 75 ? '#fc22a6' :
               value > 60 ? '#ff0000' :
               value > 45 ? '#ff7300' :
               value > 30 ? '#FFCC00' :
               value > 15 ? '#FFFF00' :
               value > 10 ? '#e4f500' :
               value > 5 ? '#83cf00' :
               value > 0  ? '#38a800' :
                            '#fff';
        }
    } else if (parameter === 'pressure') {
        return value >= 1030 ? '#3C30BF' :
            value >= 1028 ? '#6047DB' :
            value >= 1026 ? '#845EF7' :
            value >= 1024 ? '#6168EC' :
            value >= 1022 ? '#3E73E1' :
            value >= 1020 ? '#1C7ED6' :
            value >= 1018 ? '#1E91D3' :
            value >= 1016 ? '#20A4D1' :
            value >= 1014 ? '#22B8CF' :
            value >= 1012 ? '#29B6A3' :
            value >= 1010 ? '#30B478' :
            value >= 1008 ? '#37B24D' :
            value >= 1006 ? '#4BB43A' :
            value >= 1004 ? '#5FB628' :
            value >= 1002 ? '#74B816' :
            value >= 1000 ? '#A2C122' :
            value >= 998 ? '#D0CA2E' :
            value >= 996 ? '#FFD43B' :
            value >= 994 ? '#FBC227' :
            value >= 992 ? '#F8B013' :
            value >= 990 ? '#F59F00' :
            value >= 988 ? '#F58C02' :
            value >= 986 ? '#F67904' :
            value >= 984 ? '#F76707' :
            value >= 982 ? '#F45919' :
            value >= 980 ? '#F24B2B' :
                            '#F03E3E';
    } else if (parameter === 'uv_index') {
        return value > 10 ? '#f72585' :
               value > 9 ? '#b5179e' :
               value > 8 ? '#7209b7' :
               value > 7 ? '#560bad' :
               value > 6 ? '#480ca8' :
               value > 5 ? '#3a0ca3' :
               value > 4 ? '#3f37c9' :
               value > 3 ? '#4361ee' :
               value > 2 ? '#4895ef' :
               value > 1 ? '#4cc9f0' :
               value > 0 ? '#66FFFF' :
                            '#fff';
    } else if (parameter === 'solar_radiation') {
        return value > 1000 ? '#CC0000' :
               value > 800 ? '#FF3300' :
               value > 700 ? '#FF6600' :
               value > 600 ? '#FE9900' :
               value > 500 ? '#FFCC00' :
               value > 400 ? '#FFFF00' :
               value > 300 ? '#CCFF00' :
               value > 200 ? '#01CC00' :
               value > 150 ? '#009999' :
               value > 100 ? '#0099ff' :
               value > 50 ? '#0000cc' :
               value > 0  ? '#010080' :
                            '#fff';
    } else if (parameter === 'humidity') {
    return value === 100 ? '#3B3F4C' :
           value > 95  ? '#062B35' :
           value > 90  ? '#0B476B' :
           value > 85  ? '#1D61A3' :
           value > 80  ? '#3073C7' :
           value > 75  ? '#2888E2' :
           value > 70  ? '#2895E2' :
           value > 65  ? '#2DA8E9' :
           value > 60  ? '#2DC9F0' :
           value > 55  ? '#5AE4E9' :
           value > 50  ? '#5AFFE2' :
           value > 45  ? '#5AFFD5' :
           value > 40  ? '#87FFC8' :
           value > 35  ? '#CEFFA5' :
           value > 30  ? '#F0EA86' :
           value > 25  ? '#F0D15A' :
           value > 20  ? '#F0BB38' :
           value > 15  ? '#F69834' :
           value > 10  ? '#DE7C25' :
           value > 5   ? '#C15314' :
           value > 0   ? '#843C0C' :
                         '#FFFFFF';
    } else if (parameter === 'visibility') {
    return value >= 4000 ? '#008CFF' :
            value >= 2000 ? '#07A2C5' :
            value >= 1500 ? '#0FB98B' :
            value >= 1000 ? '#16D051' :
            value >= 800  ? '#1EE717' :
            value >= 600  ? '#55ED11' :
            value >= 500  ? '#8CF30B' :
            value >= 400  ? '#C3F905' :
            value >= 300  ? '#FBFF00' :
            value >= 200  ? '#FCC304' :
            value >= 100  ? '#FD8708' :
            value >= 50   ? '#FE4B0C' :
            value >= 0    ? '#FF1010' :
                            '#FFFFFF';

    } else if (parameter === 'hairfrizz_index') {
        return value >= 76 ? '#FF0000' :
               value >  55 ? '#FD8708' :
               value >  40 ? '#FBFF00' :
               value <= 40 ? '#1EE717' :
                            '#fff';

    } else if (parameter === 'normals') {
        if (category.includes('Monthly Rain') || category.includes('Yearly Rain') || category.includes('Monsoon Rain')) {
            return value > 1000 ? '#808080' :
            value > 750 ? '#B2B2B2' :
            value > 500 ? '#DDDDDD' :
            value > 250 ? '#ffcaff' :
            value > 200 ? '#E673FF' :
            value > 150 ? '#B30890' :
            value > 125 ? '#A00000' :
            value > 100 ? '#FF0000' :
            value > 75 ? '#FF5200' :
            value > 60 ? '#ffa900' :
            value > 45 ? '#FFF300' :
            value > 35 ? '#14a414' :
            value > 25 ? '#07f700' :
            value > 15 ? '#0504F9' :
            value > 5 ? '#008DFF' :
            value > 0 ? '#00e9f0' :
                          '#FFFFFF';
        } else {
            return value > 60 ? '#CB9FB3' :
            value > 57 ? '#c987a5' :
            value > 54 ? '#e398c0' :
            value > 51 ? '#f288a9' :
            value > 48 ? '#d95f72' :
            value > 45 ? '#ba4355' :
            value > 42 ? '#9e263a' :
            value > 39 ? '#c21b26' :
            value > 36 ? '#de3b2c' :
            value > 33 ? '#f0653e' :
            value > 30 ? '#f78c52' :
            value > 27 ? '#fcb365' :
            value > 24 ? '#fcd283' :
            value > 21 ? '#FFFFA3' :
            value > 18 ? '#FEFF00' :
            value > 15 ? '#ceff00' :
            value > 12 ? '#7fff00' :
            value > 9 ? '#01ffb3' :
            value > 6 ? '#16fef5' :
            value > 3 ? '#00e6ff' :
            value > 0 ? '#00cbff' :
            value > -3 ? '#00a4ff' :
            value > -6 ? '#0e74ff' :
            value > -9 ? '#1800FF' :
            value > -12  ? '#6600ff' :
            value > -15 ? '#c332fd' :
            value > -18 ? '#FF02FF' :
            value > -21 ? '#9A009A' :
                         '#ffceba';
        }
    }  else if (parameter === 'departures') {
        if (category.includes('Monthly Rain') || category.includes('Yearly Rain') || category.includes('Monsoon Rain')) {
            return value > 100 ? '#003C30' :
            value > 80 ? '#01665E' :
            value > 60 ? '#35978F' :
            value > 40 ? '#80CDC1' :
            value > 20 ? '#C7EAE5' :
            value > 0 ? '#F7F7F7' :
            value > -20 ? '#FCDB81' :
            value > -40 ? '#FCC658' :
            value > -60 ? '#FCAF3A' :
            value > -80 ? '#FA952F' :
                        '#F77A2D';
        } else {
            return value > 7 ? '#911419' :
            value > 6.5 ? '#ab1a21' :
            value > 6 ? '#c21d25' :
            value > 5.5 ? '#d62c29' :
            value > 5 ? '#e34529' :
            value > 4.5 ? '#f0602b' :
            value > 4.0 ? '#f77a2d' :
            value > 3.5 ? '#fa952f' :
            value > 3.0 ? '#fcaf3a' :
            value > 2.5 ? '#fcc658' :
            value > 2.0 ? '#fcdb81' :
            value > 1.5 ? '#fceea7' :
            value > 1.0 ? '#fcf7ca' :
            value > 0.5 ? '#fffded' :
            value > 0 ? '#f5fbfc' :
            value > -0.5 ? '#e8f7fc' :
            value > -1.0 ? '#d9f1fa' :
            value > -1.5 ? '#c6e8f7' :
            value > -2.0 ? '#b0e1f7' :
            value > -2.5 ? '#99d6f2' :
            value > -3.0 ? '#80c4e8' :
            value > -3.5 ? '#67afdb' :
            value > -4.0 ? '#5198cf' :
            value > -4.5 ? '#3a7aba' :
            value > -5.0 ? '#2a61a8' :
            value > -5.5 ? '#224e94' :
            value > -6.0 ? '#1f3d7a' :
            value > -6.5 ? '#1b2b61':
                        '#162345';
        }
    } else {
    return value > 60 ? '#CB9FB3' :
           value > 57 ? '#c987a5' :
           value > 54 ? '#e398c0' :
           value > 51 ? '#f288a9' :
           value > 48 ? '#d95f72' :
           value > 45 ? '#ba4355' :
           value > 42 ? '#9e263a' :
           value > 39 ? '#c21b26' :
           value > 36 ? '#de3b2c' :
           value > 33 ? '#f0653e' :
           value > 30 ? '#f78c52' :
           value > 27 ? '#fcb365' :
           value > 24 ? '#fcd283' :
           value > 21 ? '#FFFFA3' :
           value > 18 ? '#FEFF00' :
           value > 15 ? '#ceff00' :
           value > 12 ? '#7fff00' :
           value > 9 ? '#01ffb3' :
           value > 6 ? '#16fef5' :
           value > 3 ? '#00e6ff' :
           value > 0 ? '#00cbff' :
           value > -3 ? '#00a4ff' :
           value > -6 ? '#0e74ff' :
           value > -9 ? '#1800FF' :
           value > -12  ? '#6600ff' :
           value > -15 ? '#c332fd' :
           value > -18 ? '#FF02FF' :
           value > -21 ? '#9A009A' :
                        '#ffceba';
}
}
