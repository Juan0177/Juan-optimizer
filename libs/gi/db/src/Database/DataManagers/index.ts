import type { ICachedArtifact, ICachedSubstat } from './ArtifactDataManager'
import { cachedArtifact, validateArtifact } from './ArtifactDataManager'
import type { BuildTc, BuildTcArtifactSlot } from './BuildTcDataManager'
import { initCharTC, toBuildTc } from './BuildTcDataManager'
import type { ICachedCharacter } from './CharacterDataManager'
import type {
  BonusStats,
  CustomMultiTarget,
  CustomTarget,
} from './CustomMultiTarget'
import {
  initCustomMultiTarget,
  initCustomTarget,
  MAX_DESC_LENGTH,
  MAX_NAME_LENGTH,
  validateCustomMultiTarget,
} from './CustomMultiTarget'
import type { GeneratedBuild } from './GeneratedBuildListDataManager'
import type {
  ArtSetExclusion,
  ArtSetExclusionKey,
  ArtSetRuleKey,
  OptConfig,
  StatFilterSetting,
  StatFilters,
} from './OptConfigDataManager'
import {
  allArtifactSetExclusionKeys,
  artSetRuleKeys,
  forcedSet,
  handleArtSetExclusion,
  isSetRule,
  maxBuildsToShowList,
  withForcedSet,
} from './OptConfigDataManager'
import type {
  PandoArtIds,
  PandoGeneratedBuild,
  PandoGeneratedBuildList,
} from './PandoGeneratedBuildListDataManager'
import type {
  PandoOptConfig,
  PandoStatFilter,
  PandoStatFilterStatKey,
  PandoStatFilterStatQtKey,
  PandoStatFilters,
  PandoStatFilterTag,
} from './PandoOptConfigDataManager'
import {
  newPandoStatFilterTag,
  pandoMaxBuildsToShowDefault,
  pandoMaxBuildsToShowList,
  pandoStatFilterStatKeys,
  pandoStatFilterStatQtKeys,
} from './PandoOptConfigDataManager'
import type {
  PandoCritModeKey,
  PandoMember,
  PandoTeam,
  PandoTeamConditional,
  PandoTeammateMember,
  PandoTeammates,
} from './PandoTeamDataManager'
import {
  initialPandoTeam,
  isPandoTeamCharacterKey,
  pandoCritModeKeys,
  pandoMembers,
  pandoTeammateMembers,
  pandoTeamSrcKeys,
} from './PandoTeamDataManager'
import type { TeamCharacter } from './TeamCharacterDataManager'
import type {
  ArtifactData,
  LoadoutDataExportSetting,
  LoadoutDatum,
  LoadoutExportSetting,
  Team,
  TeamFightSettings,
} from './TeamDataManager'
import {
  defLoadoutExportSetting,
  MAX_ENEMY_HP,
  validateFightSettings,
} from './TeamDataManager'
import type { EnemyOverride, TeamEnemy } from './TeamEnemy'
import { validateEnemyOverride, validateTeamEnemy } from './TeamEnemy'
import type {
  TeamOpt,
  TeamOptAttack,
  TeamOptBuffLimit,
  TeamOptBuffOwner,
  TeamOptEnergyCalculator,
  TeamOptEnergyMember,
  TeamOptEnergyRotationField,
  TeamOptKqm,
} from './TeamOpt'
import {
  defaultTeamOptKqm,
  initTeamOpt,
  initTeamOptAttack,
  TEAM_OPT_MAX_ATTACKS,
  teamOptEnergyRotationFields,
  validateTeamOpt,
} from './TeamOpt'

export type { RotationDocumentField } from './TeamDataManager'

import type { TeamRotation } from './TeamRotation'
import {
  applyTeamRotation,
  parseTeamRotation,
  TEAM_ROTATION_TYPE,
  teamRotationExport,
} from './TeamRotation'
import type { ICachedWeapon } from './WeaponDataManager'
import {
  defaultInitialWeapon,
  defaultInitialWeaponKey,
  initialWeapon,
} from './WeaponDataManager'

export type {
  ArtifactData,
  ArtSetExclusion,
  ArtSetExclusionKey,
  ArtSetRuleKey,
  BonusStats,
  BuildTc,
  BuildTcArtifactSlot,
  CustomMultiTarget,
  CustomTarget,
  EnemyOverride,
  GeneratedBuild,
  ICachedArtifact,
  ICachedCharacter,
  ICachedSubstat,
  ICachedWeapon,
  LoadoutDataExportSetting,
  LoadoutDatum,
  LoadoutExportSetting,
  OptConfig,
  PandoArtIds,
  PandoCritModeKey,
  PandoGeneratedBuild,
  PandoGeneratedBuildList,
  PandoMember,
  PandoOptConfig,
  PandoStatFilter,
  PandoStatFilterStatKey,
  PandoStatFilterStatQtKey,
  PandoStatFilters,
  PandoStatFilterTag,
  PandoTeam,
  PandoTeamConditional,
  PandoTeammateMember,
  PandoTeammates,
  StatFilterSetting,
  StatFilters,
  Team,
  TeamCharacter,
  TeamEnemy,
  TeamFightSettings,
  TeamOpt,
  TeamOptAttack,
  TeamOptBuffLimit,
  TeamOptBuffOwner,
  TeamOptEnergyCalculator,
  TeamOptEnergyMember,
  TeamOptEnergyRotationField,
  TeamOptKqm,
  TeamRotation,
}
export {
  allArtifactSetExclusionKeys,
  applyTeamRotation,
  artSetRuleKeys,
  cachedArtifact,
  defaultInitialWeapon,
  defaultInitialWeaponKey,
  defaultTeamOptKqm,
  defLoadoutExportSetting,
  forcedSet,
  handleArtSetExclusion,
  initCharTC,
  initCustomMultiTarget,
  initCustomTarget,
  initialPandoTeam,
  initialWeapon,
  initTeamOpt,
  initTeamOptAttack,
  isPandoTeamCharacterKey,
  isSetRule,
  MAX_DESC_LENGTH,
  MAX_ENEMY_HP,
  MAX_NAME_LENGTH,
  maxBuildsToShowList,
  newPandoStatFilterTag,
  pandoCritModeKeys,
  pandoMaxBuildsToShowDefault,
  pandoMaxBuildsToShowList,
  pandoMembers,
  pandoStatFilterStatKeys,
  pandoStatFilterStatQtKeys,
  pandoTeammateMembers,
  pandoTeamSrcKeys,
  parseTeamRotation,
  TEAM_OPT_MAX_ATTACKS,
  TEAM_ROTATION_TYPE,
  teamOptEnergyRotationFields,
  teamRotationExport,
  toBuildTc,
  validateArtifact,
  validateCustomMultiTarget,
  validateEnemyOverride,
  validateFightSettings,
  validateTeamEnemy,
  validateTeamOpt,
  withForcedSet,
}
