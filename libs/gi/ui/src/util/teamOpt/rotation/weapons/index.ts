import type { WeaponModule } from '../weaponEffects'
import { bow1 } from './bow1'
import { bow2 } from './bow2'
import { bow3 } from './bow3'
import { bow4 } from './bow4'
import { catalyst1 } from './catalyst1'
import { catalyst2 } from './catalyst2'
import { catalyst3 } from './catalyst3'
import { catalyst4 } from './catalyst4'
import { claymore1 } from './claymore1'
import { claymore2 } from './claymore2'
import { claymore3 } from './claymore3'
import { polearm1 } from './polearm1'
import { polearm2 } from './polearm2'
import { polearm3 } from './polearm3'
import { sword1 } from './sword1'
import { sword2 } from './sword2'
import { sword3 } from './sword3'
import { sword4 } from './sword4'

/**
 * Every weapon effect the rotation simulation plays from `weaponEffects`' descriptions (the
 * 2026-11-16 weapon audit), one file per batch of weapons
 */
export const WEAPON_MODULES: readonly WeaponModule[] = [
  ...sword1,
  ...sword2,
  ...sword3,
  ...sword4,
  ...claymore1,
  ...claymore2,
  ...claymore3,
  ...polearm1,
  ...polearm2,
  ...polearm3,
  ...bow1,
  ...bow2,
  ...bow3,
  ...bow4,
  ...catalyst1,
  ...catalyst2,
  ...catalyst3,
  ...catalyst4,
]
