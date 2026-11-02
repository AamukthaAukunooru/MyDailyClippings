// "Sky over Hyderabad": what is happening in the sky on a given day, worked out
// with astronomy-engine (pure maths, no API, no LLM), written so it reads well aloud.
//
//   npx tsx scripts/sky.ts 2026-11-17      # print the report for a date
//
// Calculated: sunrise and sunset (with direction), zero-shadow days, equinoxes and
// solstices, moon phase, moonrise, supermoons, lunar and solar eclipses, bright
// planets in the evening and morning sky, oppositions, greatest elongations, and
// close pairings of the Moon and planets. Meteor showers come from a small table
// (METEOR_SHOWERS below), since their peaks are known in advance. Comets are not
// predictable this way; the Astronomy news prompt is asked to cover those.

import * as A from 'astronomy-engine'

export interface Place {
  name: string
  latitude: number
  longitude: number
  elevation: number // metres
  utcOffsetMinutes: number
}

export const HYDERABAD: Place = {
  name: 'Hyderabad',
  latitude: 17.385,
  longitude: 78.4867,
  elevation: 540,
  utcOffsetMinutes: 330,
}

export interface SkyReport {
  date: string
  /** Notable events worth a mention up front (eclipse, full moon, shower peak...). Empty on quiet days. */
  highlights: string[]
  /** Markdown section, starting with a ## heading. */
  markdown: string
}

// ---------- meteor showers (IMO calendar; peaks drift by about a day year to year) ----------

interface Shower {
  name: string
  peak: [number, number] // month, day
  start: [number, number]
  end: [number, number]
  zhr: number // meteors per hour at the peak under ideal dark skies
  note: string
}

export const METEOR_SHOWERS: Shower[] = [
  { name: 'Quadrantid', peak: [1, 3], start: [12, 28], end: [1, 12], zhr: 110, note: 'Best in the hours before dawn, looking north-east.' },
  { name: 'Lyrid', peak: [4, 22], start: [4, 14], end: [4, 30], zhr: 18, note: 'Best after midnight, looking north-east.' },
  { name: 'Eta Aquariid', peak: [5, 6], start: [4, 19], end: [5, 28], zhr: 50, note: 'Best in the hour before dawn, looking east. It favours southern latitudes like India.' },
  { name: 'Southern Delta Aquariid', peak: [7, 31], start: [7, 12], end: [8, 23], zhr: 25, note: 'Best after midnight, looking south.' },
  { name: 'Perseid', peak: [8, 12], start: [7, 17], end: [8, 24], zhr: 100, note: 'Best after midnight, looking north-east.' },
  { name: 'Draconid', peak: [10, 8], start: [10, 6], end: [10, 10], zhr: 10, note: 'Best in the early evening, looking north.' },
  { name: 'Orionid', peak: [10, 21], start: [10, 2], end: [11, 7], zhr: 20, note: 'Best after midnight, looking east.' },
  { name: 'Northern Taurid', peak: [11, 12], start: [10, 20], end: [12, 10], zhr: 5, note: 'Few meteors, but it is known for slow, bright fireballs, visible most of the night.' },
  { name: 'Leonid', peak: [11, 17], start: [11, 6], end: [11, 30], zhr: 15, note: 'Best in the hours before dawn, looking east.' },
  { name: 'Geminid', peak: [12, 14], start: [12, 4], end: [12, 20], zhr: 150, note: 'It is the best shower of the year, visible from about 9 at night, looking east.' },
  { name: 'Ursid', peak: [12, 22], start: [12, 17], end: [12, 26], zhr: 10, note: 'Best before dawn, looking north.' },
]

// ---------- time helpers (all "days" are local calendar days) ----------

const DAY_MS = 86_400_000

function localMidnight(dateIso: string, place: Place): Date {
  return new Date(Date.parse(`${dateIso}T00:00:00Z`) - place.utcOffsetMinutes * 60_000)
}

function localParts(t: Date, place: Place) {
  const l = new Date(t.getTime() + place.utcOffsetMinutes * 60_000)
  return { y: l.getUTCFullYear(), mo: l.getUTCMonth(), d: l.getUTCDate(), h: l.getUTCHours(), mi: l.getUTCMinutes(), wd: l.getUTCDay() }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function clock(t: Date, place: Place): string {
  const { h, mi } = localParts(t, place)
  const h12 = h % 12 === 0 ? 12 : h % 12
  const ampm = h < 12 ? 'a.m.' : 'p.m.'
  return `${h12}:${String(mi).padStart(2, '0')} ${ampm}`
}

function dayName(t: Date, place: Place): string {
  const p = localParts(t, place)
  return `${WEEKDAYS[p.wd]}, ${MONTHS[p.mo]} ${p.d}`
}

/** Whole local days from `dayStart` to the local day containing `t` (0 = today). */
function daysAhead(t: Date, dayStart: Date): number {
  return Math.floor((t.getTime() - dayStart.getTime()) / DAY_MS)
}

function when(t: Date, dayStart: Date, place: Place): string {
  const n = daysAhead(t, dayStart)
  if (n === 0) return `today at ${clock(t, place)}`
  if (n === 1) return `tomorrow at ${clock(t, place)}`
  return `on ${dayName(t, place)}`
}

// ---------- geometry helpers ----------

function compass(az: number): string {
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
  return names[Math.round((((az % 360) + 360) % 360) / 45) % 8]
}

function horizon(body: A.Body, t: Date, obs: A.Observer) {
  const eq = A.Equator(body, t, obs, true, true)
  return A.Horizon(t, obs, eq.ra, eq.dec, 'normal')
}

function separation(a: A.Body, b: A.Body, t: Date, obs: A.Observer): number {
  const ea = A.Equator(a, t, obs, true, true)
  const eb = A.Equator(b, t, obs, true, true)
  return A.AngleBetween(ea.vec, eb.vec)
}

/** "15 degrees south of due east" for a rising/setting azimuth. */
function riseDirection(az: number, east: boolean): string {
  const ref = east ? 90 : 270
  const off = Math.round(Math.abs(az - ref))
  const side = east ? (az < ref ? 'north' : 'south') : az > ref ? 'north' : 'south'
  if (off <= 1) return `almost exactly due ${east ? 'east' : 'west'}`
  return `${off} degrees ${side} of due ${east ? 'east' : 'west'}`
}

function phaseName(angle: number): string {
  if (angle < 6 || angle > 354) return 'a new moon'
  if (angle < 84) return 'a waxing crescent'
  if (angle < 96) return 'at first quarter'
  if (angle < 174) return 'a waxing gibbous'
  if (angle < 186) return 'full'
  if (angle < 264) return 'a waning gibbous'
  if (angle < 276) return 'at last quarter'
  return 'a waning crescent'
}

const PLANETS = [A.Body.Mercury, A.Body.Venus, A.Body.Mars, A.Body.Jupiter, A.Body.Saturn]
const QUARTER_NAMES = ['New moon', 'First quarter moon', 'Full moon', 'Last quarter moon']

function list(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// ---------- the report ----------

export function skyReport(dateIso: string, place: Place = HYDERABAD): SkyReport {
  const obs = new A.Observer(place.latitude, place.longitude, place.elevation)
  const dayStart = localMidnight(dateIso, place)
  const dayEnd = new Date(dayStart.getTime() + DAY_MS)
  const at = (h: number, m = 0) => new Date(dayStart.getTime() + (h * 60 + m) * 60_000)
  const today = (t: Date | undefined | null) => !!t && t >= dayStart && t < dayEnd

  const highlights: string[] = []
  const paras: string[] = []

  // --- Sun ---
  const rise = A.SearchRiseSet(A.Body.Sun, obs, +1, dayStart, 1)
  const set = A.SearchRiseSet(A.Body.Sun, obs, -1, dayStart, 1)
  if (rise && set) {
    const riseAz = horizon(A.Body.Sun, rise.date, obs).azimuth
    const setAz = horizon(A.Body.Sun, set.date, obs).azimuth
    const mins = Math.round((set.date.getTime() - rise.date.getTime()) / 60_000)
    paras.push(
      `The Sun rises at ${clock(rise.date, place)}, ${riseDirection(riseAz, true)}, and sets at ${clock(set.date, place)}, ` +
        `${riseDirection(setAz, false)}. That is ${Math.floor(mins / 60)} hours and ${mins % 60} minutes of daylight.`,
    )
  }

  // Zero-shadow day: the noon Sun passes straight overhead (only between the tropics).
  const noonAlt = (d: Date) => A.SearchHourAngle(A.Body.Sun, obs, 0, d).hor.altitude
  const noon = A.SearchHourAngle(A.Body.Sun, obs, 0, dayStart)
  const altToday = noon.hor.altitude
  const altPrev = noonAlt(new Date(dayStart.getTime() - DAY_MS))
  const altNext = noonAlt(dayEnd)
  if (altToday > 89.4 && altToday >= altPrev && altToday >= altNext) {
    const s = `It is a zero-shadow day in ${place.name}: at ${clock(noon.time.date, place)} the Sun is directly overhead, so upright objects cast no shadow.`
    paras.push(s)
    highlights.push(`a zero-shadow day in ${place.name} at ${clock(noon.time.date, place)}`)
  } else {
    // a heads-up in the week before
    for (let n = 1; n <= 7; n++) {
      const d = new Date(dayStart.getTime() + n * DAY_MS)
      const a = noonAlt(d)
      if (a > 89.4 && a >= noonAlt(new Date(d.getTime() - DAY_MS)) && a >= noonAlt(new Date(d.getTime() + DAY_MS))) {
        paras.push(`Zero-shadow day is coming ${n === 1 ? 'tomorrow' : `on ${dayName(d, place)}`}: at local noon the Sun will be directly overhead and shadows will vanish.`)
        break
      }
    }
  }

  // Equinoxes and solstices.
  const year = localParts(dayStart, place).y
  const seasons = A.Seasons(year)
  const seasonEvents: [A.AstroTime, string][] = [
    [seasons.mar_equinox, 'the March equinox: day and night are nearly equal everywhere, and the Sun rises due east'],
    [seasons.jun_solstice, 'the June solstice: the Sun reaches its northernmost point, giving the longest day of the year here'],
    [seasons.sep_equinox, 'the September equinox: day and night are nearly equal everywhere, and the Sun rises due east'],
    [seasons.dec_solstice, 'the December solstice: the Sun reaches its southernmost point, giving the shortest day of the year here'],
  ]
  for (const [t, what] of seasonEvents) {
    const n = daysAhead(t.date, dayStart)
    if (n === 0) {
      paras.push(`Today is ${what}. The exact moment is ${clock(t.date, place)}.`)
      highlights.push(what.split(':')[0])
    } else if (n > 0 && n <= 3) {
      paras.push(`${what.split(':')[0].replace(/^the/, 'The')} is ${n === 1 ? 'tomorrow' : `in ${n} days`}.`)
    }
  }

  // --- Moon ---
  const evening = at(20)
  const phase = A.MoonPhase(evening)
  const illum = Math.round(A.Illumination(A.Body.Moon, evening).phase_fraction * 100)
  const mq = A.SearchMoonQuarter(dayStart)
  let moonLine: string
  if (today(mq.time.date)) {
    const name = QUARTER_NAMES[mq.quarter]
    moonLine = `${name} today, at ${clock(mq.time.date, place)}.`
    if (mq.quarter === 0 || mq.quarter === 2) highlights.push(`${name.toLowerCase()} at ${clock(mq.time.date, place)}`)
    if (mq.quarter === 2) {
      const km = Math.round(A.GeoMoon(mq.time).Length() * A.KM_PER_AU)
      if (km < 360_000) {
        moonLine += ` It is a supermoon: the Moon is near its closest point to Earth, about ${Math.round(km / 1000)} thousand kilometres away, so it looks a little bigger and brighter than usual.`
        highlights.push('a supermoon')
      }
    }
  } else {
    moonLine = `The Moon is ${phaseName(phase)}, about ${illum} percent lit.`
  }
  const moonrise = A.SearchRiseSet(A.Body.Moon, obs, +1, dayStart, 1)
  if (moonrise && phase > 20 && phase < 340) moonLine += ` It rises at ${clock(moonrise.date, place)}.`
  // next full and new moon (whichever are not today)
  const upcoming: string[] = []
  let q = mq
  for (let i = 0; i < 4 && upcoming.length < 2; i++) {
    if (!today(q.time.date) && (q.quarter === 0 || q.quarter === 2)) {
      upcoming.push(`${QUARTER_NAMES[q.quarter].toLowerCase()} ${when(q.time.date, dayStart, place)}`)
    }
    q = A.NextMoonQuarter(q)
  }
  if (upcoming.length) moonLine += ` Next ${upcoming[0]}.`
  paras.push(moonLine)

  // --- Eclipses ---
  const lunar = A.SearchLunarEclipse(new Date(dayStart.getTime() - DAY_MS / 4))
  const lunarIn = daysAhead(lunar.peak.date, dayStart)
  if (lunarIn >= 0 && lunarIn <= 14) {
    const alt = horizon(A.Body.Moon, lunar.peak.date, obs).altitude
    const seen = alt > 0 ? `visible from ${place.name}` : `but the Moon is below the horizon here then, so it is not visible from ${place.name}`
    const s = `A ${lunar.kind} lunar eclipse happens ${when(lunar.peak.date, dayStart, place)}${lunarIn > 1 ? `, peaking at ${clock(lunar.peak.date, place)}` : ''}, ${seen}.`
    paras.push(s)
    if (lunarIn <= 1 && alt > 0) highlights.push(`a ${lunar.kind} lunar eclipse ${lunarIn === 0 ? 'tonight' : 'tomorrow'}`)
  }
  const local = A.SearchLocalSolarEclipse(new Date(dayStart.getTime() - DAY_MS / 4), obs)
  const localIn = daysAhead(local.peak.time.date, dayStart)
  if (localIn >= 0 && localIn <= 30 && local.peak.altitude > 0) {
    const pct = Math.round(local.obscuration * 100)
    paras.push(
      `A solar eclipse is visible from ${place.name} ${when(local.peak.time.date, dayStart, place)}${localIn > 1 ? `, peaking at ${clock(local.peak.time.date, place)}` : ''}. ` +
        `About ${pct} percent of the Sun will be covered here. Never look at it directly without proper eclipse glasses.`,
    )
    if (localIn <= 1) highlights.push(`a solar eclipse visible from ${place.name} ${localIn === 0 ? 'today' : 'tomorrow'}`)
  } else {
    const global = A.SearchGlobalSolarEclipse(new Date(dayStart.getTime() - DAY_MS / 4))
    if (today(global.peak.date)) {
      paras.push(`There is a ${global.kind} solar eclipse today elsewhere on Earth, though not visible from ${place.name}.`)
    }
  }

  // --- Planets in the evening and morning sky ---
  const sky = (t: Date) =>
    PLANETS.map((b) => ({ b, h: horizon(b, t, obs), mag: A.Illumination(b, t).mag }))
      .filter((p) => p.h.altitude > 8 && p.mag < 2.5)
      .sort((x, y) => x.mag - y.mag)
  const describe = (ps: ReturnType<typeof sky>) => {
    // group planets that are in the same part of the sky: "Jupiter and Mars high overhead"
    const groups = new Map<string, string[]>()
    for (const p of ps) {
      const where = p.h.altitude > 60 ? 'high overhead' : `in the ${compass(p.h.azimuth)}`
      groups.set(where, [...(groups.get(where) ?? []), p.b])
    }
    return list([...groups].map(([where, names]) => `${list(names)} ${where}`))
  }
  const eve = sky(at(19, 30))
  const morn = sky(at(5, 15))
  const planetBits: string[] = []
  if (eve.length) planetBits.push(`In the evening sky around 7:30, look for ${describe(eve)}.`)
  const mornOnly = morn.filter((p) => !eve.some((e) => e.b === p.b))
  if (mornOnly.length) planetBits.push(`Before dawn, ${describe(mornOnly)}.`)
  if (!eve.length && !morn.length) planetBits.push('No bright planets are well placed today.')
  paras.push(planetBits.join(' '))

  // Oppositions (outer planets at their biggest and brightest) and greatest elongations.
  for (const b of [A.Body.Mars, A.Body.Jupiter, A.Body.Saturn]) {
    const t = A.SearchRelativeLongitude(b, 0, new Date(dayStart.getTime() - DAY_MS))
    const n = daysAhead(t.date, dayStart)
    if (n === 0) {
      paras.push(`${b} is at opposition today: it is opposite the Sun, up all night and at its brightest for the year.`)
      highlights.push(`${b} at opposition`)
    } else if (n > 0 && n <= 7) {
      paras.push(`${b} reaches opposition ${when(t.date, dayStart, place)}, its best showing of the year.`)
    }
  }
  for (const b of [A.Body.Mercury, A.Body.Venus]) {
    const e = A.SearchMaxElongation(b, new Date(dayStart.getTime() - DAY_MS))
    const n = daysAhead(e.time.date, dayStart)
    if (n >= 0 && n <= 2) {
      const side = e.visibility === 'evening' ? 'after sunset in the west' : 'before sunrise in the east'
      paras.push(
        `${b} is at its greatest distance from the Sun ${n === 0 ? 'today' : when(e.time.date, dayStart, place)}, about ${Math.round(e.elongation)} degrees, ` +
          `so this is one of the best times to spot it ${side}.`,
      )
      if (n === 0 && b === A.Body.Mercury) highlights.push('a good chance to spot Mercury')
    }
  }

  // Close pairings tonight: Moon with a planet, or two planets together.
  const pairT = at(20)
  const up = (b: A.Body) => horizon(b, pairT, obs).altitude > 5
  const pairs: string[] = []
  for (const b of PLANETS) {
    for (const [t, label] of [[pairT, 'this evening'], [at(5, 15), 'before dawn']] as const) {
      const visible = horizon(A.Body.Moon, t, obs).altitude > 5 && horizon(b, t, obs).altitude > 5
      if (visible && separation(A.Body.Moon, b, t, obs) < 5) {
        pairs.push(`the Moon sits close to ${b} ${label}`)
        highlights.push(`the Moon close to ${b} ${label}`)
        break
      }
    }
  }
  for (let i = 0; i < PLANETS.length; i++)
    for (let j = i + 1; j < PLANETS.length; j++) {
      const [a, b] = [PLANETS[i], PLANETS[j]]
      const t = up(a) && up(b) ? pairT : at(5, 15)
      const sep = separation(a, b, t, obs)
      if (horizon(a, t, obs).altitude > 5 && horizon(b, t, obs).altitude > 5 && sep < 2.5) {
        // planets drift slowly, so a pairing lasts days: only the closest day is a highlight
        const sepAt = (dt: number) => separation(a, b, new Date(t.getTime() + dt), obs)
        const closest = sep <= sepAt(-DAY_MS) && sep <= sepAt(DAY_MS)
        pairs.push(`${a} and ${b} appear side by side ${t === pairT ? 'this evening' : 'before dawn'}${closest ? ', at their closest' : ''}`)
        if (closest) highlights.push(`${a} and ${b} side by side`)
      }
    }
  if (pairs.length) {
    const s = pairs.map((p) => p[0].toUpperCase() + p.slice(1)).join('. ')
    paras.push(`${s}. ${pairs.length > 1 ? 'These are easy' : 'It is an easy'} pairing${pairs.length > 1 ? 's' : ''} to find with the naked eye.`)
  }

  // --- Meteor showers ---
  for (const sh of METEOR_SHOWERS) {
    const mk = (md: [number, number], y: number) => localMidnight(`${y}-${String(md[0]).padStart(2, '0')}-${String(md[1]).padStart(2, '0')}`, place)
    for (const y of [year - 1, year, year + 1]) {
      const peak = mk(sh.peak, y)
      const n = daysAhead(peak, dayStart)
      if (n < -1 || n > 4) continue
      // the peak night runs into the early hours of the next day; check the Moon at 2 a.m.
      const peakMoon = Math.round(A.Illumination(A.Body.Moon, new Date(peak.getTime() + 26 * 3600_000)).phase_fraction * 100)
      const moonNote = peakMoon > 55 ? ' A bright Moon will wash out the fainter ones this time.' : peakMoon < 25 ? ' The Moon is dim then, so conditions are good.' : ''
      const rate = `up to about ${sh.zhr} meteors an hour from a dark site, fewer from the city`
      if (n === 0) {
        paras.push(`The ${sh.name} meteor shower peaks tonight, with ${rate}. ${sh.note}${moonNote}`)
        highlights.push(`the ${sh.name} meteor shower peaking tonight`)
      } else if (n === -1) {
        paras.push(`The ${sh.name} meteor shower peaked last night, but tonight is still worth a look. ${sh.note}`)
      } else {
        paras.push(`The ${sh.name} meteor shower peaks ${n === 1 ? 'tomorrow night' : `in ${n} days, on the night of ${dayName(peak, place)}`}, with ${rate}.${moonNote}`)
      }
    }
  }

  // times end in "a.m."/"p.m.", so avoid a doubled full stop after them
  const tidy = paras.map((p) => p.replace(/\.\.(\s|$)/g, '.$1'))
  const markdown = `## Sky over ${place.name}\n\n${tidy.join('\n\n')}\n`
  return { date: dateIso, highlights, markdown }
}

// CLI: print a report
if (process.argv[1] && /sky\.ts$/.test(process.argv[1])) {
  const d = process.argv[2] ?? new Date(Date.now() + HYDERABAD.utcOffsetMinutes * 60_000).toISOString().slice(0, 10)
  const r = skyReport(d)
  console.log(r.markdown)
  console.log('Highlights:', r.highlights.length ? r.highlights.join('; ') : '(none)')
}
