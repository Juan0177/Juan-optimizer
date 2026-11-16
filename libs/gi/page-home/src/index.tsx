// juanlab: home del fork. Tolti pubblicita, link a social e donazioni, video guida, note di versione e resina;
// restano inventario e squadre, piu import dalla vetrina e crediti (vedi JuanlabCards.tsx).
import { Box, Grid, useMediaQuery, useTheme } from '@mui/material'
import ReactGA from 'react-ga4'
import InventoryCard from './InventoryCard'
import {
  CreditsCard,
  GcwebIncoming,
  ImportUidCard,
  IntroCard,
} from './JuanlabCards'
import TeamCard from './TeamCard'

export default function PageHome() {
  const theme = useTheme()
  const lg = useMediaQuery(theme.breakpoints.up('lg'))
  ReactGA.send({ hitType: 'pageview', page: '/home' })
  if (lg)
    return (
      <>
        <GcwebIncoming />
        <Grid container spacing={2} direction={'row-reverse'}>
          <Grid
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            size={{ xs: 12, lg: 5, xl: 4 }}
          >
            <ImportUidCard />
            <CreditsCard />
          </Grid>
          <Grid
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            size={{ xs: 12, lg: 7, xl: 8 }}
          >
            <IntroCard />
            <InventoryCard />
            <TeamCard />
          </Grid>
        </Grid>
      </>
    )
  return (
    <Box sx={{ my: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <GcwebIncoming />
      <IntroCard />
      <ImportUidCard />
      <InventoryCard />
      <TeamCard />
      <CreditsCard />
    </Box>
  )
}
