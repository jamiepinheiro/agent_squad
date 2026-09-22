# Distribution licensing

Agent Squad's original source is available under the MIT license. This does not relicense its dependencies.

The WhatsApp integration uses Baileys 6.7.23, which depends on [WhiskeySockets/libsignal-node](https://github.com/WhiskeySockets/libsignal-node) under GPLv3. The lockfile pins libsignal to `bcea72df9ec34d9d9140ab30619cf479c7c144c7`. The combined application is distributed subject to [GPLv3](licenses/GPL-3.0.txt), with the original MIT notices preserved.

Before distributing an installer:

- Include the GPLv3 license and dependency notices in the app.
- Publish the corresponding source and build instructions alongside the installer, including the exact Agent Squad revision, the Baileys compatibility patch, and matching dependency sources. The Baileys 6.7.23 source revision is `e05b16b4aa0d7d3eb2594677e015454af1225b75`.
- Preserve each dependency's copyright and license files. Generated third-party notices list the packages included in the app.
- Keep the source available for every binary release. Do not describe the complete bundled application as MIT-only.

The release bundle omits unused image/audio transformation peer dependencies. Node.js is separately licensed; its notices are preserved in `Contents/Resources/runtime/LICENSE`.
