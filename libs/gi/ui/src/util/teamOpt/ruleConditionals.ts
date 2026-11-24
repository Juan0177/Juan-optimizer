import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import type { IConditionalValues } from '@genshin-optimizer/gi/sheets'
import { getCharEle, getCharStat } from '@genshin-optimizer/gi/stats'
import { teamOptMembers } from './data'
import { energyCalcData } from './energyCalc'
import type { ItemConditionalCtx } from './itemConditionals'
import { isStellarAttackPath, itemConditionals } from './itemConditionals'
import { tabEnemyFreezeImmune } from './writtenRotation'

/** The rule-based conditionals for a member (what it does in the rotation, its team's elements) */
export function memberCtx(
  database: ArtCharDatabase,
  teamId: string,
  characterKey: CharacterKey,
  teamOpt: Pick<TeamOpt, 'attacks'>,
  /** The KQM tab's (its own enemy) or Team optimize's */
  kqm: boolean
): ItemConditionalCtx {
  const members = teamOptMembers(database, teamId)
  const attacks = new Set<ItemConditionalCtx['attacks'][number]>()
  const kinds = ['normal', 'charged', 'plunging', 'skill', 'burst'] as const
  let ownStellar = false
  let ownLunar = false
  for (const attack of teamOpt.attacks[characterKey] ?? []) {
    const text = attack.path.join('.').toLowerCase()
    for (const kind of kinds) if (text.includes(kind)) attacks.add(kind)
    if (isStellarAttackPath(attack.path)) ownStellar = true
    if (text.includes('lunar')) ownLunar = true
  }
  const elements = members.map((m) => getCharEle(m.characterKey))
  const auras = new Set<string>(
    elements.filter((e) => e !== 'anemo' && e !== 'geo')
  )
  for (const attacks of Object.values(teamOpt.attacks))
    for (const attack of attacks ?? [])
      if (isStellarAttackPath(attack.path)) auras.add('stellar')
  const own = getCharEle(characterKey)
  return {
    attacks: [...attacks],
    auras: [...auras],
    freezeImmune: tabEnemyFreezeImmune(database, teamId, kqm),
    otherElements: new Set(elements.filter((e) => e !== own)).size,
    element: own,
    ownStellar,
    zeroEnergy: energyCalcData[characterKey]?.burstCost === 0,
    burstCost: energyCalcData[characterKey]?.burstCost,
    elements: [...new Set(elements)],
    ownLunar,
    lowHp: characterKey === 'HuTao',
    chainBreaker: members.filter(
      (m) =>
        getCharEle(m.characterKey) !== own ||
        getCharStat(m.characterKey).region === 'natlan'
    ).length,
    teamEnergy: members.reduce(
      (n, m) => n + (energyCalcData[m.characterKey]?.burstCost ?? 0),
      0
    ),
  }
}

/** Whether Team optimize decides the unset gear effects by rule (off: each member's own only) */
export const teamRuleOptions = { enabled: true }

const ruleCache = new WeakMap<object, Map<string, TeamRules>>()
const CONTEXTS_KEPT = 256
const byContext = new Map<string, IConditionalValues>()
type TeamRules = Partial<Record<CharacterKey, IConditionalValues>>

/**
 * Team optimize's weapon and set effects where a member's own switch is unset: decided by rule
 * from what it does in the rotation, the team's elements and the enemy, as on the KQM tab. Its own
 * switches win over them (`TeamDataOverrides.extraConditionals`).
 */
export function teamRuleConditionals(
  database: ArtCharDatabase,
  teamId: string,
  attacks: TeamOpt['attacks']
): TeamRules {
  if (!teamRuleOptions.enabled) return {}
  const members = teamOptMembers(database, teamId).map((m) => m.characterKey)
  const key = JSON.stringify([
    teamId,
    members,
    tabEnemyFreezeImmune(database, teamId, false),
  ])
  let byTeam = ruleCache.get(attacks)
  if (!byTeam) ruleCache.set(attacks, (byTeam = new Map()))
  const cached = byTeam.get(key)
  if (cached) return cached
  const rules: TeamRules = Object.fromEntries(
    members.map((ck) => {
      // (the rules read only this summary: rotations that agree on it share them)
      const ctx = memberCtx(database, teamId, ck, { attacks }, false)
      const ctxKey = JSON.stringify(ctx)
      let conditional = byContext.get(ctxKey)
      if (!conditional) {
        conditional = itemConditionals(ctx).conditional
        byContext.set(ctxKey, conditional)
        if (byContext.size > CONTEXTS_KEPT)
          byContext.delete(byContext.keys().next().value!)
      }
      return [ck, conditional]
    })
  )
  byTeam.set(key, rules)
  return rules
}
