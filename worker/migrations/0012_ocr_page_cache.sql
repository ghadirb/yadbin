-- v1.6: cache of page-image reading (vision model), so a book that was already read is never paid for twice.
-- Key = SHA-256 of the ORIGINAL PDF file (computed on the phone) + page number. Only the text of a page is kept, never the file or the images.
-- A teacher can only fetch pages by presenting the full 64-hex hash, i.e. by owning the same file. Additive only.
CREATE TABLE ocr_page_cache (
  file_hash TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (file_hash, page_number)
);
