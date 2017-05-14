# 0.7.x

- Interfaces are in `ng.jsonapi` now
- Resources can be extended for personalized classes

# 0.6.x

## Localstorage cache

- Save on localstore all data. When you request a resource or collection, first check memory. If its empty, read from store. If is empty, get the data from back-end.
- HttpStorage deprecated: jsons were saved as sent by the server, now we save json with logic (saving ids and resources separately).

## No more declaration file .d.ts

- typings and index.d.ts removed. We only use `import`

# 0.5.x

All data is merged on one single resource. If you request a request a single related resource, and on this request not include any another resource, related resources come from memory cache (if exists)