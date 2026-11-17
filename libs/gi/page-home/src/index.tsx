// juanlab: la home di Stellar Optimizer (primi passi, inventario) con le schede del fork: link da gc-web, import
// dall'UID (Enka o Akasha) e crediti. Le novita di Stellar Optimizer (WhatsNewCard) parlano delle sue versioni: tolte.
import { Box } from '@mui/material'
import GettingStartedCard from './GettingStartedCard'
import InventoryCard from './InventoryCard'
import {
  CreditsCard,
  GcwebIncoming,
  ImportUidCard,
  IntroCard,
} from './JuanlabCards'

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
      <ImportUidCard />
      <GettingStartedCard />
      <InventoryCard />
      <CreditsCard />
    </Box>
  )
}
