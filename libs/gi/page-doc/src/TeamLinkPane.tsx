import { CardThemed, CodeBlock } from '@genshin-optimizer/common/ui'
import { Button, CardContent, Typography } from '@mui/material'

const linkCode =
  'https://stellaroptimizer.com/#/teams/import?data=z.<base64url(deflateRaw(JSON))>'

/** Team links, for other sites' "Open in Stellar Optimizer" buttons: the spec is its own page */
export function TeamLinkPane() {
  return (
    <CardThemed>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography variant="h5">Team links</Typography>
        <Typography>
          A team link opens a team from another site in Stellar Optimizer: its
          members, their builds and its rotation. The player imports it as a new
          team, then runs it on those builds or switches to their own. No server
          or API is needed: the team rides in the link.
        </Typography>
        <CodeBlock text={linkCode} />
        <Typography>
          The format (fields, rules, rotation syntax and code to make the link)
          is on its own page.
        </Typography>
        <div>
          <Button
            variant="outlined"
            color="inherit"
            href="/import-spec/"
            target="_blank"
            rel="noopener"
          >
            Team link format
          </Button>
        </div>
      </CardContent>
    </CardThemed>
  )
}
