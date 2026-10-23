// Reviewed crop references + authored agronomy guidance. No automatic chemical doses.
export const CROP_MANUALS={
  "wheat": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/3",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "yellow rust, brown rust, aphids and termites",
    "stages": [
      {
        "number": 1,
        "name": "Land preparation",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later grain number and grain weight.",
        "timing": "Before the district sowing window, while soil is friable rather than saturated",
        "actions": [
          "Level the seedbed and clear irrigation / drainage channels",
          "Test soil and plan balanced fertilizer before sowing"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Avoid cultivating wet soil or assuming all November dates fit every district."
      },
      {
        "number": 2,
        "name": "Sowing",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "Within the locally confirmed Rabi sowing window; use the district reference shown above",
        "actions": [
          "Drill certified seed into a moist, uniform seedbed",
          "Calibrate the drill for the named variety and germination test"
        ],
        "technical": "KP lists 50 kg seed/acre for several named varieties and 60 kg/acre for its late-sowing entry; these are variety / province references, not automatic rates for every district.",
        "warning": "Avoid compensating for poor germination with an unverified fertilizer or pesticide dose."
      },
      {
        "number": 3,
        "name": "Emergence / crown-root establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "From uniform emergence until crown roots are established",
        "actions": [
          "Count established seedlings and inspect crown roots",
          "Check soil moisture before the first irrigation"
        ],
        "technical": "Identify leaf development with the Zadoks 10–19 group, then inspect crown-root establishment in actual plants. Record plants/m² and measure moisture at the rooting depth; no fixed first-irrigation day is inferred from air weather.",
        "warning": "Do not delay a needed crown-root irrigation solely because rain is forecast; inspect actual root-zone moisture."
      },
      {
        "number": 4,
        "name": "Tillering / stem elongation",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later grain number and grain weight-forming structures.",
        "timing": "When visible tillers develop and stems begin elongating",
        "actions": [
          "Control competitive weeds before canopy closure",
          "Split locally recommended nitrogen to crop demand and field moisture"
        ],
        "technical": "Use Zadoks 20–29 for tillering and 30–39 for stem elongation when actual plant observations support it. Record tillers/m², soil moisture and the locally recommended split nitrogen in kg nutrient/acre; no automatic fertilizer dose is generated.",
        "warning": "Avoid excessive nitrogen and irrigation that increase lodging and dense, disease-prone growth."
      },
      {
        "number": 5,
        "name": "Booting / heading / flowering",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s grain number and grain weight.",
        "timing": "From swollen flag-leaf sheath through head emergence and anther extrusion",
        "actions": [
          "Protect the flag leaf and inspect heads for rust / aphids",
          "Avoid moisture stress during heading and flowering"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds. Zadoks 40–49 indicates booting, 50–59 head emergence and 60–69 anthesis; confirm these on actual plants.",
        "warning": "Do not mistake a weather-favourable rust signal for confirmed infection; scout the flag leaf and heads."
      },
      {
        "number": 6,
        "name": "Grain filling / maturation",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "From milk / dough grain to physiological maturity",
        "actions": [
          "Maintain moisture according to root-zone checks",
          "Inspect lodging and grain fill before ending irrigation"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred. Zadoks 70–79 covers milk development and 80–89 dough development; a spectral index cannot establish these grain stages.",
        "warning": "Avoid premature irrigation withdrawal or late heavy irrigation that increases lodging."
      },
      {
        "number": 7,
        "name": "Harvest / post-harvest",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "When grain is mature and its moisture is suitable for the harvesting and storage system",
        "actions": [
          "Harvest mature grain in a dry weather window",
          "Measure grain moisture and dry grain before sealed storage"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Do not combine or seal-store damp grain; forecast dryness is not a grain-moisture measurement."
      }
    ]
  },
  "rice": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/59",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "blast, bacterial blight, leaf folder and stem borer",
    "stages": [
      {
        "number": 1,
        "name": "Land / nursery preparation",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later productive tillers, filled grains and milling quality.",
        "timing": "Before the locally permitted nursery and transplanting dates",
        "actions": [
          "Level the field and repair bunds and drainage",
          "Select clean seed and separate nursery and main-field plans"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Do not treat one provincial calendar as a nationwide legal nursery date."
      },
      {
        "number": 2,
        "name": "Nursery sowing / direct seeding / transplanting",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "At the locally approved sowing / transplanting date for the named variety and method",
        "actions": [
          "Match sowing to the locally notified rice calendar",
          "Transplant healthy seedlings or calibrate direct seeding for the chosen method"
        ],
        "technical": "KP lists 10–12 kg/acre for several Basmati entries and 12–14 kg/acre for some named entries; the catalogue does not resolve nursery versus direct-seeded requirements. Confirm establishment method before using any rate.",
        "warning": "Never use a nursery seed rate as a direct-seeded field rate without confirming the method."
      },
      {
        "number": 3,
        "name": "Seedling establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "Until transplanted seedlings recover or direct-seeded plants establish",
        "actions": [
          "Inspect stand recovery and missing hills",
          "Measure water depth and check rooting rather than flooding by habit"
        ],
        "technical": "Record the established stand as plants/m², plants/acre or surviving trees/acre and compare with the locally intended stand; measure soil temperature at the actual seed / root depth, in cm.",
        "warning": "Avoid drowning seedlings or assuming rainfall equals useful ponded depth."
      },
      {
        "number": 4,
        "name": "Active tillering",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later productive tillers, filled grains and milling quality-forming structures.",
        "timing": "While new tillers are developing, before panicle initiation",
        "actions": [
          "Control weeds with the method appropriate to transplanted or direct-seeded rice",
          "Check tillers and split nutrition using the local variety plan"
        ],
        "technical": "Record root-zone depth in cm and measured volumetric moisture in % where available. Rain is in mm; rainfall does not establish infiltration or a refill dose. Use soil / leaf tests before applying a nutrient correction.",
        "warning": "Avoid surplus nitrogen that creates a dense, disease-prone canopy."
      },
      {
        "number": 5,
        "name": "Panicle initiation / heading / flowering",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s productive tillers, filled grains and milling quality.",
        "timing": "From reproductive panicle initiation through heading and anthesis",
        "actions": [
          "Maintain a locally appropriate paddy water regime",
          "Scout panicles and leaves for blast and stem-borer damage"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Avoid drought stress at reproductive stages and unlabelled prophylactic pesticide mixtures."
      },
      {
        "number": 6,
        "name": "Grain filling / ripening",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "From milk grain until panicles reach harvest maturity",
        "actions": [
          "Inspect grain fill and lodging",
          "Coordinate irrigation withdrawal with soil, maturity and harvest access"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not drain an immature field solely to fit a forecast dry spell."
      },
      {
        "number": 7,
        "name": "Harvest / drying / storage",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "When the variety meets grain-maturity and harvest-moisture criteria",
        "actions": [
          "Harvest mature panicles and thresh promptly",
          "Dry paddy and measure moisture before bagging"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Do not seal-store hot or damp paddy; drying and mill specifications govern the moisture target."
      }
    ]
  },
  "cotton": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/54",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "whitefly, jassid, thrips, pink bollworm and cotton leaf curl symptoms",
    "stages": [
      {
        "number": 1,
        "name": "Land preparation / sanitation",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later retained fruiting sites, boll weight and lint quality.",
        "timing": "Before locally advised spring sowing, with field sanitation complete",
        "actions": [
          "Remove volunteer cotton and old host material according to local rules",
          "Level beds and test soil before planting"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Avoid carrying over infested residues or volunteers into the new crop."
      },
      {
        "number": 2,
        "name": "Sowing",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "Within the district sowing window in a warm, workable seedbed",
        "actions": [
          "Sow a locally approved variety with a seed-lot germination check",
          "Calibrate seed placement and the target stand"
        ],
        "technical": "KP lists 8–10 kg seed/acre for several named cotton varieties; confirm acid-delinted / fuzzy seed, germination, variety and current district advice before setting a drill rate.",
        "warning": "Do not infer seedbed temperature from satellite LST or a distant air station."
      },
      {
        "number": 3,
        "name": "Seedling establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "From emergence until an even stand is established",
        "actions": [
          "Count surviving plants and inspect sucking pests",
          "Thin only after stand establishment and local spacing confirmation"
        ],
        "technical": "Record the established stand as plants/m², plants/acre or surviving trees/acre and compare with the locally intended stand; measure soil temperature at the actual seed / root depth, in cm.",
        "warning": "Do not spray merely because insects are present; identify pest, beneficials and local economic threshold."
      },
      {
        "number": 4,
        "name": "Vegetative growth / squaring",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later retained fruiting sites, boll weight and lint quality-forming structures.",
        "timing": "From expanding canopy to visible squares",
        "actions": [
          "Inspect squares, terminals and beneficial insects",
          "Balance nutrition and avoid rank vegetative growth"
        ],
        "technical": "Record root-zone depth in cm and measured volumetric moisture in % where available. Rain is in mm; rainfall does not establish infiltration or a refill dose. Use soil / leaf tests before applying a nutrient correction.",
        "warning": "Avoid repeated use of one insecticide mode of action and unnecessary mixtures."
      },
      {
        "number": 5,
        "name": "Flowering / boll set",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s retained fruiting sites, boll weight and lint quality.",
        "timing": "As flowers open and young bolls set",
        "actions": [
          "Scout flowers and young bolls for insect damage",
          "Base irrigation on crop demand and actual soil condition"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Do not assume Bt seed controls all pests or eliminates pink-bollworm scouting."
      },
      {
        "number": 6,
        "name": "Boll filling / opening",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "As bolls enlarge and subsequently open",
        "actions": [
          "Inspect boll rot and pink-bollworm signs",
          "Keep water and late nitrogen from delaying maturity"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not force boll opening with an unverified chemical programme."
      },
      {
        "number": 7,
        "name": "Picking / post-harvest sanitation",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "When bolls are fully open and lint is dry; then after the final picking",
        "actions": [
          "Pick clean, fully open dry cotton separately from stained cotton",
          "Keep lint off soil and remove crop residues after final picking"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Never mix wet cotton or plastic contamination with clean lint."
      }
    ]
  },
  "maize": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/1",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "fall armyworm, stem borer, stalk rot and lodging",
    "stages": [
      {
        "number": 1,
        "name": "Land preparation",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later ear number, kernel set and grain weight.",
        "timing": "Before the local spring or autumn maize sowing window",
        "actions": [
          "Prepare a level seedbed with drainage",
          "Select the intended grain, silage or fodder production system"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Do not apply a fodder-harvest calendar to grain maize."
      },
      {
        "number": 2,
        "name": "Sowing",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "At the appropriate district season for the named hybrid or variety",
        "actions": [
          "Calibrate the planter for the named seed lot and population",
          "Place seed consistently into moist soil"
        ],
        "technical": "KP lists 12–16 kg/acre for several open-pollinated varieties and 8–10 kg/acre for several hybrids; seed size, germination and the named hybrid target population determine the final rate.",
        "warning": "Do not use the same kg/acre for all seed sizes and hybrids."
      },
      {
        "number": 3,
        "name": "Emergence / early leaves",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "From emergence through early leaf establishment",
        "actions": [
          "Count plants and inspect whorls for fall-armyworm injury",
          "Identify larvae before deciding on a labelled treatment"
        ],
        "technical": "Identify V1–V3 by fully visible leaf collars, not leaf tips. Count established plants/acre and compare with the named hybrid target; measure actual soil moisture before an irrigation decision.",
        "warning": "Do not confuse whorl damage alone with a count of live larvae or an economic threshold."
      },
      {
        "number": 4,
        "name": "Rapid vegetative growth",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later ear number, kernel set and grain weight-forming structures.",
        "timing": "While stem and leaf growth accelerate, before tasselling",
        "actions": [
          "Control weeds before crop competition becomes severe",
          "Split soil-test-based nitrogen to growth and moisture conditions"
        ],
        "technical": "Record visible leaf-collar stage from V4 onward; the final leaf number varies by hybrid. Measure the stand and root-zone moisture; express any locally recommended nitrogen split as kg nutrient/acre, not an assumed bag count.",
        "warning": "Avoid flooding or heavy late nitrogen that weakens the crop and increases lodging."
      },
      {
        "number": 5,
        "name": "Tasselling / silking / pollination",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s ear number, kernel set and grain weight.",
        "timing": "As tassels shed pollen and fresh silks emerge",
        "actions": [
          "Protect the crop from avoidable water stress at silking",
          "Inspect pollination and synchronize irrigation with actual soil demand"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds. VT is tasselling and R1 is silking; inspect both pollen shed and fresh silk emergence rather than assuming a fixed DAS.",
        "warning": "Do not allow avoidable drought at tasselling / silking or spray during active pollinator exposure."
      },
      {
        "number": 6,
        "name": "Kernel filling / physiological maturity",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "From developing kernels until black-layer physiological maturity",
        "actions": [
          "Inspect ears and stalk strength",
          "Distinguish physiological maturity from moisture suitable for storage"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred. R2–R6 describe kernel development through physiological maturity; R6 black layer is not a safe-storage moisture reading.",
        "warning": "Do not infer safe storage moisture from black-layer formation."
      },
      {
        "number": 7,
        "name": "Harvest / drying / storage",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "After maturity, when field access and measured grain moisture suit harvest",
        "actions": [
          "Harvest mature grain and dry without delay",
          "Reject mouldy lots and test suspect grain for mycotoxins"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Do not blend mouldy grain with sound grain to hide contamination."
      }
    ]
  },
  "potato": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/4",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "late blight, early blight, aphids, cutworms and tuber soft rot",
    "stages": [
      {
        "number": 1,
        "name": "Field preparation / seed selection",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later healthy tuber number, size and market quality.",
        "timing": "Before the locally appropriate autumn, spring or hill crop planting window",
        "actions": [
          "Rotate out of solanaceous hosts where practical",
          "Select certified healthy seed and prepare drained ridges"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Do not plant visibly rotting seed or return infected culls to seed lots."
      },
      {
        "number": 2,
        "name": "Planting",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "When healthy seed and a moist, workable ridge seedbed are ready",
        "actions": [
          "Grade seed tubers and calibrate placement to the intended grade",
          "Use the district sowing reference rather than one national date"
        ],
        "technical": "KP lists 1,000–1,200 kg seed tubers/acre for Cardinal and Desiree entries; seed grade, whole versus cut tubers and spacing change the actual requirement.",
        "warning": "Do not use one seed-weight rate for every tuber grade or cutting system."
      },
      {
        "number": 3,
        "name": "Emergence / establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "From sprout emergence until a uniform canopy begins developing",
        "actions": [
          "Inspect gaps, stems and early blight symptoms",
          "Cover exposed tubers and maintain ridge integrity"
        ],
        "technical": "Record the established stand as plants/m², plants/acre or surviving trees/acre and compare with the locally intended stand; measure soil temperature at the actual seed / root depth, in cm.",
        "warning": "Do not expose tubers to sunlight or mistake green tubers for a healthy crop indicator."
      },
      {
        "number": 4,
        "name": "Canopy growth / tuber initiation",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later healthy tuber number, size and market quality-forming structures.",
        "timing": "As stolons initiate tubers; confirm by inspecting representative plants",
        "actions": [
          "Earth up before tubers become exposed",
          "Inspect representative plants for tuber initiation and check soil moisture"
        ],
        "technical": "Record root-zone depth in cm and measured volumetric moisture in % where available. Rain is in mm; rainfall does not establish infiltration or a refill dose. Use soil / leaf tests before applying a nutrient correction.",
        "warning": "Do not use flowering date alone to establish tuber initiation or yield."
      },
      {
        "number": 5,
        "name": "Tuber bulking",
        "group": "growing",
        "objective": "Protecting the yield-forming phase supports the crop’s healthy tuber number, size and market quality.",
        "timing": "While tubers actively gain size, rather than using flowering as the only marker",
        "actions": [
          "Maintain even moisture without waterlogging",
          "Scout leaves for late blight and compare the disease-weather signal"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Avoid irrigation swings and prolonged saturated ridges; blight risk is not a diagnosis."
      },
      {
        "number": 6,
        "name": "Skin set / maturation",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "When the crop reaches the market objective and tuber skin is setting",
        "actions": [
          "Check skin set and sample tuber size",
          "Coordinate haulm management with seed / ware purpose and local advice"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not desiccate or remove haulms using an unlabelled product or before the intended crop objective."
      },
      {
        "number": 7,
        "name": "Lifting / curing / storage",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "When skin is adequately set, soil is workable and storage / market handling is ready",
        "actions": [
          "Lift carefully in workable soil and keep tubers shaded",
          "Separate damaged or rotting tubers before curing and storage"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Never eat or market green / severely damaged tubers as sound produce; avoid wounds and wet storage."
      }
    ]
  },
  "sugarcane": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/2",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "early shoot borer, top borer, pyrilla, red rot and smut",
    "stages": [
      {
        "number": 1,
        "name": "Land preparation / seed-cane selection",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later millable stalk population, cane weight and recoverable sugar.",
        "timing": "Before the district spring or autumn planting cycle",
        "actions": [
          "Select disease-free seed cane from a reliable source",
          "Prepare drainage and a long-duration nutrient plan"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Do not multiply red-rot- or smut-affected seed cane."
      },
      {
        "number": 2,
        "name": "Sett planting",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "Within the chosen local cane planting window",
        "actions": [
          "Plant viable healthy setts with the locally recommended method",
          "Record variety, planting date and the seed-cane lot"
        ],
        "technical": "KP lists 80–100 maunds/acre for Mardan-2005 / Mardan-93 and 4,000–5,000 kg/acre for CP-1827; these are distinct variety references. Sett health and viable buds matter more than using one universal weight.",
        "warning": "Do not treat different variety seed-weight entries as an interchangeable national dose."
      },
      {
        "number": 3,
        "name": "Germination / establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "From bud sprouting until stools establish",
        "actions": [
          "Inspect bud emergence and gaps",
          "Confirm termites, rots or moisture problems before replanting"
        ],
        "technical": "Record the established stand as plants/m², plants/acre or surviving trees/acre and compare with the locally intended stand; measure soil temperature at the actual seed / root depth, in cm.",
        "warning": "Do not flood poorly drained furrows to compensate for missing buds."
      },
      {
        "number": 4,
        "name": "Tillering / stool development",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later millable stalk population, cane weight and recoverable sugar-forming structures.",
        "timing": "While new shoots build the future millable-stalk population",
        "actions": [
          "Manage weeds and inspect stool density",
          "Earth up and split locally recommended nutrition to growth"
        ],
        "technical": "Record root-zone depth in cm and measured volumetric moisture in % where available. Rain is in mm; rainfall does not establish infiltration or a refill dose. Use soil / leaf tests before applying a nutrient correction.",
        "warning": "Avoid late earthing-up that damages roots or buries weak stools."
      },
      {
        "number": 5,
        "name": "Grand growth / stalk elongation",
        "group": "growing",
        "objective": "Protecting the yield-forming phase supports the crop’s millable stalk population, cane weight and recoverable sugar.",
        "timing": "During rapid stalk elongation; flowering is not required for commercial sugar yield",
        "actions": [
          "Maintain root-zone moisture and drainage during rapid growth",
          "Inspect borers, pyrilla and lodging risk"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Avoid waterlogging and late excessive nitrogen; grand growth is not a flowering-stage recommendation."
      },
      {
        "number": 6,
        "name": "Ripening / maturity assessment",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "As stalks mature; use cane quality / mill testing rather than age alone",
        "actions": [
          "Assess cane maturity with the mill or local extension service",
          "Avoid late inputs that prolong immature growth"
        ],
        "technical": "Record actual mill / tester °Brix and pol (%) with the sampling date and variety; apply the mill’s locally agreed maturity / recovery criteria. Weather, cane age or NDVI alone cannot supply these measurements.",
        "warning": "Do not infer sugar recovery or harvest maturity from NDVI alone."
      },
      {
        "number": 7,
        "name": "Harvest / ratoon decision",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "At confirmed maturity and coordinated mill delivery; then inspect stool health for a ratoon",
        "actions": [
          "Coordinate cutting and prompt delivery",
          "Retain a ratoon only from healthy, well-populated stools"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Do not leave cut cane waiting unnecessarily or ratoon a heavily diseased stand."
      }
    ]
  },
  "chickpea": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/80",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "gram blight, wilt, root rot and pod borer",
    "stages": [
      {
        "number": 1,
        "name": "Land preparation",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later pod number, seed filling and seed quality.",
        "timing": "Before the local Rabi window, when soil is workable",
        "actions": [
          "Select a well-drained field and review previous legume diseases",
          "Test soil before deciding phosphorus or other nutrient inputs"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Avoid waterlogged fields with a history of severe wilt."
      },
      {
        "number": 2,
        "name": "Sowing",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "Within the local chickpea sowing window with adequate seed-zone moisture",
        "actions": [
          "Sow clean, locally recommended seed",
          "Confirm the variety-specific seed rate and any locally recommended inoculant"
        ],
        "technical": "KP lists 25–30 kg seed/acre for several Karak / Thal entries and 30–40 kg/acre for Dashat; confirm desi / kabuli seed size and the variety.",
        "warning": "Do not use one kg/acre for small desi and large kabuli seed."
      },
      {
        "number": 3,
        "name": "Seedling establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "From emergence until the stand is rooted and uniform",
        "actions": [
          "Count the stand and inspect seedlings for wilt / root damage",
          "Maintain drainage rather than applying routine flood irrigation"
        ],
        "technical": "Record the established stand as plants/m², plants/acre or surviving trees/acre and compare with the locally intended stand; measure soil temperature at the actual seed / root depth, in cm.",
        "warning": "Do not diagnose all seedling collapse as water shortage."
      },
      {
        "number": 4,
        "name": "Branching / canopy growth",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later pod number, seed filling and seed quality-forming structures.",
        "timing": "As branches develop, before flowering",
        "actions": [
          "Control weeds before crop competition increases",
          "Inspect branches for blight and record symptoms"
        ],
        "technical": "Record root-zone depth in cm and measured volumetric moisture in % where available. Rain is in mm; rainfall does not establish infiltration or a refill dose. Use soil / leaf tests before applying a nutrient correction.",
        "warning": "Avoid unnecessary nitrogen and an excessively dense, humid canopy."
      },
      {
        "number": 5,
        "name": "Flowering / pod set",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s pod number, seed filling and seed quality.",
        "timing": "When flowers open and young pods form",
        "actions": [
          "Scout flowers and pods for live pod-borer larvae",
          "Protect beneficial insects and confirm local thresholds before treatment"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Never infer an insecticide need from favourable weather alone."
      },
      {
        "number": 6,
        "name": "Pod filling / maturation",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "While seeds fill and pods begin drying",
        "actions": [
          "Check actual root-zone moisture and pod fill",
          "Separate normal maturity from premature disease-related drying"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Avoid late flooding that promotes root rot or delays maturity."
      },
      {
        "number": 7,
        "name": "Harvest / storage",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "When pods and seed are mature and dry enough for the intended storage system",
        "actions": [
          "Harvest mature plants without excessive shattering",
          "Dry, clean and inspect grain before storage"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Do not store moist pulses or mix infested grain with sound grain."
      }
    ]
  },
  "mustard": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/74",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "aphids, sawfly, white rust and Alternaria spotting",
    "stages": [
      {
        "number": 1,
        "name": "Land preparation",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later siliqua number, seed filling and oil quality.",
        "timing": "Before the local autumn sowing window",
        "actions": [
          "Prepare a fine, firm, drained seedbed",
          "Identify mustard species and the intended oil / seed market"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Avoid mixing recommendations for different Brassica species."
      },
      {
        "number": 2,
        "name": "Sowing",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "Within the local Rabi window for mustard / rapeseed / canola",
        "actions": [
          "Calibrate small-seed equipment carefully",
          "Sow clean seed at the locally confirmed rate"
        ],
        "technical": "KP lists 1.5–2 kg seed/acre for several named mustard / canola entries; confirm species, variety, germination and local spacing.",
        "warning": "Do not bury small seed too deeply or broadcast an uncalibrated amount."
      },
      {
        "number": 3,
        "name": "Seedling establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "From emergence until the stand is established",
        "actions": [
          "Count seedlings and thin only to the local target",
          "Inspect flea / chewing damage and maintain drainage"
        ],
        "technical": "Record the established stand as plants/m², plants/acre or surviving trees/acre and compare with the locally intended stand; measure soil temperature at the actual seed / root depth, in cm.",
        "warning": "Avoid routine pesticide application without an identified pest."
      },
      {
        "number": 4,
        "name": "Rosette / branching",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later siliqua number, seed filling and oil quality-forming structures.",
        "timing": "While rosettes and branches develop",
        "actions": [
          "Manage weeds before canopy closure",
          "Apply only soil-test-based nutrition appropriate to the species"
        ],
        "technical": "Record root-zone depth in cm and measured volumetric moisture in % where available. Rain is in mm; rainfall does not establish infiltration or a refill dose. Use soil / leaf tests before applying a nutrient correction.",
        "warning": "Avoid excessive nitrogen and poor drainage."
      },
      {
        "number": 5,
        "name": "Flowering / pod set",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s siliqua number, seed filling and oil quality.",
        "timing": "As flowering progresses and pods set",
        "actions": [
          "Scout aphids and diseased racemes",
          "Protect pollinators by avoiding insecticide exposure during active bloom"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Do not spray bee-active flowering plants without a specifically justified, labelled programme."
      },
      {
        "number": 6,
        "name": "Seed filling / ripening",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "As seeds fill and pods change towards maturity",
        "actions": [
          "Check seed filling and lodging",
          "Plan harvest before extensive pod splitting"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not confuse drought-shortened pods with normal maturity."
      },
      {
        "number": 7,
        "name": "Harvest / storage",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "When pods reach harvest maturity before excessive shattering",
        "actions": [
          "Cut or combine at the locally appropriate maturity",
          "Dry and clean oilseed before safe storage"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Do not wait for every pod to become brittle; shattering can cause large losses."
      }
    ]
  },
  "sunflower": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/79",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "cutworms, head / stalk rots, aphids and seed weevil",
    "stages": [
      {
        "number": 1,
        "name": "Land preparation",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later filled seed number, seed weight and oil quality.",
        "timing": "Before the locally selected spring or autumn cycle",
        "actions": [
          "Prepare a drained seedbed and select a suitable hybrid",
          "Review rotation and prior head-rot problems"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Avoid repeating a susceptible crop on a badly diseased field without local rotation advice."
      },
      {
        "number": 2,
        "name": "Sowing",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "Within the district hybrid sowing window",
        "actions": [
          "Calibrate seed number and row spacing for the named hybrid",
          "Record seed lot and germination"
        ],
        "technical": "KP lists 5–6 kg/ha for one group of hybrids and 2 kg/acre for other named entries; these are different listings and units, not a single universal rate.",
        "warning": "Never confuse kg/ha and kg/acre."
      },
      {
        "number": 3,
        "name": "Emergence / establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "From emergence until a uniform stand develops",
        "actions": [
          "Inspect stand losses and cutworms",
          "Replace missing plants only within a locally useful establishment period"
        ],
        "technical": "Record the established stand as plants/m², plants/acre or surviving trees/acre and compare with the locally intended stand; measure soil temperature at the actual seed / root depth, in cm.",
        "warning": "Do not infer a cutworm treatment from missing plants alone."
      },
      {
        "number": 4,
        "name": "Vegetative growth / bud development",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later filled seed number, seed weight and oil quality-forming structures.",
        "timing": "While canopy and the flower bud develop",
        "actions": [
          "Control weeds and inspect developing buds",
          "Balance nutrition without creating excessive soft growth"
        ],
        "technical": "Record root-zone depth in cm and measured volumetric moisture in % where available. Rain is in mm; rainfall does not establish infiltration or a refill dose. Use soil / leaf tests before applying a nutrient correction.",
        "warning": "Avoid unnecessary late nitrogen or over-irrigation."
      },
      {
        "number": 5,
        "name": "Flowering / seed set",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s filled seed number, seed weight and oil quality.",
        "timing": "As heads flower and seeds set",
        "actions": [
          "Protect pollinator access",
          "Check root-zone moisture and inspect flowering heads"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Do not spray pollinators during active flowering."
      },
      {
        "number": 6,
        "name": "Seed filling / maturity",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "While seeds fill and head backs approach maturity",
        "actions": [
          "Inspect heads for rot and seed development",
          "Plan bird management without contaminating harvested seed"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not use NDVI alone to establish oil content or harvest maturity."
      },
      {
        "number": 7,
        "name": "Harvest / drying",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "When heads and seeds meet harvest-maturity and measured-moisture requirements",
        "actions": [
          "Harvest mature heads and dry promptly",
          "Measure seed moisture before bagging"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Do not seal-store damp oilseed or mouldy heads."
      }
    ]
  },
  "groundnut": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/89",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "termites, white grubs, damping-off and root rot",
    "stages": [
      {
        "number": 1,
        "name": "Land preparation",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later pegging success, mature pod number and kernel quality.",
        "timing": "Before the local spring / Kharif sowing window",
        "actions": [
          "Prepare a friable, drained pegging zone",
          "Test soil before choosing calcium or fertilizer inputs"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Avoid compacted or persistently waterlogged pegging soil."
      },
      {
        "number": 2,
        "name": "Sowing",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "When soil moisture and the district sowing window fit",
        "actions": [
          "Sow healthy kernels carefully to avoid damage",
          "Calibrate seed rate for the named variety and seed size"
        ],
        "technical": "KP lists 70 kg/acre for BARI-2000 / BARI-2011, with 80,000–90,000 plants/acre in those entries; confirm kernel size, germination and the locally intended plant population.",
        "warning": "Do not use damaged or mouldy kernels as seed."
      },
      {
        "number": 3,
        "name": "Seedling establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "From emergence until the stand is established",
        "actions": [
          "Count plants and inspect root and termite damage",
          "Avoid waterlogging around seedlings"
        ],
        "technical": "Record the established stand as plants/m², plants/acre or surviving trees/acre and compare with the locally intended stand; measure soil temperature at the actual seed / root depth, in cm.",
        "warning": "Do not flood weak plants without diagnosing the cause."
      },
      {
        "number": 4,
        "name": "Branching / flowering",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later pegging success, mature pod number and kernel quality-forming structures.",
        "timing": "As branches expand and flowers appear",
        "actions": [
          "Manage weeds before pegging",
          "Protect branches and the soil surface from unnecessary disturbance"
        ],
        "technical": "Record root-zone depth in cm and measured volumetric moisture in % where available. Rain is in mm; rainfall does not establish infiltration or a refill dose. Use soil / leaf tests before applying a nutrient correction.",
        "warning": "Avoid deep cultivation once pegs are forming."
      },
      {
        "number": 5,
        "name": "Pegging / early pod development",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s pegging success, mature pod number and kernel quality.",
        "timing": "When pegs enter the soil and young pods develop",
        "actions": [
          "Keep the pegging zone workable",
          "Inspect actual soil moisture and confirm calcium needs from local soil advice"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Do not disturb established pegs or apply unverified calcium rates."
      },
      {
        "number": 6,
        "name": "Pod filling / maturity checks",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "During kernel filling; inspect representative pods for maturity",
        "actions": [
          "Lift sample plants and examine pods and kernels",
          "Balance lifting date against soil moisture and forecast rain"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not judge pod maturity only from green foliage."
      },
      {
        "number": 7,
        "name": "Lifting / curing / storage",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "When enough pods are mature and soil is workable for lifting",
        "actions": [
          "Lift mature pods without excessive loss",
          "Cure promptly and separate mouldy or damaged pods"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Do not bag damp groundnuts; poor drying increases mould and aflatoxin risk."
      }
    ]
  },
  "barley": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/57",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "smut, powdery mildew, armyworm and wild oats",
    "stages": [
      {
        "number": 1,
        "name": "Land preparation",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later grain filling and intended feed or malt quality.",
        "timing": "Before the district sowing window, while soil is friable rather than saturated",
        "actions": [
          "Level the seedbed and clear irrigation / drainage channels",
          "Test soil and plan balanced fertilizer before sowing"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Avoid cultivating wet soil or assuming all November dates fit every district."
      },
      {
        "number": 2,
        "name": "Sowing",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "Within the locally confirmed Rabi sowing window; use the district reference shown above",
        "actions": [
          "Drill certified seed into a moist, uniform seedbed",
          "Calibrate the drill for the named variety and germination test"
        ],
        "technical": "KP lists 35–40 kg seed/acre for several named barley entries; confirm variety, germination and intended feed / malt use.",
        "warning": "Avoid compensating for poor germination with an unverified fertilizer or pesticide dose."
      },
      {
        "number": 3,
        "name": "Emergence / crown-root establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "From uniform emergence until crown roots are established",
        "actions": [
          "Count established seedlings and inspect crown roots",
          "Check soil moisture before the first irrigation"
        ],
        "technical": "Record the established stand as plants/m², plants/acre or surviving trees/acre and compare with the locally intended stand; measure soil temperature at the actual seed / root depth, in cm.",
        "warning": "Do not delay a needed crown-root irrigation solely because rain is forecast; inspect actual root-zone moisture."
      },
      {
        "number": 4,
        "name": "Tillering / stem elongation",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later grain filling and intended feed or malt quality-forming structures.",
        "timing": "When visible tillers develop and stems begin elongating",
        "actions": [
          "Control competitive weeds before canopy closure",
          "Split locally recommended nitrogen to crop demand and field moisture"
        ],
        "technical": "Record root-zone depth in cm and measured volumetric moisture in % where available. Rain is in mm; rainfall does not establish infiltration or a refill dose. Use soil / leaf tests before applying a nutrient correction.",
        "warning": "Avoid excessive nitrogen and irrigation that increase lodging and dense, disease-prone growth."
      },
      {
        "number": 5,
        "name": "Booting / heading / flowering",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s grain filling and intended feed or malt quality.",
        "timing": "From swollen flag-leaf sheath through head emergence and anther extrusion",
        "actions": [
          "Inspect heads and upper leaves for disease",
          "Maintain locally appropriate moisture during heading and flowering"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Do not transfer wheat fungicide rates or grain-quality specifications directly to barley."
      },
      {
        "number": 6,
        "name": "Grain filling / maturation",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "From milk / dough grain to physiological maturity",
        "actions": [
          "Maintain moisture according to root-zone checks",
          "Inspect lodging and grain fill before ending irrigation"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Avoid premature irrigation withdrawal or late heavy irrigation that increases lodging."
      },
      {
        "number": 7,
        "name": "Harvest / post-harvest",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "When grain is mature and its moisture is suitable for the harvesting and storage system",
        "actions": [
          "Harvest mature grain in a dry weather window",
          "Measure grain moisture and dry grain before sealed storage"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Do not combine or seal-store damp grain; forecast dryness is not a grain-moisture measurement."
      }
    ]
  },
  "onion": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/19",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "thrips, downy mildew, purple blotch and bulb / bacterial soft rot",
    "stages": [
      {
        "number": 1,
        "name": "Land / nursery preparation",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later uniform bulb initiation, bulb size and storage quality.",
        "timing": "Before the local nursery / transplanting cycle",
        "actions": [
          "Prepare a clean, drained nursery and main field",
          "Select a variety matched to local day length"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Avoid using long-day and short-day onion recommendations interchangeably."
      },
      {
        "number": 2,
        "name": "Nursery sowing / planting",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "At the local date for nursery sowing, sets or direct seeding",
        "actions": [
          "Confirm the establishment method and calibrate seed use",
          "Reject diseased planting material"
        ],
        "technical": "KP lists 6–8 kg seed/acre for Swat-I / Tirch Mir and a different Swat Selection entry; the catalogue does not clearly separate nursery and direct-seeded use, so confirm method before using the rate.",
        "warning": "Do not apply an ambiguous nursery seed rate directly to a field."
      },
      {
        "number": 3,
        "name": "Transplant establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "Until transplants recover and produce new roots",
        "actions": [
          "Check rooting and replace only viable gaps",
          "Maintain moisture without stagnant water"
        ],
        "technical": "Record the established stand as plants/m², plants/acre or surviving trees/acre and compare with the locally intended stand; measure soil temperature at the actual seed / root depth, in cm.",
        "warning": "Do not treat transplant shock as proof of a nutrient deficiency."
      },
      {
        "number": 4,
        "name": "Leaf / canopy development",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later uniform bulb initiation, bulb size and storage quality-forming structures.",
        "timing": "While leaves develop before strong bulbing",
        "actions": [
          "Scout thrips and leaf lesions",
          "Balance nutrition to preserve healthy leaf area"
        ],
        "technical": "Record root-zone depth in cm and measured volumetric moisture in % where available. Rain is in mm; rainfall does not establish infiltration or a refill dose. Use soil / leaf tests before applying a nutrient correction.",
        "warning": "Do not infer mildew infection from humidity alone."
      },
      {
        "number": 5,
        "name": "Bulb initiation",
        "group": "growing",
        "objective": "Protecting the yield-forming phase supports the crop’s uniform bulb initiation, bulb size and storage quality.",
        "timing": "When the variety begins visible bulbing under local day length",
        "actions": [
          "Inspect bulb initiation and stand uniformity",
          "Keep moisture even and avoid injuring developing bulbs"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Avoid root disturbance and moisture extremes."
      },
      {
        "number": 6,
        "name": "Bulb filling / neck maturity",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "As bulbs enlarge and necks approach natural maturity",
        "actions": [
          "Check neck softening and bulb size",
          "Avoid late excess nitrogen and irrigation that delay maturity"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not force a wet immature crop into storage to fit a dry forecast day."
      },
      {
        "number": 7,
        "name": "Lifting / curing / storage",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "When neck maturity and curing weather fit the intended market",
        "actions": [
          "Lift carefully and cure with ventilation",
          "Store only sound, dry-necked bulbs"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Do not seal-store thick-necked, wet or rotting bulbs."
      }
    ]
  },
  "tomato": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/5",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "whitefly, thrips, Tuta absoluta, early / late blight, wilt and fruit rot",
    "stages": [
      {
        "number": 1,
        "name": "Land / nursery preparation",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later fruit set, marketable fruit size and quality.",
        "timing": "Before the locally selected open-field or protected crop cycle",
        "actions": [
          "Prepare clean nursery media and field drainage",
          "Choose a locally suitable disease-tolerant variety"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Avoid reusing contaminated media or introducing diseased seedlings."
      },
      {
        "number": 2,
        "name": "Nursery sowing / transplanting",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "At the nursery / transplant date that avoids local heat and frost extremes",
        "actions": [
          "Raise healthy seedlings and harden them appropriately",
          "Transplant without damaging roots"
        ],
        "technical": "KP lists 120–150 g seed to raise nursery for one acre for some entries and 80–100 g for one named hybrid; verify germination, nursery losses and the named hybrid.",
        "warning": "Do not transfer tunnel recommendations unchanged to an exposed field."
      },
      {
        "number": 3,
        "name": "Transplant establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "Until transplants root and resume growth",
        "actions": [
          "Check plant recovery and irrigation uniformity",
          "Remove severely diseased plants after confirming the cause"
        ],
        "technical": "Record the established stand as plants/m², plants/acre or surviving trees/acre and compare with the locally intended stand; measure soil temperature at the actual seed / root depth, in cm.",
        "warning": "Do not over-irrigate wilted plants before checking root disease."
      },
      {
        "number": 4,
        "name": "Vegetative growth / support",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later fruit set, marketable fruit size and quality-forming structures.",
        "timing": "As canopy and support structure develop",
        "actions": [
          "Stake or train the intended crop system",
          "Scout leaf miners, whitefly and blight symptoms"
        ],
        "technical": "Record root-zone depth in cm and measured volumetric moisture in % where available. Rain is in mm; rainfall does not establish infiltration or a refill dose. Use soil / leaf tests before applying a nutrient correction.",
        "warning": "Do not spray on the basis of a trap catch alone without field scouting and a local threshold."
      },
      {
        "number": 5,
        "name": "Flowering / fruit set",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s fruit set, marketable fruit size and quality.",
        "timing": "As flower clusters bloom and fruits set",
        "actions": [
          "Protect flowers from avoidable heat / water stress",
          "Maintain ventilation in protected crops"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Do not assume a predicted hot hour means confirmed flower abortion."
      },
      {
        "number": 6,
        "name": "Fruit development / ripening",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "As fruits expand and reach the market-required ripeness",
        "actions": [
          "Maintain consistent moisture and inspect fruit defects",
          "Separate physiological disorders from diagnosed disease"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not diagnose blossom-end rot as a pathogen requiring fungicide."
      },
      {
        "number": 7,
        "name": "Picking / grading / post-harvest",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "When fruit reaches the intended local / distant-market maturity",
        "actions": [
          "Pick without bruising and shade fruit promptly",
          "Grade and pack clean, sound fruit for the intended market"
        ],
        "technical": "The app harvest screen needs ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours. Actual grain / seed / fruit maturity, moisture and product pre-harvest interval remain separate requirements.",
        "warning": "Observe the actual product pre-harvest interval; a weather window does not waive it."
      }
    ]
  },
  "berseem": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/62",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "armyworm, caterpillars, stem / root rot and white mould",
    "stages": [
      {
        "number": 1,
        "name": "Land preparation",
        "group": "pre-sowing",
        "objective": "A suitable seedbed and a locally appropriate planting plan protect establishment and later healthy establishment, repeated forage yield and intended seed production.",
        "timing": "Before the local autumn sowing window",
        "actions": [
          "Level the field and provide drainage",
          "Select clean seed and confirm whether forage or seed is the objective"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Avoid sowing into persistently waterlogged ground."
      },
      {
        "number": 2,
        "name": "Sowing",
        "group": "sowing",
        "objective": "Correct planting establishes the stand needed for the intended yield and quality.",
        "timing": "Within the local Rabi fodder establishment window",
        "actions": [
          "Calibrate seed distribution uniformly",
          "Record variety and sowing date"
        ],
        "technical": "KP lists 6–8 kg seed/acre for several named berseem entries; confirm seed purity, germination, variety and local sowing method.",
        "warning": "Do not mix seed-production and forage-harvest timing rules."
      },
      {
        "number": 3,
        "name": "Seedling establishment",
        "group": "growing",
        "objective": "Uniform rooting and survival preserve the productive population.",
        "timing": "From emergence until roots and an even stand develop",
        "actions": [
          "Inspect establishment and root-rot patches",
          "Avoid drowning a weak stand"
        ],
        "technical": "Record the established stand as plants/m², plants/acre or surviving trees/acre and compare with the locally intended stand; measure soil temperature at the actual seed / root depth, in cm.",
        "warning": "Do not infer measured leaf wetness from high humidity."
      },
      {
        "number": 4,
        "name": "Vegetative canopy development",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later healthy establishment, repeated forage yield and intended seed production-forming structures.",
        "timing": "As forage canopy develops before the first cut",
        "actions": [
          "Control contaminating weeds",
          "Monitor canopy and soil moisture before planning a cut"
        ],
        "technical": "Record root-zone depth in cm and measured volumetric moisture in % where available. Rain is in mm; rainfall does not establish infiltration or a refill dose. Use soil / leaf tests before applying a nutrient correction.",
        "warning": "Keep toxic weeds and pesticide-contaminated material out of fodder."
      },
      {
        "number": 5,
        "name": "First cutting decision",
        "group": "growing",
        "objective": "Protecting the yield-forming phase supports the crop’s healthy establishment, repeated forage yield and intended seed production.",
        "timing": "When plants are sufficiently established for the locally recommended first cut",
        "actions": [
          "Check crop vigour and dry handling conditions",
          "Cut without damaging the regenerative base"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Do not cut a poorly rooted young stand solely because weather is dry."
      },
      {
        "number": 6,
        "name": "Regrowth / optional seed-crop transition",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "After each cut; if retaining a seed crop, follow local flowering-management dates",
        "actions": [
          "Inspect regrowth and moisture after cutting",
          "Separate a seed-production programme from repeated forage cutting"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not assume repeated cutting and seed production share the same stage calendar."
      },
      {
        "number": 7,
        "name": "Final cuts / seed harvest / storage",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "At the final useful forage cut or at seed maturity for a deliberately retained seed crop",
        "actions": [
          "Harvest clean forage or mature seed according to the objective",
          "Handle and store only suitable, unspoiled material"
        ],
        "technical": "Record cutting date, actual forage condition and the intended use. For a deliberately retained seed crop, record seed maturity and moisture separately. Follow all pesticide fodder / grazing intervals; the app’s dry-work screen does not certify feed safety.",
        "warning": "Observe feed / grazing restrictions and never feed mouldy or contaminated fodder."
      }
    ]
  },
  "mango": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/32",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "mango hopper, mealybug, fruit fly, powdery mildew and anthracnose",
    "stages": [
      {
        "number": 1,
        "name": "Site / new-orchard planning",
        "group": "pre-sowing",
        "objective": "A suitable site, healthy planting stock and a locally appropriate orchard plan protect long-term productivity.",
        "timing": "Before a new orchard is planted; existing orchards begin with annual canopy care",
        "actions": [
          "Assess drainage, soil, water quality and frost exposure",
          "Select a locally suitable cultivar and healthy certified planting stock"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Do not apply a newly planted orchard programme to an established bearing orchard."
      },
      {
        "number": 2,
        "name": "Planting / establishment",
        "group": "sowing",
        "objective": "Correct planting and establishment preserve the future productive orchard population.",
        "timing": "Within the locally recommended planting season for the species and elevation",
        "actions": [
          "Plant with the locally approved spacing and rootstock / pollinizer plan",
          "Keep the graft union or planting depth appropriate to the supplied stock"
        ],
        "technical": "The retrieved KP page does not provide a verified mango planting density; obtain a spacing plan for the cultivar, rootstock and production system.",
        "warning": "Do not use one planting density across rootstocks or high-density systems."
      },
      {
        "number": 3,
        "name": "Young-tree establishment",
        "group": "growing",
        "objective": "Healthy rooting and survival establish trees or palms capable of sustained production.",
        "timing": "Until new trees or palms are well rooted; this can span more than one season",
        "actions": [
          "Inspect survival, roots and irrigation uniformity",
          "Protect young plants from grazing, heat and frost as locally appropriate"
        ],
        "technical": "Record surviving trees or palms per acre, planting age and rootstock / cultivar. Measure irrigation delivery in litres per tree or mm over the wetted area; no dose is inferred without age, soil, root-zone and system information.",
        "warning": "Do not convert a nearby air-station reading into measured orchard soil moisture."
      },
      {
        "number": 4,
        "name": "Annual canopy / pre-bloom care",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later fruit size, maturity and market quality-forming structures.",
        "timing": "Before the locally observed reproductive cycle, not by a national fixed date",
        "actions": [
          "Prune or manage canopy according to species and bearing habit",
          "Base nutrition on orchard soil / leaf tests and the actual tree age"
        ],
        "technical": "Record pruning date, canopy condition, tree age and leaf / soil analysis in the laboratory’s stated units. Plan nutrition from locally interpreted tests; a per-acre annual-crop fertilizer dose is not an orchard-tree dose.",
        "warning": "Avoid pruning or nitrogen programmes that conflict with the species bearing habit."
      },
      {
        "number": 5,
        "name": "Panicle Emergence / Flowering",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s fruit size, maturity and market quality.",
        "timing": "When panicle emergence / flowering is observed in the actual orchard",
        "actions": [
          "Inspect flowers and actual fruit set",
          "Protect pollination and scout the species-specific pests and diseases"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Do not expose pollinators to unnecessary insecticides; confirm a local intervention and label."
      },
      {
        "number": 6,
        "name": "Fruit development / maturity",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "From confirmed fruit set through the intended harvest maturity",
        "actions": [
          "Inspect representative fruit for maturity and pest injury",
          "Match water management to root-zone evidence and crop load"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not infer harvest maturity, fruit quality or yield directly from NDVI."
      },
      {
        "number": 7,
        "name": "Harvest / post-harvest orchard care",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "At cultivar-specific harvest maturity, then after the crop is removed",
        "actions": [
          "Pick carefully at market-appropriate maturity",
          "Remove infected fallen fruit and plan post-harvest orchard sanitation"
        ],
        "technical": "Record actual cultivar maturity, measured fruit quality and handling condition. The app’s dry harvest screen uses ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours; it does not measure fruit maturity, orchard trafficability or the product pre-harvest interval.",
        "warning": "Observe pesticide pre-harvest intervals and separate damaged / rotting fruit from sound produce."
      }
    ]
  },
  "citrus": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/91",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "citrus leaf miner, aphids, root rot, gummosis and fruit drop",
    "stages": [
      {
        "number": 1,
        "name": "Site / new-orchard planning",
        "group": "pre-sowing",
        "objective": "A suitable site, healthy planting stock and a locally appropriate orchard plan protect long-term productivity.",
        "timing": "Before a new orchard is planted; existing orchards begin with annual canopy care",
        "actions": [
          "Assess drainage, soil, water quality and frost exposure",
          "Select a locally suitable cultivar and healthy certified planting stock"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Do not apply a newly planted orchard programme to an established bearing orchard."
      },
      {
        "number": 2,
        "name": "Planting / establishment",
        "group": "sowing",
        "objective": "Correct planting and establishment preserve the future productive orchard population.",
        "timing": "Within the locally recommended planting season for the species and elevation",
        "actions": [
          "Plant with the locally approved spacing and rootstock / pollinizer plan",
          "Keep the graft union or planting depth appropriate to the supplied stock"
        ],
        "technical": "KP lists 110–120 plants/acre for Tarnab Malta / Red Blood entries; this is not a kinnow or high-density rootstock prescription.",
        "warning": "Do not use one planting density across rootstocks or high-density systems."
      },
      {
        "number": 3,
        "name": "Young-tree establishment",
        "group": "growing",
        "objective": "Healthy rooting and survival establish trees or palms capable of sustained production.",
        "timing": "Until new trees or palms are well rooted; this can span more than one season",
        "actions": [
          "Inspect survival, roots and irrigation uniformity",
          "Protect young plants from grazing, heat and frost as locally appropriate"
        ],
        "technical": "Record surviving trees or palms per acre, planting age and rootstock / cultivar. Measure irrigation delivery in litres per tree or mm over the wetted area; no dose is inferred without age, soil, root-zone and system information.",
        "warning": "Do not convert a nearby air-station reading into measured orchard soil moisture."
      },
      {
        "number": 4,
        "name": "Annual canopy / pre-bloom care",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later fruit retention, size and juice quality-forming structures.",
        "timing": "Before the locally observed reproductive cycle, not by a national fixed date",
        "actions": [
          "Prune or manage canopy according to species and bearing habit",
          "Base nutrition on orchard soil / leaf tests and the actual tree age"
        ],
        "technical": "Record pruning date, canopy condition, tree age and leaf / soil analysis in the laboratory’s stated units. Plan nutrition from locally interpreted tests; a per-acre annual-crop fertilizer dose is not an orchard-tree dose.",
        "warning": "Avoid pruning or nitrogen programmes that conflict with the species bearing habit."
      },
      {
        "number": 5,
        "name": "Bud Break / Flowering",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s fruit retention, size and juice quality.",
        "timing": "When bud break / flowering is observed in the actual orchard",
        "actions": [
          "Inspect flowers and actual fruit set",
          "Protect pollination and scout the species-specific pests and diseases"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Do not expose pollinators to unnecessary insecticides; confirm a local intervention and label."
      },
      {
        "number": 6,
        "name": "Fruit development / maturity",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "From confirmed fruit set through the intended harvest maturity",
        "actions": [
          "Inspect representative fruit for maturity and pest injury",
          "Match water management to root-zone evidence and crop load"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not infer harvest maturity, fruit quality or yield directly from NDVI."
      },
      {
        "number": 7,
        "name": "Harvest / post-harvest orchard care",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "At cultivar-specific harvest maturity, then after the crop is removed",
        "actions": [
          "Pick carefully at market-appropriate maturity",
          "Remove infected fallen fruit and plan post-harvest orchard sanitation"
        ],
        "technical": "Record actual cultivar maturity, measured fruit quality and handling condition. The app’s dry harvest screen uses ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours; it does not measure fruit maturity, orchard trafficability or the product pre-harvest interval.",
        "warning": "Observe pesticide pre-harvest intervals and separate damaged / rotting fruit from sound produce."
      }
    ]
  },
  "apple": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/34",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "codling moth, mites, scab and powdery mildew",
    "stages": [
      {
        "number": 1,
        "name": "Site / new-orchard planning",
        "group": "pre-sowing",
        "objective": "A suitable site, healthy planting stock and a locally appropriate orchard plan protect long-term productivity.",
        "timing": "Before a new orchard is planted; existing orchards begin with annual canopy care",
        "actions": [
          "Assess drainage, soil, water quality and frost exposure",
          "Select a locally suitable cultivar and healthy certified planting stock"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Do not apply a newly planted orchard programme to an established bearing orchard."
      },
      {
        "number": 2,
        "name": "Planting / establishment",
        "group": "sowing",
        "objective": "Correct planting and establishment preserve the future productive orchard population.",
        "timing": "Within the locally recommended planting season for the species and elevation",
        "actions": [
          "Plant with the locally approved spacing and rootstock / pollinizer plan",
          "Keep the graft union or planting depth appropriate to the supplied stock"
        ],
        "technical": "KP lists 65 plants/acre for Anna / Samar Gold and 120 plants/acre for some other entries; spacing depends strongly on rootstock and training system.",
        "warning": "Do not use one planting density across rootstocks or high-density systems."
      },
      {
        "number": 3,
        "name": "Young-tree establishment",
        "group": "growing",
        "objective": "Healthy rooting and survival establish trees or palms capable of sustained production.",
        "timing": "Until new trees or palms are well rooted; this can span more than one season",
        "actions": [
          "Inspect survival, roots and irrigation uniformity",
          "Protect young plants from grazing, heat and frost as locally appropriate"
        ],
        "technical": "Record surviving trees or palms per acre, planting age and rootstock / cultivar. Measure irrigation delivery in litres per tree or mm over the wetted area; no dose is inferred without age, soil, root-zone and system information.",
        "warning": "Do not convert a nearby air-station reading into measured orchard soil moisture."
      },
      {
        "number": 4,
        "name": "Annual canopy / pre-bloom care",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later fruit set, size and storage quality-forming structures.",
        "timing": "Before the locally observed reproductive cycle, not by a national fixed date",
        "actions": [
          "Record winter chill using an appropriate model for the cultivar",
          "Prune and manage buds using local elevation-specific advice"
        ],
        "technical": "Record pruning date, canopy condition, tree age and leaf / soil analysis in the laboratory’s stated units. Plan nutrition from locally interpreted tests; a per-acre annual-crop fertilizer dose is not an orchard-tree dose.",
        "warning": "Do not treat simple 0–7.2°C chill hours as validated chill portions or assume a universal chilling requirement."
      },
      {
        "number": 5,
        "name": "Bud Break / Flowering",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s fruit set, size and storage quality.",
        "timing": "When bud break / flowering is observed in the actual orchard",
        "actions": [
          "Inspect flowers and actual fruit set",
          "Protect pollination and scout the species-specific pests and diseases"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Do not expose pollinators to unnecessary insecticides; confirm a local intervention and label."
      },
      {
        "number": 6,
        "name": "Fruit development / maturity",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "From confirmed fruit set through the intended harvest maturity",
        "actions": [
          "Inspect representative fruit for maturity and pest injury",
          "Match water management to root-zone evidence and crop load"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not infer harvest maturity, fruit quality or yield directly from NDVI."
      },
      {
        "number": 7,
        "name": "Harvest / post-harvest orchard care",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "At cultivar-specific harvest maturity, then after the crop is removed",
        "actions": [
          "Pick carefully at market-appropriate maturity",
          "Remove infected fallen fruit and plan post-harvest orchard sanitation"
        ],
        "technical": "Record actual cultivar maturity, measured fruit quality and handling condition. The app’s dry harvest screen uses ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours; it does not measure fruit maturity, orchard trafficability or the product pre-harvest interval.",
        "warning": "Observe pesticide pre-harvest intervals and separate damaged / rotting fruit from sound produce."
      }
    ]
  },
  "dates": {
    "source": {
      "name": "KP Directorate of Agriculture Extension crop catalogue",
      "url": "https://zarat.kp.gov.pk/crops/view_crop/38",
      "reviewed": "2026-10-23",
      "scope": "Crop identity, listed variety seed-rate references and pest / disease catalogue. Stage sequencing and non-chemical management text are an independently authored agronomy synthesis, not a verbatim official package or current district prescription."
    },
    "risk": "red palm weevil, lesser date moth, scale and fruit rot",
    "stages": [
      {
        "number": 1,
        "name": "Site / new-orchard planning",
        "group": "pre-sowing",
        "objective": "A suitable site, healthy planting stock and a locally appropriate orchard plan protect long-term productivity.",
        "timing": "Before a new orchard is planted; existing orchards begin with annual canopy care",
        "actions": [
          "Assess drainage, soil, water quality and frost exposure",
          "Select a locally suitable cultivar and healthy certified planting stock"
        ],
        "technical": "Record field area in acres or hectares, soil-test depth in cm and laboratory nutrient recommendations in kg nutrient/acre or kg/ha; do not substitute fertilizer-bag counts for nutrient rates.",
        "warning": "Do not apply a newly planted orchard programme to an established bearing orchard."
      },
      {
        "number": 2,
        "name": "Planting / establishment",
        "group": "sowing",
        "objective": "Correct planting and establishment preserve the future productive orchard population.",
        "timing": "Within the locally recommended planting season for the species and elevation",
        "actions": [
          "Plant with the locally approved spacing and rootstock / pollinizer plan",
          "Keep the graft union or planting depth appropriate to the supplied stock"
        ],
        "technical": "KP lists 110–130 plants/acre for Dhakki / Gulistan / Zaidi entries; confirm cultivar, sex / pollinizer plan, drainage and system before planting.",
        "warning": "Do not use one planting density across rootstocks or high-density systems."
      },
      {
        "number": 3,
        "name": "Young-tree establishment",
        "group": "growing",
        "objective": "Healthy rooting and survival establish trees or palms capable of sustained production.",
        "timing": "Until new trees or palms are well rooted; this can span more than one season",
        "actions": [
          "Inspect survival, roots and irrigation uniformity",
          "Protect young plants from grazing, heat and frost as locally appropriate"
        ],
        "technical": "Record surviving trees or palms per acre, planting age and rootstock / cultivar. Measure irrigation delivery in litres per tree or mm over the wetted area; no dose is inferred without age, soil, root-zone and system information.",
        "warning": "Do not convert a nearby air-station reading into measured orchard soil moisture."
      },
      {
        "number": 4,
        "name": "Annual canopy / pre-bloom care",
        "group": "growing",
        "objective": "A balanced, healthy canopy supports the later fruit set, ripening and drying quality-forming structures.",
        "timing": "Before the locally observed reproductive cycle, not by a national fixed date",
        "actions": [
          "Prune or manage canopy according to species and bearing habit",
          "Base nutrition on orchard soil / leaf tests and the actual tree age"
        ],
        "technical": "Record pruning date, canopy condition, tree age and leaf / soil analysis in the laboratory’s stated units. Plan nutrition from locally interpreted tests; a per-acre annual-crop fertilizer dose is not an orchard-tree dose.",
        "warning": "Avoid pruning or nitrogen programmes that conflict with the species bearing habit."
      },
      {
        "number": 5,
        "name": "Spathe Opening / Pollination",
        "group": "flowering",
        "objective": "Protecting the yield-forming phase supports the crop’s fruit set, ripening and drying quality.",
        "timing": "When spathe opening / pollination is observed in the actual orchard",
        "actions": [
          "Pollinate receptive female spathes using viable pollen and the local cultivar practice",
          "Inspect fruit set and monitor red-palm-weevil symptoms"
        ],
        "technical": "Weather planning screens: air ≤2°C triggers a frost watch; ≥35°C triggers a heat watch, or ≥30°C for a selected cool-season crop at flowering. These are app screens, not validated crop-loss thresholds.",
        "warning": "Do not assume wind alone gives adequate commercial date-palm fruit set or use unverified pollination timing."
      },
      {
        "number": 6,
        "name": "Fruit development / maturity",
        "group": "flowering",
        "objective": "Maintaining crop function through filling and maturation protects final size and quality.",
        "timing": "From confirmed fruit set through the intended harvest maturity",
        "actions": [
          "Inspect representative fruit for maturity and pest injury",
          "Match water management to root-zone evidence and crop load"
        ],
        "technical": "Track rainfall in mm and forecast ET₀ in mm/day separately. Soil-based scheduling needs a recent moisture reading, representative root depth, field capacity and wilting point; no measured soil or leaf-wetness value is inferred.",
        "warning": "Do not infer harvest maturity, fruit quality or yield directly from NDVI."
      },
      {
        "number": 7,
        "name": "Harvest / post-harvest orchard care",
        "group": "harvest",
        "objective": "Correct maturity, dry handling and clean storage preserve marketable output.",
        "timing": "At cultivar-specific harvest maturity, then after the crop is removed",
        "actions": [
          "Pick carefully at market-appropriate maturity",
          "Remove infected fallen fruit and plan post-harvest orchard sanitation"
        ],
        "technical": "Record actual cultivar maturity, measured fruit quality and handling condition. The app’s dry harvest screen uses ≥3 daylight hours, RH ≤75%, wind ≤20 km/h, gust ≤30 km/h and 12 dry, non-thundery hours; it does not measure fruit maturity, orchard trafficability or the product pre-harvest interval.",
        "warning": "Observe pesticide pre-harvest intervals and separate damaged / rotting fruit from sound produce."
      }
    ]
  }
};
