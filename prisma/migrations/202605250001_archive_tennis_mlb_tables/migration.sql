-- Safe rollback for the Tennis + MLB extension.
-- Archive the extension tables without deleting any stored data.

DO $$
BEGIN
  IF to_regclass('public."TennisSignal"') IS NOT NULL AND to_regclass('public."ArchivedTennisSignal"') IS NULL THEN
    ALTER TABLE public."TennisSignal" RENAME TO "ArchivedTennisSignal";
  END IF;

  IF to_regclass('public."TennisSurfaceProfile"') IS NOT NULL AND to_regclass('public."ArchivedTennisSurfaceProfile"') IS NULL THEN
    ALTER TABLE public."TennisSurfaceProfile" RENAME TO "ArchivedTennisSurfaceProfile";
  END IF;

  IF to_regclass('public."TennisPlayerProfile"') IS NOT NULL AND to_regclass('public."ArchivedTennisPlayerProfile"') IS NULL THEN
    ALTER TABLE public."TennisPlayerProfile" RENAME TO "ArchivedTennisPlayerProfile";
  END IF;

  IF to_regclass('public."TennisMatch"') IS NOT NULL AND to_regclass('public."ArchivedTennisMatch"') IS NULL THEN
    ALTER TABLE public."TennisMatch" RENAME TO "ArchivedTennisMatch";
  END IF;

  IF to_regclass('public."MlbSignal"') IS NOT NULL AND to_regclass('public."ArchivedMlbSignal"') IS NULL THEN
    ALTER TABLE public."MlbSignal" RENAME TO "ArchivedMlbSignal";
  END IF;

  IF to_regclass('public."MlbPitcherProfile"') IS NOT NULL AND to_regclass('public."ArchivedMlbPitcherProfile"') IS NULL THEN
    ALTER TABLE public."MlbPitcherProfile" RENAME TO "ArchivedMlbPitcherProfile";
  END IF;

  IF to_regclass('public."MlbTeamProfile"') IS NOT NULL AND to_regclass('public."ArchivedMlbTeamProfile"') IS NULL THEN
    ALTER TABLE public."MlbTeamProfile" RENAME TO "ArchivedMlbTeamProfile";
  END IF;

  IF to_regclass('public."MlbGame"') IS NOT NULL AND to_regclass('public."ArchivedMlbGame"') IS NULL THEN
    ALTER TABLE public."MlbGame" RENAME TO "ArchivedMlbGame";
  END IF;
END $$;
