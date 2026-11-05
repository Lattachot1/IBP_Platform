-- Least-privilege login for the backend (instead of sa): read/write the
-- IBP_DB tables only. Run by the db-init service after 01-init.sql:
--   sqlcmd ... -v APP_PASSWORD="<IBP_APP_PASSWORD from .env>"
-- Idempotent: re-running syncs the password with .env.

USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'ibp_app')
    CREATE LOGIN ibp_app WITH PASSWORD = N'$(APP_PASSWORD)', DEFAULT_DATABASE = IBP_DB;
ELSE
    ALTER LOGIN ibp_app WITH PASSWORD = N'$(APP_PASSWORD)';
GO

USE IBP_DB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'ibp_app')
    CREATE USER ibp_app FOR LOGIN ibp_app;
GO

ALTER ROLE db_datareader ADD MEMBER ibp_app;
ALTER ROLE db_datawriter ADD MEMBER ibp_app;
GO
