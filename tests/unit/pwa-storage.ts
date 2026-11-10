export function memoryStorage() {
  const data = new Map<string, Map<string, Response>>();
  return {
    data,
    storage: {
      async keys() {
        return [...data.keys()];
      },
      async delete(name: string) {
        return data.delete(name);
      },
      async open(name: string) {
        let cache = data.get(name);
        if (!cache) {
          cache = new Map();
          data.set(name, cache);
        }
        return {
          async put(key: string, value: Response) {
            cache.set(
              key,
              new Response(await value.text(), {
                status: value.status,
                headers: value.headers,
              }),
            );
          },
          async match(key: string) {
            return cache.get(key)?.clone();
          },
        };
      },
    } as unknown as CacheStorage,
  };
}
