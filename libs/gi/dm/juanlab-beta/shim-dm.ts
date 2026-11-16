// juanlab-beta: stand-in for @genshin-optimizer/gi/dm when generating the beta content. The real module reads the
// whole game datamine (GenshinData) when it is imported; the beta generator only needs the pure ID/stat mappings,
// the colour tags and the asset path. The excel tables are empty: link tooltips are removed from the beta texts.
export * from '../src/mapping'
export const proudSkillExcelConfigData: Record<string, any> = {}
export const avatarSkillDepotExcelConfigData: Record<string, any> = {}
export const hyperLinkNameExcelConifgData: Record<string, any> = {}
export const DM2D_PATH = '/nonexistent'
