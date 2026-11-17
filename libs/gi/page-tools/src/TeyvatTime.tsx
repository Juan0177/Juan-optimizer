import { CardThemed, DropdownButton } from '@genshin-optimizer/common/ui'
import {
  DAY_MS,
  MINUTE_MS,
  SECOND_MS,
  timeString,
} from '@genshin-optimizer/common/util'
import type { TimeZoneKey } from '@genshin-optimizer/gi/db'
import { timeZones } from '@genshin-optimizer/gi/db'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import AccessTimeFilledIcon from '@mui/icons-material/AccessTimeFilled'
import { CardContent, Divider, Grid, MenuItem, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
export default function TeyvatTime() {
  const { t, i18n } = useTranslation('ui')
  const database = useDatabase()
  const [{ timeZoneKey }, setState] = useState(() => database.displayTool.get())
  useEffect(
    () => database.displayTool.follow((_r, s) => setState(s)),
    [database]
  )
  const setTimeZoneKey = useCallback(
    (timeZoneKey: TimeZoneKey) => database.displayTool.set({ timeZoneKey }),
    [database]
  )

  const [time, setTime] = useState(
    new Date(Date.now() + timeZones[timeZoneKey])
  )
  //set a timer. timer resets when timezone is changed.
  useEffect(() => {
    const setSecondTimeout = () => {
      setTime(new Date(Date.now() + timeZones[timeZoneKey]))
      return setTimeout(
        () => {
          interval = setSecondTimeout()
        },
        SECOND_MS - (Date.now() % SECOND_MS)
      )
    }
    let interval = setSecondTimeout()
    return () => clearTimeout(interval)
  }, [timeZoneKey])

  let resetTime = new Date(time)
  if (resetTime.getUTCHours() < 4) {
    resetTime.setUTCHours(4, 0, 0, 0)
  } else {
    resetTime = new Date(resetTime.getTime() + DAY_MS)
    resetTime.setUTCHours(4, 0, 0, 0)
  }
  const remaningTimeMs = resetTime.getTime() - time.getTime()
  // the server's name: "Europe" is "Europa" in Italian
  const zoneName = (key: TimeZoneKey) =>
    t(`tools.time.zone.${key.split(',')[0]}`, key)
  const remainingResetString = timeString(remaningTimeMs, {
    minutes: t('tools.minutes', 'Minutes'),
    hours: t('tools.hours', 'Hours'),
  })

  return (
    <CardThemed>
      <CardContent sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <AccessTimeFilledIcon />
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {t('tools.time.title', 'Teyvat Time')}
        </Typography>
        <DropdownButton title={zoneName(timeZoneKey)}>
          {Object.keys(timeZones).map((zoneKey) => (
            <MenuItem
              key={zoneKey}
              selected={timeZoneKey === zoneKey}
              disabled={timeZoneKey === zoneKey}
              onClick={() => setTimeZoneKey(zoneKey)}
            >
              {zoneName(zoneKey as TimeZoneKey)}
            </MenuItem>
          ))}
        </DropdownButton>
      </CardContent>
      <Divider />
      <CardContent>
        <Grid container justifyContent="center" spacing={3}>
          <Grid item sx={{ my: 4 }}>
            <Typography variant="h2">
              {time.toLocaleTimeString(i18n.language, { timeZone: 'UTC' })}
            </Typography>
          </Grid>
          <Grid
            item
            display="flex"
            flexDirection="column"
            justifyContent="space-around"
          >
            <Typography>
              {t('tools.time.serverDate', 'Server Date:')}{' '}
              <b>
                {time.toLocaleDateString(i18n.language, {
                  timeZone: 'UTC',
                  weekday: 'short',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </b>
            </Typography>
            <Typography>
              {t('tools.time.untilReset', 'Time until reset:')}{' '}
              <b>{remainingResetString}</b>
            </Typography>
            <Typography>
              {t('tools.time.resinUntilReset', 'Resin until reset:')}{' '}
              <b>{Math.floor(remaningTimeMs / (8 * MINUTE_MS))}</b>
            </Typography>
          </Grid>
        </Grid>
      </CardContent>
    </CardThemed>
  )
}
