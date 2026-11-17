import { keepLocal } from './storage'

describe('which localStorage keys stay when the data move to IndexedDB', () => {
  it('moves every database entry (all of them must reach IndexedDB)', () => {
    for (const key of [
      'artifact_1',
      'weapon_12',
      'char_Mitya',
      'character_Mitya',
      'charMeta_Mitya',
      'team_3',
      'teamchar_20',
      'loadout_1',
      'build_4',
      'buildTc_5',
      'optConfig_teamchar_1',
      'generatedBuildList_teamchar_1',
      'pandoTeam_1',
      'teamOptResults',
      'teamKqmResults',
      'extraDatabase_1',
      'extraDatabase_4',
      'db_ver',
      'dbIndex',
      'dbMeta',
      'display_team',
      'display_archive',
      'some_future_entry',
    ])
      expect([key, keepLocal(key)]).toEqual([key, false])
  })
  it('keeps this device’s settings and drafts, which the app reads straight from localStorage', () => {
    for (const key of [
      'GONewTabDetection',
      'i18nextLng',
      'i18next.translate.boo',
      'stellar-notrack',
      'GOGettingStartedHidden',
      'infoShown_artifactPage',
      'go_tcFrom_teamchar_1',
      'go_opt_gpu',
      'snow_effect_enabled',
      'num_opt_workers',
      'artifactPage_filtersOpen',
      'weaponPage_filtersOpen',
      'teamOptRotationText_team_1',
      'teamOptRotationDraft_team_1',
      'teamOptRotationOpener_team_1',
      'teamOptRotationTiming_team_1',
      'teamOpt.timingOpen',
      'teamOpt.frameData',
      'teamOpt.pingMs',
      'teamOpt.showConditions',
    ])
      expect([key, keepLocal(key)]).toEqual([key, true])
  })
})
