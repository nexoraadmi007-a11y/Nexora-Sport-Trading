# NBA API Sources To Collect

Use these sources for NBA player props, team totals, first-half totals, player stats, and injuries.

## Primary Odds / Player Props

1. The Odds API
   - Documentation: https://the-odds-api.com/liveapi/guides/v4/
   - Markets list: https://the-odds-api.com/sports-odds-data/betting-markets.html
   - Notes: Player props and additional markets may require a paid plan. Useful market keys include player points, rebounds, assists, threes, PRA, team totals, alternate totals, and period markets where available.
   - Current first-half totals integration attempts event-level `totals_h1`. If the plan/provider does not return that market, the NBA First Half engine remains dormant and sends no forced signal.

2. TheOddsAPI.com
   - Site: https://theoddsapi.com/
   - Notes: Lists NBA player props on Business tier and provides normalized odds endpoints.

## NBA Stats / Official Data

3. Sportradar NBA API
   - Documentation: https://developer.sportradar.com/basketball/docs/nba-ig-api-basics
   - Notes: Best fit for official NBA schedule, play-by-play, box score, player, team, and injury-related data depending on package access.

4. SportsDataIO NBA API
   - Documentation: https://sportsdata.io/developers/api-documentation/nba
   - Notes: Useful for NBA stats, projections, injuries, and betting data depending on subscription.
   - Current configured endpoint pattern:
     `https://api.sportsdata.io/v3/nba/stats/json/PlayerGameStatsByDateFinal/{date}?key=SPORTSDATAIO_NBA_API_KEY`

## Betting Data / Props Alternatives

5. SportsDataIO Betting Data Guide
   - Documentation: https://support.sportsdata.io/hc/en-us/articles/4404845466519-Betting-Data-Integration-Guide
   - Notes: Covers betting data concepts including player props, but may require account login.

6. Odds-API.io Player Props
   - Documentation: https://docs.odds-api.io/examples/player-props
   - Notes: Alternative player-props provider.

7. OpticOdds Basketball API
   - Site: https://opticodds.com/sports/basketball
   - Notes: Basketball odds, player props, and injury data provider.

## Current Player Props Engine Status

- SportsDataIO player stats ingestion is active through `SPORTSDATAIO_NBA_API_KEY`.
- The engine requests player prop odds keys from The Odds API at event level:
  - `player_points`
  - `player_rebounds`
  - `player_assists`
  - `player_threes`
- If the current Odds API plan does not return those markets, Player Props remains dormant and sends no forced signal.
