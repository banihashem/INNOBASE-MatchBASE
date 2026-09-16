ALTER TABLE product_classification
  DROP CONSTRAINT product_classification_scheme_check;
ALTER TABLE product_classification
  ADD CONSTRAINT product_classification_scheme_check
  CHECK (scheme IN ('HS','GS1_GPC','UNSPSC','ECLASS','ETIM','CUSTOM_MATCHBASE'));
