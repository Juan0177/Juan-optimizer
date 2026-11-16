// juanlab: scambio di build con gc-web (il pannello del server privato LunaGC sul PC dell'utente).
// La build viaggia in un link, in un formato neutro con gli ID del gioco, lo stesso di gc-web (public/juanlab.js):
// { format: "JuanLabBuild", version: 1, source, name, character: { avatarId, key, name },
//   artifacts: [{ setId, slot: "EQUIP_BRACER"…, rarity, level, mainProp: "FIGHT_PROP_…", substats: [{ prop, value }] }] }
// value e il numero mostrato dal gioco (10.5 per il 10,5% di Tasso di CRIT, 37 per +37 ATT).
// Il collegamento funziona solo dopo averlo attivato nella finestra d'import: prima i link in arrivo sono ignorati.
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allTravelerKeys,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import type { IArtifact } from '@genshin-optimizer/gi/schema'
import { useEffect, useState } from 'react'
// biome-ignore lint/style/noRestrictedImports: juanlab, solo le tabelle ID del datamine (l'index di gi/dm usa il filesystem)
import * as artifactMap from '../../../dm/src/mapping/artifact'
// biome-ignore lint/style/noRestrictedImports: juanlab, solo le tabelle ID del datamine (l'index di gi/dm usa il filesystem)
import { characterIdMap } from '../../../dm/src/mapping/character'
import type { EnkaResponse } from './enkaToGood'
import { PROP } from './enkaToGood'

const { artifactIdMap, artifactSlotMap } = artifactMap

export const GCWEB_PARAM = 'gcweb'
export const LINK_FORMAT = 'JuanLabBuild'
export const ACCOUNT_FORMAT = 'JuanLabAccount'
export const DEFAULT_GCWEB_URL = 'http://127.0.0.1:8090/'
const STORAGE_KEY = 'juanlab-gcweb'
const CHANGE_EVENT = 'juanlab-gcweb-change'

export type JuanLabBuild = {
  format: typeof LINK_FORMAT
  version: 1
  source?: string
  name?: string
  character?: { avatarId?: number | null; key?: string; name?: string }
  artifacts: {
    setId: number
    slot: string
    rarity: number
    level: number
    mainProp: string
    substats: { prop: string; value: number }[]
  }[]
}

/* ---------- impostazione del collegamento (nel browser) ---------- */
export type GcwebSettings = { enabled: boolean; url: string }

export function getGcwebSettings(): GcwebSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return {
      enabled: saved?.enabled === true,
      url:
        typeof saved?.url === 'string' && saved.url
          ? saved.url
          : DEFAULT_GCWEB_URL,
    }
  } catch {
    return { enabled: false, url: DEFAULT_GCWEB_URL }
  }
}

export function saveGcwebSettings(next: Partial<GcwebSettings>) {
  const value = { ...getGcwebSettings(), ...next }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // senza localStorage il collegamento resta spento
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** Impostazione corrente, aggiornata quando la si cambia in un'altra parte della pagina. */
export function useGcwebSettings(): GcwebSettings {
  const [settings, setSettings] = useState(getGcwebSettings)
  useEffect(() => {
    const update = () => setSettings(getGcwebSettings())
    window.addEventListener(CHANGE_EVENT, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(CHANGE_EVENT, update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return settings
}

/* ---------- base64url di JSON UTF-8 ---------- */
export function encodePayload(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodePayload(text: string): JuanLabBuild {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const payload = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0))
    )
  )
  if (
    payload?.format !== LINK_FORMAT ||
    payload.version !== 1 ||
    !Array.isArray(payload.artifacts)
  )
    throw new Error('format')
  return payload
}

/* ---------- personaggi dell'account (dal server privato, tramite gc-web) ----------
   Link "z." + JSON compresso (deflate-raw) in base64url: i personaggi nella forma della vetrina di Enka
   (avatarInfoList), con livello, ascensione, costellazione, talenti, arma e manufatti equipaggiati. */
export type JuanLabAccount = {
  format: typeof ACCOUNT_FORMAT
  version: 1
  source?: string
  uid?: number
  nickname?: string
  avatarInfoList: NonNullable<EnkaResponse['avatarInfoList']>
}

export const isAccountLink = (text: string) => text.startsWith('z.')

export async function decodeAccount(text: string): Promise<JuanLabAccount> {
  const base64 = text.slice(2).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const payload = JSON.parse(await new Response(stream).text())
  if (
    payload?.format !== ACCOUNT_FORMAT ||
    payload.version !== 1 ||
    !Array.isArray(payload.avatarInfoList)
  )
    throw new Error('format')
  return payload
}

export function gcwebLink(url: string, payload: JuanLabBuild): string {
  const base = (url || DEFAULT_GCWEB_URL)
    .replace(/#.*$/, '')
    .replace(/\/?$/, '/')
  return `${base}#juanlab=${encodePayload(payload)}`
}

/* ---------- Juan-optimizer -> gc-web ---------- */
const inverse = <V extends string | number>(map: Record<string, V>) => {
  const out: Record<string, string> = {}
  for (const [id, key] of Object.entries(map)) out[String(key)] ??= id
  return out
}
const SET_ID = inverse(artifactIdMap as Record<string, ArtifactSetKey>)
const SLOT_ID = inverse(artifactSlotMap as Record<string, ArtifactSlotKey>)
const PROP_ID = inverse(PROP)
const AVATAR_ID = inverse(characterIdMap as Record<string, string>)

/** I manufatti equipaggiati di un personaggio come build per gc-web. */
export function artifactsToPayload(
  characterKey: CharacterKey,
  gender: 'F' | 'M',
  name: string,
  artifacts: IArtifact[]
): JuanLabBuild {
  const traveler = allTravelerKeys.includes(
    characterKey as (typeof allTravelerKeys)[number]
  )
  const avatarId = traveler
    ? gender === 'F'
      ? 10000007
      : 10000005
    : Number(AVATAR_ID[characterKey]) || null
  return {
    format: LINK_FORMAT,
    version: 1,
    source: 'Juan-optimizer',
    name,
    character: { avatarId, key: characterKey, name },
    artifacts: artifacts
      .filter(
        (a) => SET_ID[a.setKey] && SLOT_ID[a.slotKey] && PROP_ID[a.mainStatKey]
      )
      .map((a) => ({
        setId: Number(SET_ID[a.setKey]),
        slot: SLOT_ID[a.slotKey],
        rarity: a.rarity,
        level: a.level,
        mainProp: PROP_ID[a.mainStatKey],
        substats: a.substats
          .filter((s) => s.key && PROP_ID[s.key] && s.value)
          .map((s) => ({ prop: PROP_ID[s.key], value: s.value })),
      })),
  }
}

/* ---------- gc-web -> Juan-optimizer ---------- */
/** La build arrivata da gc-web in formato GOOD, con i manufatti equipaggiati al personaggio. Se il personaggio
 *  non e nel database lo aggiunge (livello 90): uno gia presente non viene toccato. */
export function payloadToGood(
  payload: JuanLabBuild,
  hasCharacter: (key: CharacterKey) => boolean
) {
  const idKey = characterIdMap[String(payload.character?.avatarId ?? '')]
  const traveler = idKey === 'TravelerM' || idKey === 'TravelerF'
  const key = (traveler ? undefined : idKey) as CharacterKey | undefined
  const location = traveler ? 'Traveler' : key ? charKeyToLocCharKey(key) : ''
  const artifacts = payload.artifacts
    .map((a) => {
      const setKey = artifactIdMap[a.setId]
      const slotKey = artifactSlotMap[a.slot as keyof typeof artifactSlotMap]
      const mainStatKey = PROP[a.mainProp] as MainStatKey | undefined
      if (!setKey || !slotKey || !mainStatKey) return null
      return {
        setKey,
        slotKey,
        level: a.level,
        rarity: a.rarity,
        mainStatKey,
        location,
        lock: false,
        substats: a.substats
          .filter((s) => PROP[s.prop])
          .map((s) => ({ key: PROP[s.prop] as SubstatKey, value: s.value })),
      }
    })
    .filter(Boolean)
  const characters =
    key && !hasCharacter(key)
      ? [
          {
            key,
            level: 90,
            ascension: 6,
            constellation: 0,
            talent: { auto: 1, skill: 1, burst: 1 },
          },
        ]
      : []
  return {
    good: {
      format: 'GOOD' as const,
      source: 'Juan-optimizer (gc-web)',
      version: 2,
      characters,
      artifacts,
    },
    characterKey: key ?? (traveler ? 'Traveler' : undefined),
    skipped: payload.artifacts.length - artifacts.length,
  }
}
