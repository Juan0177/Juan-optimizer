#!/usr/bin/env python3
"""
Stygian Onslaught seasons and boss names, from the game dump (YuanShenResources).

Writes:
  libs/gi/ui/src/components/enemy/stygianSeasons.gen.json
    the released seasons (dates, the three bosses), and each difficulty's enemy level
  libs/gi/localization/assets/locales/<lang>/stygian.json
    each boss's Fearless/Dire stage name ("Wavebinder: Stormfang"), the game's own description of
    it (its lore, its mechanics, the elements it is weak or strong against) and each season's name,
    in every language
  libs/gi/assets/src/stygian/<boss>.webp, index.ts
    each boss's icon (the game's, from gi.yatta.moe: `--no-icons` keeps the ones there)

The bosses' RES per phase is not in the dump's tables (the fights' abilities change it): it is
kept by hand in libs/gi/ui/src/components/enemy/stygianBosses.ts, from stygian.moe checked
against the dump's monster table and the Fandom wiki's Stygian Onslaught sections.

A boss is keyed by its Fearless/Dire stage config id (LeyLineLevelConfig, e.g. 1013061 for
Wavebinder: Stormfang): a boss back in a later season keeps its ids.

Usage (from the repo root):
  python3 -I tools/stygian/gen_stygian.py [YuanShenResources] [--last-season 5269013]
A season after --last-season is not released yet (the beta dump's dates are placeholders).
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
DUMP = args[0] if args else os.path.join(ROOT, 'YuanShenResources')
LAST_SEASON = 5269013
if '--last-season' in sys.argv:
    LAST_SEASON = int(sys.argv[sys.argv.index('--last-season') + 1])

# app language -> the dump's text map(s)
LANGS = {
    'chs': ['CHS'], 'cht': ['CHT'], 'de': ['DE'], 'en': ['EN'], 'es': ['ES'],
    'fr': ['FR'], 'id': ['ID'], 'it': ['IT'], 'ja': ['JP'], 'ko': ['KR'],
    'pt': ['PT'], 'ru': ['RU'], 'th': ['TH_1', 'TH_2'], 'vi': ['VI'],
}
# the difficulties whose stage (and RES) the presets are: Fearless, Dire
DIFFICULTIES = {5: 'fearless', 6: 'dire'}


def excel(name):
    with open(os.path.join(DUMP, 'ExcelBinOutput', f'{name}.json'), encoding='utf-8') as f:
        return json.load(f)


def text_map(lang):
    out = {}
    for part in LANGS[lang]:
        with open(os.path.join(DUMP, 'TextMap', f'TextMap{part}.json'), encoding='utf-8') as f:
            out.update(json.load(f))
    return out


challenges = excel('LeyLineChallengeExcelConfigData')
levels = {x['id']: x for x in excel('LeyLineLevelExcelConfigData')}
configs = {x['id']: x for x in excel('LeyLineLevelConfigExcelConfigData')}

seasons = []
level_of = {}
for c in sorted(challenges, key=lambda c: c['scheduleId']):
    if c['scheduleId'] > LAST_SEASON:
        continue
    by_difficulty = {levels[i]['LNCOJDMMMLP']: levels[i] for i in c['levelIdList']}
    stage = by_difficulty[5]['levelConfigList']
    # (Fearless and Dire play the same stage, at different levels)
    assert stage == by_difficulty[6]['levelConfigList'], c['scheduleId']
    for d, key in DIFFICULTIES.items():
        # a dungeon's shown level is its levelRevise + 1 (all 2009 dungeons in the dump)
        level = by_difficulty[d]['reviseLevel'] + 1
        assert level_of.setdefault(key, level) == level, (c['scheduleId'], key, level)
    seasons.append({
        'id': c['scheduleId'],
        'nameHash': c['challengeNameTextMapHash'],
        # server time (Asia, UTC+8); a few hours off elsewhere, which "this season" can bear
        'start': c['scheduleStartTime'][:10],
        'end': c['scheduleEndTime'][:10],
        'bosses': stage,
    })

boss_ids = sorted({b for s in seasons for b in s['bosses']})


os.makedirs(os.path.join(ROOT, 'libs/gi/ui/src/components/enemy'), exist_ok=True)
with open(os.path.join(ROOT, 'libs/gi/ui/src/components/enemy/stygianSeasons.gen.json'), 'w') as f:
    json.dump({
        'levels': level_of,
        'seasons': [{k: v for k, v in s.items() if k != 'nameHash'} for s in seasons],
    }, f, indent=1)
    f.write('\n')

# the icons: the game's monster icons, as gi.yatta.moe serves them, made small (webp, 160 px)
icons_dir = os.path.join(ROOT, 'libs/gi/assets/src/stygian')
os.makedirs(icons_dir, exist_ok=True)
if '--no-icons' not in sys.argv:
    for b in boss_ids:
        icon = configs[b]['specialMonsterIcon']
        png = os.path.join(icons_dir, f'{b}.png')
        webp = os.path.join(icons_dir, f'{b}.webp')
        if os.path.exists(webp) and '--refresh-icons' not in sys.argv:
            continue
        # (a few tries: the connection drops at times; a variant's icon, else its base monster's)
        names = [icon, re.sub(r'_[A-Z][a-z]+$', '', icon)]
        got = False
        for name in dict.fromkeys(names):
            for _ in range(3):
                r = subprocess.run(['curl', '-sS', '-f', '-m', '30', '-o', png,
                                    f'https://gi.yatta.moe/assets/UI/monster/{name}.png'])
                if r.returncode == 0:
                    got = True
                    break
            if got:
                break
        if not got:
            print(f'no icon for {b} ({icon})')
            continue
        subprocess.run(['cwebp', '-quiet', '-q', '86', '-resize', '160', '160', png, '-o', webp],
                       check=True)
        os.remove(png)
with open(os.path.join(icons_dir, 'index.ts'), 'w') as f:
    f.write('// Generated by tools/stygian/gen_stygian.py: each Stygian Onslaught boss\'s icon\n')
    have = [b for b in boss_ids if os.path.exists(os.path.join(icons_dir, f'{b}.webp'))]
    for b in have:
        f.write(f"import b{b} from './{b}.webp'\n")
    f.write('\n/** Per boss (its Fearless/Dire stage config id), its icon */\n')
    f.write('export const stygianBossIcons: Partial<Record<number, string>> = {\n')
    for b in have:
        f.write(f'  {b}: b{b},\n')
    f.write('}\n')


def clean(text):
    """The game's text, kept as it shows it: its highlights (<color>) and element icons
    ({SPRITE_PRESET#1100x}); its separators' colour tags dropped"""
    text = re.sub(r'(?i)<color=#FFFFFF40>(.*?)</color>', r'\1', text)
    return text.replace('\\n', '\n').strip()


def known(text):
    return bool(text) and text.strip() not in ('?', '')


report = []
for lang in LANGS:
    tm = text_map(lang)
    # each boss's Fearless/Dire stage, named as the game does ("Wavebinder: Stormfang"): the
    # boss's name and its stage's are not split, their separators differ between languages
    names = {str(b): tm.get(str(configs[b]['levelNameTextMapHash']), '') for b in boss_ids}
    missing = [b for b, n in names.items() if not n]
    assert not missing, (lang, missing)
    if lang in ('en', 'ja', 'es'):
        report += [f'{lang} {b}: {n}' for b, n in list(names.items())[:3]]
    lore, mechanics, tags = {}, {}, {}
    for b in boss_ids:
        g = configs[b]
        text = tm.get(str(g['monsterSpecialDescTextMapHash']), '')
        if known(text):
            lore[str(b)] = clean(text)
        parts = [
            {'name': clean(tm.get(str(n), '')), 'text': clean(tm.get(str(d), ''))}
            for n, d in zip(g['monsterSpecialMechanicNameTextMapHash'],
                            g['levelMaxDescriptionTextMapHash'])
            if known(tm.get(str(n), '')) and known(tm.get(str(d), ''))
        ]
        if parts:
            mechanics[str(b)] = parts
        # what helps against it, and what does not (the game's Advantage / Disadvantage)
        own = {}
        for kind, h in zip(g.get('tagType', []), g['recommendedLevelMechanicTextMapHash']):
            text = tm.get(str(h), '')
            if kind in ('Advantage', 'Disadvantage') and known(text):
                own['good' if kind == 'Advantage' else 'bad'] = clean(text)
        if own:
            tags[str(b)] = own
    out = {
        'boss': names,
        'lore': lore,
        'mechanics': mechanics,
        'tags': tags,
        'season': {str(s['id']): tm.get(str(s['nameHash']), '') for s in seasons},
    }
    folder = os.path.join(ROOT, 'libs/gi/localization/assets/locales', lang)
    with open(os.path.join(folder, 'stygian.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write('\n')
    del tm
print(f'{len(seasons)} seasons, {len(boss_ids)} bosses, levels {level_of}')
print('\n'.join(report))
