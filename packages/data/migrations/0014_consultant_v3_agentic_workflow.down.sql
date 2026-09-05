-- Migration: 0014_consultant_v3_agentic_workflow.down.sql
-- Description: Revert consultant v3 agentic workflow tables and indexes.

DROP TABLE IF EXISTS consultant_pdf_report_ledger CASCADE;
DROP TABLE IF EXISTS consultant_supplier_entity_v3 CASCADE;
DROP TABLE IF EXISTS consultant_output_v3 CASCADE;
DROP TABLE IF EXISTS consultant_research_execution CASCADE;
DROP TABLE IF EXISTS product_classification CASCADE;
