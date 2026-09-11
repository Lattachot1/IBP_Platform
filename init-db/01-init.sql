-- AI-Driven Integrated Business Planning (IBP) Platform
-- Database Schema for UBE Chemicals (Asia) PCL
-- Target DBMS: Microsoft SQL Server 2022

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'IBP_DB')
BEGIN
    CREATE DATABASE IBP_DB;
END
GO

USE IBP_DB;
GO

IF OBJECT_ID(N'dbo.Scenarios', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Scenarios (
        ScenarioID INT IDENTITY(1,1) PRIMARY KEY,
        ScenarioName NVARCHAR(100) NOT NULL,
        BaseDemand FLOAT NOT NULL,
        DemandChangePct FLOAT NOT NULL,
        ForecastDemand FLOAT NOT NULL,
        CapacityLimit FLOAT NOT NULL,
        EnableOT BIT NOT NULL DEFAULT 0,
        ActualProduce FLOAT NOT NULL,
        ShortageQty FLOAT NOT NULL,
        ServiceLevelPct FLOAT NOT NULL,
        RevenueTHB FLOAT NOT NULL,
        ExtraCostTHB FLOAT NOT NULL DEFAULT 0,
        ConstraintStatus NVARCHAR(255) NOT NULL,
        CreatedBy NVARCHAR(50) NOT NULL,
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE()
    );

    CREATE NONCLUSTERED INDEX IX_Scenarios_CreatedAt ON dbo.Scenarios(CreatedAt DESC);
    CREATE NONCLUSTERED INDEX IX_Scenarios_CreatedBy ON dbo.Scenarios(CreatedBy);
END
GO

-- Seed illustrative benchmark scenarios based on Capstone Business Case
IF NOT EXISTS (SELECT 1 FROM dbo.Scenarios)
BEGIN
    INSERT INTO dbo.Scenarios (
        ScenarioName, BaseDemand, DemandChangePct, ForecastDemand, CapacityLimit, EnableOT,
        ActualProduce, ShortageQty, ServiceLevelPct, RevenueTHB, ExtraCostTHB, ConstraintStatus, CreatedBy, CreatedAt
    )
    VALUES 
    (
        N'Base Plan (Normal Baseline)',
        10000.0, 0.0, 10000.0, 10500.0, 0,
        10000.0, 0.0, 100.0, 10000000.0, 0.0,
        N'Feasible / Normal Capacity',
        N'Supply Chain Lead',
        DATEADD(MINUTE, -120, GETDATE())
    ),
    (
        N'Demand Surge (+20%) - Constrained Bottleneck',
        10000.0, 20.0, 12000.0, 10500.0, 0,
        10500.0, 1500.0, 87.5, 10500000.0, 0.0,
        N'Capacity Overload Bottleneck (+12h required)',
        N'Sales & Commercial',
        DATEADD(MINUTE, -60, GETDATE())
    ),
    (
        N'Demand Surge (+20%) - With Overtime Lever',
        10000.0, 20.0, 12000.0, 12000.0, 1,
        12000.0, 0.0, 100.0, 12000000.0, 120000.0,
        N'Feasible (OT Shift Activated)',
        N'Executive Committee',
        DATEADD(MINUTE, -15, GETDATE())
    );
END
GO
