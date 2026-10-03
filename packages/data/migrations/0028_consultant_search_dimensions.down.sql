-- MB-SEARCH-DIMENSIONS-002 L01: explicit rollback removes this new catalogue only.
DROP TABLE consultant_search_dimension_revision;
DROP FUNCTION matchbase_search_dimension_revision_guard();
