- `options.titleEn` and `resources.nameEn` are copied into the new translation catalogue and then
  **removed**. The copy is verified before anything is dropped: if a single value could not be read
  back, nothing is dropped and the migration is retried on the next start. The English fields
  disappear from the option and resource screens — that is where translating now stops happening.
