// juanlab: la home di Stellar Optimizer (primi passi, inventario) con le schede del fork: link da gc-web, import
// dall'UID (Enka o Akasha), le novità di Juan-optimizer e i crediti. Le novità di Stellar Optimizer
// (WhatsNewCard) parlano delle sue versioni: al loro posto il changelog del fork (JuanlabChangelog).
import { Box } from '@mui/material'
import GettingStartedCard from './GettingStartedCard'
import InventoryCard from './InventoryCard'
import {
  CreditsCard,
  GcwebIncoming,
  ImportUidCard,
  IntroCard,
} from './JuanlabCards'
import { ChangelogCard } from './JuanlabChangelog'

export default function PageHome() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        pt: { xs: 1.5, md: 3 },
        pb: 4,
      }}
    >
      <GcwebIncoming />
      <IntroCard />
      <ChangelogCard />
      <ImportUidCard />
      <GettingStartedCard />
      <InventoryCard />
      <CreditsCard />
    </Box>
  )
}
