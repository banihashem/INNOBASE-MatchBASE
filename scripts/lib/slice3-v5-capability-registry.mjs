export function createOneUseOpaqueCapabilityRegistry() {
  const capabilities = new WeakMap();
  return Object.freeze({
    mint(context) {
      const capability = Object.freeze({});
      capabilities.set(capability, Object.freeze({ ...context }));
      return capability;
    },
    consume(capability) {
      const context = capabilities.get(capability);
      if (!context)
        throw new Error(
          "V5 credential-gate capability is invalid or consumed.",
        );
      capabilities.delete(capability);
      return context;
    },
  });
}
