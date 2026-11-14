-- Product-level planning data: product master, released stock, lots in
-- QC, sales orders and the monthly forecast per product group.
-- Run by the db-init service (as sa) after 02-app-login.sql. Idempotent:
-- every table is created only when missing, so re-running on an existing
-- database adds new tables and leaves the data alone. ibp_app reads and
-- writes these tables through db_datareader / db_datawriter; it cannot
-- create them itself.
--
-- Product groups and their rules live in Backend/optimization/plant_config.yaml
-- (the single rule source), so GroupCode is checked by the backend, not by
-- a foreign key. Quantities are tons.

USE IBP_DB;
GO

-- Product master (SAP material). Products are never deleted: IsActive = 0.
IF OBJECT_ID(N'dbo.Products', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Products (
        MaterialNo    NVARCHAR(40)  NOT NULL,
        Description   NVARCHAR(100) NOT NULL,
        GroupCode     NVARCHAR(20)  NOT NULL,
        MinStockTons  DECIMAL(12,3) NOT NULL CONSTRAINT DF_Products_MinStock DEFAULT 0,
        IsActive      BIT           NOT NULL CONSTRAINT DF_Products_IsActive DEFAULT 1,
        UpdatedAt     DATETIME2     NOT NULL CONSTRAINT DF_Products_UpdatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedBy     NVARCHAR(50)  NOT NULL,
        CONSTRAINT PK_Products PRIMARY KEY (MaterialNo),
        CONSTRAINT CK_Products_MinStock CHECK (MinStockTons >= 0)
    );

    CREATE NONCLUSTERED INDEX IX_Products_GroupCode ON dbo.Products(GroupCode);
END
GO

-- Released (QC-passed) stock on hand per material, one row per export date.
IF OBJECT_ID(N'dbo.StockSnapshots', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockSnapshots (
        SnapshotDate  DATE          NOT NULL,
        MaterialNo    NVARCHAR(40)  NOT NULL,
        OnHandTons    DECIMAL(12,3) NOT NULL,
        LoadedAt      DATETIME2     NOT NULL CONSTRAINT DF_StockSnapshots_LoadedAt DEFAULT SYSUTCDATETIME(),
        LoadedBy      NVARCHAR(50)  NOT NULL,
        CONSTRAINT PK_StockSnapshots PRIMARY KEY (SnapshotDate, MaterialNo),
        CONSTRAINT FK_StockSnapshots_Products FOREIGN KEY (MaterialNo) REFERENCES dbo.Products(MaterialNo),
        CONSTRAINT CK_StockSnapshots_OnHand CHECK (OnHandTons >= 0)
    );
END
GO

-- Hand-entered on-hand stock per material: the planner's corrected figure,
-- used INSTEAD OF the imported snapshot value, and also when no snapshot has
-- been imported at all (e.g. before the SAP data arrives). Deliberately not
-- dated: it is what the planner guarantees right now, so a stock import
-- never touches these rows. Clear it to fall back to the import.
IF OBJECT_ID(N'dbo.StockAdjustments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockAdjustments (
        MaterialNo    NVARCHAR(40)  NOT NULL,
        AdjustTons    DECIMAL(12,3) NOT NULL,
        UpdatedAt     DATETIME2     NOT NULL CONSTRAINT DF_StockAdjustments_UpdatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedBy     NVARCHAR(50)  NOT NULL,
        CONSTRAINT PK_StockAdjustments PRIMARY KEY (MaterialNo),
        CONSTRAINT FK_StockAdjustments_Products FOREIGN KEY (MaterialNo) REFERENCES dbo.Products(MaterialNo),
        CONSTRAINT CK_StockAdjustments_Tons CHECK (AdjustTons >= 0)
    );
END
GO

-- Produced lots waiting for QC. A lot counts as incoming stock when its
-- ReleaseDate is after the snapshot date and it was not rejected.
IF OBJECT_ID(N'dbo.QcLots', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.QcLots (
        LotNo         NVARCHAR(40)  NOT NULL,
        MaterialNo    NVARCHAR(40)  NOT NULL,
        Tons          DECIMAL(12,3) NOT NULL,
        ProducedDate  DATE          NOT NULL,
        ReleaseDate   DATE          NOT NULL,
        Status        NVARCHAR(10)  NOT NULL CONSTRAINT DF_QcLots_Status DEFAULT N'in_qc',
        UpdatedAt     DATETIME2     NOT NULL CONSTRAINT DF_QcLots_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_QcLots PRIMARY KEY (LotNo),
        CONSTRAINT FK_QcLots_Products FOREIGN KEY (MaterialNo) REFERENCES dbo.Products(MaterialNo),
        CONSTRAINT CK_QcLots_Tons CHECK (Tons > 0),
        CONSTRAINT CK_QcLots_Dates CHECK (ReleaseDate >= ProducedDate),
        CONSTRAINT CK_QcLots_Status CHECK (Status IN (N'in_qc', N'released', N'rejected'))
    );

    CREATE NONCLUSTERED INDEX IX_QcLots_ReleaseDate ON dbo.QcLots(ReleaseDate);
END
GO

-- Sales order items (SAP order + item). No customer data is stored.
IF OBJECT_ID(N'dbo.SalesOrders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalesOrders (
        OrderNo       NVARCHAR(20)  NOT NULL,
        ItemNo        INT           NOT NULL,
        MaterialNo    NVARCHAR(40)  NOT NULL,
        Tons          DECIMAL(12,3) NOT NULL,
        ShippedTons   DECIMAL(12,3) NOT NULL CONSTRAINT DF_SalesOrders_Shipped DEFAULT 0,
        DueDate       DATE          NOT NULL,
        Status        NVARCHAR(10)  NOT NULL CONSTRAINT DF_SalesOrders_Status DEFAULT N'open',
        UpdatedAt     DATETIME2     NOT NULL CONSTRAINT DF_SalesOrders_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_SalesOrders PRIMARY KEY (OrderNo, ItemNo),
        CONSTRAINT FK_SalesOrders_Products FOREIGN KEY (MaterialNo) REFERENCES dbo.Products(MaterialNo),
        CONSTRAINT CK_SalesOrders_Tons CHECK (Tons > 0),
        CONSTRAINT CK_SalesOrders_Shipped CHECK (ShippedTons >= 0 AND ShippedTons <= Tons),
        CONSTRAINT CK_SalesOrders_Status CHECK (Status IN (N'open', N'closed', N'cancelled'))
    );

    CREATE NONCLUSTERED INDEX IX_SalesOrders_DueDate ON dbo.SalesOrders(DueDate, MaterialNo);
END
GO

-- Monthly forecast per product group. A 'manual' row (planner) overrides
-- the 'engine' row (forecast engine) of the same group and month.
IF OBJECT_ID(N'dbo.DemandForecasts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DemandForecasts (
        GroupCode     NVARCHAR(20)  NOT NULL,
        ForecastMonth DATE          NOT NULL,
        Source        NVARCHAR(10)  NOT NULL,
        Tons          DECIMAL(12,3) NOT NULL,
        UpdatedAt     DATETIME2     NOT NULL CONSTRAINT DF_DemandForecasts_UpdatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedBy     NVARCHAR(50)  NOT NULL,
        CONSTRAINT PK_DemandForecasts PRIMARY KEY (GroupCode, ForecastMonth, Source),
        CONSTRAINT CK_DemandForecasts_Month CHECK (DAY(ForecastMonth) = 1),
        CONSTRAINT CK_DemandForecasts_Source CHECK (Source IN (N'engine', N'manual')),
        CONSTRAINT CK_DemandForecasts_Tons CHECK (Tons >= 0)
    );
END
GO
