# Kernel

Shared application logic, independent of chat services and the desktop host.

`Kernel` owns the registry, router, persistent store, app actions and protocol facade. Construct it with a data directory and an explicit array of surfaces. Call `start()` after the host is ready and `stop()` during shutdown.

- [Surface contract](src/surface.ts)
- [Router](src/router.ts)
- [Public exports](src/index.ts)
- [Extension guide](../../docs/adding-a-surface.md)

This package may not import a concrete surface or the gateway. The echo example demonstrates an additional surface.
